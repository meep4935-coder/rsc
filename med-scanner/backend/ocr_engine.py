import re
import datetime
import easyocr
import numpy as np
from PIL import Image

# Initialize the EasyOCR reader. 
# We include French ('fr') and English ('en') since both are prevalent in Quebec clinical settings.
print("Initializing EasyOCR reader...")
reader = easyocr.Reader(['fr', 'en'], gpu=False)
print("EasyOCR reader initialized.")

def parse_ramq_dob_info(ramq_str: str):
    """
    Extract DOB and gender info from RAMQ string.
    Quebec RAMQ format: AAAA YYMMDD XX
    YY: Birth year
    MM: Birth month. Females have 50 added to their birth month (51-62).
    DD: Birth day
    """
    clean_ramq = re.sub(r'[^A-Z0-9]', '', ramq_str.upper())
    if len(clean_ramq) != 12:
        return None
    
    initials = clean_ramq[:4]
    yy_str = clean_ramq[4:6]
    mm_val = int(clean_ramq[6:8])
    dd_str = clean_ramq[8:10]
    
    # Check gender
    is_female = False
    if mm_val > 50:
        is_female = True
        mm_val -= 50
        
    if not (1 <= mm_val <= 12):
        return None
        
    # Determine full year (assuming RAMQ is for living patients, birth year is likely 19xx or 20xx)
    current_year = datetime.datetime.now().year
    current_yy = current_year % 100
    
    yy = int(yy_str)
    # If YY is greater than current YY, it's likely 19xx, otherwise 20xx
    if yy > current_yy:
        year = 1900 + yy
    else:
        year = 2000 + yy
        
    try:
        dob = datetime.date(year, mm_val, int(dd_str))
        return {
            "dob": dob.strftime("%Y-%m-%d"),
            "gender": "F" if is_female else "M",
            "initials": initials
        }
    except ValueError:
        return None

def extract_patient_info(image_bytes: bytes):
    """
    Process image bytes, run OCR, and extract patient fields.
    """
    # Load image
    from io import BytesIO
    image = Image.open(BytesIO(image_bytes)).convert('RGB')
    image_np = np.array(image)
    
    # Run EasyOCR
    results = reader.readtext(image_np)
    
    # Concat all detected text and keep line tracking
    full_text_lines = []
    all_text = ""
    for bbox, text, confidence in results:
        full_text_lines.append(text)
        all_text += " " + text
        
    print(f"OCR Detected Text: {all_text}")
    
    # 1. Detect RAMQ
    # RAMQ regex: 4 letters followed by 8 digits (optionally separated by spaces/hyphens)
    ramq_pattern = r'\b([A-Z]{4})\s*(\d{4})\s*(\d{4})\b|\b([A-Z]{4})\s*(\d{8})\b'
    ramq_matches = re.finditer(ramq_pattern, all_text.upper())
    
    detected_ramq = None
    ramq_dob_info = None
    
    for match in ramq_matches:
        matched_str = match.group(0)
        cleaned = re.sub(r'[^A-Z0-9]', '', matched_str)
        info = parse_ramq_dob_info(cleaned)
        if info:
            detected_ramq = f"{cleaned[:4]} {cleaned[4:8]} {cleaned[8:]}"
            ramq_dob_info = info
            break
            
    # 2. Detect DOB
    # Search for DOB patterns: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, etc.
    dob_pattern = r'\b(19\d{2}|20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b|\b(0[1-9]|[12]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](19\d{2}|20\d{2})\b'
    dob_matches = re.findall(dob_pattern, all_text)
    
    detected_dob = None
    if dob_matches:
        # Extract the first matching valid date
        for match in dob_matches:
            parts = [p for p in match if p]
            if len(parts) == 3:
                # Reformat to YYYY-MM-DD
                if len(parts[0]) == 4:
                    detected_dob = f"{parts[0]}-{parts[1]}-{parts[2]}"
                else:
                    detected_dob = f"{parts[2]}-{parts[1]}-{parts[0]}"
                break
                
    # If we found RAMQ, use its encoded DOB as fallback/validation
    if ramq_dob_info:
        ramq_dob = ramq_dob_info["dob"]
        if not detected_dob:
            detected_dob = ramq_dob
            
    # 3. Detect Name
    # Heuristics:
    # If we have RAMQ initials (e.g. TREM for Tremblay, M for Marie), 
    # we search for words starting with those initials.
    detected_name = None
    if ramq_dob_info:
        initials = ramq_dob_info["initials"]
        last_name_init = initials[:3]
        first_name_init = initials[3]
        
        # Look through OCR lines for words matching these initials
        words = []
        for line in full_text_lines:
            words.extend(re.findall(r'\b[a-zA-ZÀ-ÿ]+\b', line))
            
        candidate_last = None
        candidate_first = None
        
        for w in words:
            w_upper = w.upper()
            if w_upper.startswith(last_name_init) and len(w) > 3:
                candidate_last = w
            elif w_upper.startswith(first_name_init) and len(w) > 2:
                candidate_first = w
                
        if candidate_last and candidate_first:
            # Capitalize properly
            detected_name = f"{candidate_first.capitalize()} {candidate_last.capitalize()}"
            
    # Generic Name extraction fallback if RAMQ initials check didn't work
    if not detected_name:
        # Look for keywords like Nom/Name/Patient followed by words
        name_keyword_pattern = r'(?:NOM|NAME|PATIENT)\s*[:\.-]?\s*([A-ZÀ-ÿa-z]+)\s+([A-ZÀ-ÿa-z]+)'
        match = re.search(name_keyword_pattern, all_text.upper())
        if match:
            detected_name = f"{match.group(1).capitalize()} {match.group(2).capitalize()}"
            
    return {
        "name": detected_name,
        "dob": detected_dob,
        "ramq": detected_ramq,
        "success": bool(detected_name and detected_dob and detected_ramq)
    }
