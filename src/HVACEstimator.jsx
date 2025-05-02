// HVACEstimator.jsx with full feature set and OCR-based AI duct detection and UI
import React, { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.entry";
import Tesseract from "tesseract.js";
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

function calculateRectangularDuctWeight(width, height, length, gauge = 26) {
  const gaugeThicknessMap = {
    26: 0.0187,
    24: 0.0236,
    22: 0.0299,
    20: 0.0359,
  };
  const t = gaugeThicknessMap[gauge] || 0.0187;
  const perimeter = 2 * (width + height);
  const weightPerFt = perimeter * t * 3.4;
  return weightPerFt * length;
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
  const ductSizeWeightMap = {};
  const gauge = 26;
  const sizeLengthMatches = [...text.matchAll(/(\d{1,3})\s?[x×X]\s?(\d{1,3})\s*(RECT)?\s*(\d{1,4})\s?(FT|FEET|')/gi)];

  sizeLengthMatches.forEach(m => {
    const width = parseInt(m[1]);
    const height = parseInt(m[2]);
    const size = `${width}x${height}`;
    const length = parseInt(m[4]);
    if (!isNaN(width) && !isNaN(height) && !isNaN(length)) {
      ductSizeLengthMap[size] = (ductSizeLengthMap[size] || 0) + length;
      const weight = calculateRectangularDuctWeight(width, height, length, gauge);
      ductSizeWeightMap[size] = (ductSizeWeightMap[size] || 0) + weight;
    }
  });

  const totalDuctLength = Object.values(ductSizeLengthMap).reduce((a, b) => a + b, 0);
  const totalDuctWeight = Object.values(ductSizeWeightMap).reduce((a, b) => a + b, 0);

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductSizeLengthMap,
    ductSizeWeightMap,
    ductLength: totalDuctLength,
    ductWeight: totalDuctWeight
  };
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState("");

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  const handleBlueprintUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL();

    const { data: { text } } = await Tesseract.recognize(dataUrl, "eng");
    setBlueprintText(text);
    setCounts(extractHVACDetails(text));
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h1>HVAC Estimator</h1>
      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Sign In</button>}
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      {counts && (
        <div style={{ marginTop: "2rem" }}>
          <h3>Duct Length: {counts.ductLength} ft</h3>
          <h3>Duct Weight: {counts.ductWeight.toFixed(2)} lbs</h3>
          <h4>Equipment</h4>
          <ul>
            {Object.entries(counts.equipmentCounts).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
          </ul>
        </div>
      )}

      <h4>Extracted Text (first 1000 chars)</h4>
      <textarea readOnly value={blueprintText.slice(0, 1000)} style={{ width: "100%" }} rows={6} />
    </div>
  );
}
