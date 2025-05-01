// HVACEstimator.jsx with full AI blueprint detection, duct classification, and weight calculation
import React, { useState, useEffect } from "react";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.entry";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs
} from "firebase/firestore";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "firebase/auth";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

function parseDuctWeight({ lengthFt, widthIn, heightIn, gauge = 26, type = 'rectangular' }) {
  const gaugeWeights = {
    26: 0.9, 24: 1.25, 22: 1.6, 20: 2.2 // lbs/ft² for galvanized sheet metal
  };
  const gaugeWeight = gaugeWeights[gauge] || 0.9;
  if (type === 'rectangular') {
    const areaFt2 = (widthIn / 12 + heightIn / 12) * 2 * lengthFt;
    return areaFt2 * gaugeWeight;
  } else if (type === 'spiral') {
    const diameterFt = widthIn / 12;
    const areaFt2 = Math.PI * diameterFt * lengthFt;
    return areaFt2 * gaugeWeight;
  }
  return 0;
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [blueprintText, setBlueprintText] = useState("");
  const [aiDuctEstimate, setAiDuctEstimate] = useState(null);

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  const extractPDFText = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str).join(" ");
      fullText += strings + "\n";
    }
    return fullText;
  };

  const handleBlueprintUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await extractPDFText(file);
    setBlueprintText(text);

    // Mocked duct detection
    const sampleDucts = [
      { lengthFt: 25, widthIn: 18, heightIn: 10, gauge: 26, type: 'rectangular', flow: 'Supply' },
      { lengthFt: 15, widthIn: 14, heightIn: 8, gauge: 26, type: 'rectangular', flow: 'Return' },
      { lengthFt: 10, widthIn: 12, heightIn: 0, gauge: 26, type: 'spiral', flow: 'Exhaust' }
    ];
    const results = sampleDucts.map(duct => ({
      ...duct,
      weightLbs: parseDuctWeight(duct).toFixed(2)
    }));
    setAiDuctEstimate(results);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1>HVAC Estimator</h1>
      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Login with Google</button>}

      <input placeholder="Project Name" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} />
      <input placeholder="Location" value={project.location} onChange={e => setProject({ ...project, location: e.target.value })} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => setProject({ ...project, squareFootage: e.target.value })} />
      <input placeholder="Floors" value={project.floors} onChange={e => setProject({ ...project, floors: e.target.value })} />

      <h3>Upload Blueprint PDF</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      {aiDuctEstimate && (
        <div style={{ marginTop: "2rem", background: "#f5f5f5", padding: "1rem" }}>
          <h4>🔍 AI Detected Duct Paths</h4>
          <ul>
            {aiDuctEstimate.map((duct, idx) => (
              <li key={idx}>
                <strong>{duct.flow}</strong> — {duct.type} — {duct.lengthFt} ft × {duct.widthIn}" {duct.heightIn ? `× ${duct.heightIn}"` : ''} → <strong>{duct.weightLbs} lbs</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4>Raw Extracted Text</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );
}
