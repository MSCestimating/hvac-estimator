// HVACEstimator.jsx with rectangular duct weight/labor calc, gauge dropdown, all features preserved
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

const GAUGE_WEIGHTS = {
  26: 0.61,
  24: 0.81,
  22: 1.0
};

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

function extractHVACDetails(text) {
  const equipmentTags = [...text.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND)[-\s]?\d+\b/gi)].map(m => m[0]);
  const equipmentCounts = equipmentTags.reduce((acc, tag) => {
    const key = tag.split(/[-\s]/)[0].toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
    size: normalizeFractionalSize(m[1]),
    type: m[3]?.toUpperCase()
  }));

  const pipingCounts = pipeSizes.reduce((acc, cur) => {
    const key = `${cur.size || '?"'} ${cur.type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const supplyTags = (text.match(/\bS[-\s]?\d+\b/gi) || []).length;
  const returnTags = (text.match(/\bR[-\s]?\d+\b/gi) || []).length;
  const diffusers = (text.match(/\b(DIFF[-\s]?\d+|DIFFUSER(S)?|SD)\b/gi) || []).length;
  const grilles = (text.match(/\b(GRL|GRILLE(S)?|RG|EG)\b/gi) || []).length;
  const registers = (text.match(/\b(REG|REGISTER(S)?)\b/gi) || []).length;

  const airDist = {
    supplyTags,
    returnTags,
    diffusers,
    grilles,
    registers,
    supplyTotal: supplyTags + diffusers,
    returnTotal: returnTags + grilles + registers
  };

  const deviceSizes = [...text.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => `${m[1]}x${m[2]}`);
  const sizeCounts = deviceSizes.reduce((acc, sz) => {
    acc[sz] = (acc[sz] || 0) + 1;
    return acc;
  }, {});

  const ductSizeLengthMap = {};
  const sizeLengthMatches = [...text.matchAll(/(\d{1,3})\s?[x×X]\s?(\d{1,3})\s*(RECT)?\s*(\d{1,4})\s?(FT|FEET|')/gi)];
  sizeLengthMatches.forEach(m => {
    const size = `${m[1]}x${m[2]}`;
    const length = parseInt(m[4]);
    if (!isNaN(length)) {
      ductSizeLengthMap[size] = (ductSizeLengthMap[size] || 0) + length;
    }
  });

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductSizeLengthMap
  };
}

export function HVACEstimator() {
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

  const calculateDuctWeight = (sizeMap, gauge) => {
    const multiplier = GAUGE_WEIGHTS[gauge] || 0.61;
    let totalWeight = 0;
    for (const [size, length] of Object.entries(sizeMap)) {
      const [w, h] = size.split("x").map(Number);
      if (!isNaN(w) && !isNaN(h)) {
        const perimeter = 2 * (w + h);
        const surfaceArea = perimeter * length / 12; // ft^2
        totalWeight += surfaceArea * multiplier;
      }
    }
    return totalWeight.toFixed(1);
  };

  const calculateLaborHours = (weight, type) => {
    const rate = type === "rect" ? 0.0522 : 0.0448;
    return (weight * rate).toFixed(1);
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

      <label>
        Sheet Metal Gauge:
        <select value={gauge} onChange={(e) => setGauge(Number(e.target.value))}>
          <option value={26}>26</option>
          <option value={24}>24</option>
          <option value={22}>22</option>
        </select>
      </label>

      {counts && (
        <div style={{ background: "#f3f3f3", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>📊 Rectangular Duct Summary</h4>
          <ul>
            {Object.entries(counts.ductSizeLengthMap).map(([size, length]) => (
              <li key={size}><strong>{size}</strong>: {length} ft</li>
            ))}
          </ul>
          <p><strong>Total Weight:</strong> {calculateDuctWeight(counts.ductSizeLengthMap, gauge)} lbs</p>
          <p><strong>Estimated Labor:</strong> {calculateLaborHours(calculateDuctWeight(counts.ductSizeLengthMap, gauge), "rect")} hrs</p>
        </div>
      )}

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );
}
