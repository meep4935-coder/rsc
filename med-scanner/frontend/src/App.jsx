import React, { useState, useEffect, useRef } from 'react';

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [scanning, setScanning] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Align patient file in the box");
  const [statusType, setStatusType] = useState("active"); // active, success, error
  
  const [patientData, setPatientData] = useState({
    name: "",
    dob: "",
    ramq: ""
  });
  
  // Audio feedback helper
  const playBeep = (freq = 880, duration = 0.15) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
      console.warn("Audio Context beep failed", e);
    }
  };

  // Start Camera on load
  useEffect(() => {
    let stream = null;
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment", // back camera
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setStatusMessage("Camera access denied. Please grant permission.");
        setStatusType("error");
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Continuous Scanning Loop
  useEffect(() => {
    if (!scanning) return;

    const intervalId = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Sync canvas sizing
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      if (canvas.width === 0 || canvas.height === 0) return;

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert frame to Blob
      canvas.toBlob(async (blob) => {
        if (!blob) return;

        const formData = new FormData();
        formData.append('file', blob, 'frame.jpg');

        try {
          setStatusMessage("Scanning and analyzing document...");
          const response = await fetch('http://localhost:8000/api/scan', {
            method: 'POST',
            body: formData
          });
          const data = await response.json();

          if (data.success) {
            playBeep(880, 0.15);
            setPatientData({
              name: data.name || "",
              dob: data.dob || "",
              ramq: data.ramq || ""
            });
            setScanning(false);
            setStatusMessage("Patient details identified!");
            setStatusType("success");
          } else {
            // Partially update UI if we find any specific fields, but keep scanning
            if (data.name || data.dob || data.ramq) {
              setPatientData(prev => ({
                name: data.name || prev.name,
                dob: data.dob || prev.dob,
                ramq: data.ramq || prev.ramq
              }));
            }
            setStatusMessage("Searching for patient name, DOB & RAMQ...");
            setStatusType("active");
          }
        } catch (err) {
          console.error("Scan fetch error:", err);
          setStatusMessage("Unable to reach backend. Retrying...");
          setStatusType("active");
        }
      }, 'image/jpeg', 0.85);

    }, 1000); // Poll backend every 1000ms

    return () => clearInterval(intervalId);
  }, [scanning]);

  const handleInputChange = (field, val) => {
    setPatientData(prev => ({
      ...prev,
      [field]: val
    }));
  };

  const handleReset = () => {
    setPatientData({ name: "", dob: "", ramq: "" });
    setScanning(true);
    setStatusMessage("Align patient file in the box");
    setStatusType("active");
  };

  return (
    <div className="glass-panel">
      <h1>Quebec Rx Patient Scanner</h1>
      <p className="subtitle">Instant patient details detection via document camera scanner</p>

      <div className="camera-wrapper">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="camera-preview"
        />
        
        {/* Visual Guided border frame overlays */}
        <div className="scanner-overlay">
          <div className={`scanner-frame ${statusType === 'success' ? 'success-match' : 'active'}`}>
            <div className="corner top-left"></div>
            <div className="corner top-right"></div>
            <div className="corner bottom-left"></div>
            <div className="corner bottom-right"></div>
            {scanning && <div className="laser-line"></div>}
          </div>
        </div>
      </div>

      <div className="status-bar">
        <span className={`status-dot ${statusType}`}></span>
        <span>{statusMessage}</span>
      </div>

      {/* Hidden Canvas for Frame Capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="results-card">
        <div className="result-field">
          <label className="field-label">Patient Name</label>
          <input 
            type="text" 
            className="field-input"
            value={patientData.name}
            placeholder="No name detected yet"
            onChange={(e) => handleInputChange('name', e.target.value)}
          />
        </div>

        <div className="result-field">
          <label className="field-label">Date of Birth (DOB)</label>
          <input 
            type="text" 
            className="field-input"
            value={patientData.dob}
            placeholder="YYYY-MM-DD"
            onChange={(e) => handleInputChange('dob', e.target.value)}
          />
        </div>

        <div className="result-field">
          <label className="field-label">RAMQ Number</label>
          <input 
            type="text" 
            className="field-input"
            value={patientData.ramq}
            placeholder="AAAA 0000 0000"
            onChange={(e) => handleInputChange('ramq', e.target.value)}
          />
        </div>

        {!scanning && (
          <button className="btn btn-primary" onClick={handleReset}>
            Scan New Document
          </button>
        )}
        {scanning && (
          <button className="btn btn-secondary" onClick={() => setScanning(false)}>
            Pause Scanner
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
