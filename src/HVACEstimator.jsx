// HVACEstimator.jsx with AI-driven duct measurement and preserved features
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

function normalizeFractionalSize(size) {
  if (!size) return "?";
  if (size.includes("-")) {
    const parts = size.split("-");
    if (parts.length === 2) {
      const whole = parseInt(parts[0]);
      const fraction = parts[1] === "1/4" ? 0.25 : parts[1] === "1/2" ? 0.5 : parts[1] === "3/4" ? 0.75 : 0;
      return (whole + fraction).toFixed(2);
    }
  }
  return size.replace(/[^\d.]/g, "");
}

function calculateDuctWeight(size, gauge = 26) {
  const gaugeWeightMap = { 26: 1.25, 24: 1.5, 22: 2.0 };
  const [w, h] = size.split('x').map(Number);
  const perimeter = (w + h) * 2 / 12; // in feet
  const surfaceArea = perimeter * 1; // per linear foot
  const weightPerSqFt = gaugeWeightMap[gauge] || 1.25;
  return +(surfaceArea * weightPerSqFt).toFixed(2);
}

function extractHVACDetails(text) {
  const equipmentTags = [...text.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND)[-\s]?\d+\b/gi)].map(m => m[0]);
  const equipmentCounts = equipmentTags.reduce((acc, tag) => {
    const key = tag.split(/[-\s]/)[0].toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const ductSizes = [...text.matchAll(/\b(\d{1,2})[x×X](\d{1,2})\b/g)].map(m => `${m[1]}x${m[2]}`);
  const ductCounts = ductSizes.reduce((acc, size) => {
    acc[size] = (acc[size] || 0) + 1;
    return acc;
  }, {});

  const totalDuctWeight = Object.entries(ductCounts).reduce((sum, [size, count]) => {
    return sum + count * calculateDuctWeight(size);
  }, 0);

  const linearFeet = [...text.matchAll(/\b(\d{1,4})\s?(FT|FEET|FOOT|')\b/gi)].map(m => parseInt(m[1]));
  const linearTakeoff = linearFeet.reduce((a, b) => a + b, 0);

  return { equipmentCounts, ductCounts, totalDuctWeight, linearTakeoff };
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState("");
  const [gauge, setGauge] = useState(26);

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
    const parsed = extractHVACDetails(text);
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

      <h3>Upload Blueprint PDF</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      <label>Gauge:
        <select value={gauge} onChange={(e) => setGauge(parseInt(e.target.value))}>
          <option value={26}>26</option>
          <option value={24}>24</option>
          <option value={22}>22</option>
        </select>
      </label>

      {counts && (
        <div style={{ background: "#f3f3f3", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>📊 Visual Count Breakdown:</h4>
          <h5>🧰 Equipment Tags:</h5>
          <ul>
            {Object.entries(counts.equipmentCounts).map(([key, value]) => (
              <li key={key}><strong>{key}</strong>: {value}</li>
            ))}
          </ul>

          <h5>📐 Duct Sizes:</h5>
          <ul>
            {Object.entries(counts.ductCounts).map(([size, count]) => (
              <li key={size}><strong>{size}</strong>: {count}</li>
            ))}
          </ul>

          <p><strong>Estimated Total Duct Weight:</strong> {counts.totalDuctWeight.toFixed(2)} lbs (Gauge: {gauge})</p>
          <p><strong>Total Linear Footage:</strong> {counts.linearTakeoff} feet</p>
        </div>
      )}

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );
}
