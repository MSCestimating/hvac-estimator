// HVACEstimator.jsx with manual scale dropdown and AI rectangular duct detection
import React, { useState, useEffect, useRef } from "react";
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

const scaleMap = {
  "1/8\" = 1'-0\"": 96,
  "1/4\" = 1'-0\"": 48,
  "1/2\" = 1'-0\"": 24,
  "1\" = 1'-0\"": 12
};

function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState("");
  const [scale, setScale] = useState(96); // Default to 1/8" = 1'-0"
  const canvasRef = useRef(null);

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
    // Placeholder for AI duct detection using scale (can integrate TensorFlow or external API)
    setCounts({
      ductLength: Math.round(200 * (96 / scale)), // Example: scale-converted footage
      ductWeight: 500, // placeholder
      equipmentCounts: { RTU: 3, VAV: 10 },
      airDist: { supplyTotal: 14, returnTotal: 9 },
      pipingCounts: {},
      sizeCounts: {}
    });
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

      <label>Select Drawing Scale:</label>
      <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
        {Object.entries(scaleMap).map(([label, val]) => (
          <option key={label} value={val}>{label}</option>
        ))}
      </select>

      {counts && (
        <div style={{ background: "#f3f3f3", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>📏 Rectangular Duct Summary</h4>
          <p><strong>Total Duct Length:</strong> {counts.ductLength} ft</p>
          <p><strong>Total Duct Weight:</strong> {counts.ductWeight} lbs</p>

          <h5>🔧 Equipment</h5>
          <ul>
            {Object.entries(counts.equipmentCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
        </div>
      )}

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );
}

export default HVACEstimator;
