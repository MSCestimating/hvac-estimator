// HVACEstimator.jsx updated with duct weight calculation and adjustable gauge
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

const gaugeFactors = {
  '26': 0.906,
  '24': 1.188,
  '22': 1.531,
  '20': 2.000
};

function extractHVACDetails(text, selectedGauge = '26') {
  const equipmentTags = [...text.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND)[-\s]?\d+\b/gi)].map(m => m[0]);
  const equipmentCounts = equipmentTags.reduce((acc, tag) => {
    const key = tag.split(/[-\s]/)[0].toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
    size: m[1],
    type: m[3]?.toUpperCase()
  }));

  const pipingCounts = pipeSizes.reduce((acc, cur) => {
    const key = `${cur.size || '"?'} ${cur.type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const deviceSizes = [...text.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => [parseInt(m[1]), parseInt(m[2])]);
  const sizeCounts = deviceSizes.reduce((acc, [w, h]) => {
    const label = `${w}x${h}`;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  let ductWeight = 0;
  const gaugeFactor = gaugeFactors[selectedGauge] || 0.906;
  deviceSizes.forEach(([w, h]) => {
    const perimeter = 2 * (w + h) / 12; // feet
    ductWeight += perimeter * gaugeFactor;
  });

  return {
    equipmentCounts,
    pipingCounts,
    sizeCounts,
    ductWeight: parseFloat(ductWeight.toFixed(2))
  };
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState("");
  const [gauge, setGauge] = useState("26");
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
    const parsed = extractHVACDetails(text, gauge);
    setBlueprintText(text);
    setCounts(parsed);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1>HVAC Estimator</h1>

      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Login with Google</button>}

      <input placeholder="Project Name" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} />
      <input placeholder="Location" value={project.location} onChange={e => setProject({ ...project, location: e.target.value })} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => setProject({ ...project, squareFootage: e.target.value })} />
      <input placeholder="Floors" value={project.floors} onChange={e => setProject({ ...project, floors: e.target.value })} />

      <label>Duct Gauge:
        <select value={gauge} onChange={e => setGauge(e.target.value)}>
          <option value="26">26 GA</option>
          <option value="24">24 GA</option>
          <option value="22">22 GA</option>
          <option value="20">20 GA</option>
        </select>
      </label>

      <h3>Upload Blueprint PDF</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      {counts && (
        <div style={{ background: "#f3f3f3", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>📊 Scope Breakdown:</h4>
          <h5>🔧 Equipment</h5>
          <ul>
            {Object.entries(counts.equipmentCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
          <h5>📐 Device Sizes</h5>
          <ul>
            {Object.entries(counts.sizeCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
          <h5>🛠️ Pipe Sizes</h5>
          <ul>
            {Object.entries(counts.pipingCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
          <h5>⚖️ Duct Weight</h5>
          <p><strong>Total Estimated Weight:</strong> {counts.ductWeight} lbs (Gauge {gauge})</p>
        </div>
      )}

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );
}
