// HVACEstimator.jsx with visual detection, weight calc, labor tracking, and full features
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
  const totalDuctLength = Object.values(ductSizeLengthMap).reduce((a, b) => a + b, 0);

  const laborPerFt = 0.15; // hrs/ft (est.)
  const gauge = 26;
  const weightPerSqFtByGauge = {
    26: 1.00, // lbs/sqft (simplified)
    24: 1.25,
    22: 1.50,
    20: 2.00
  };
  const weightCalc = Object.entries(ductSizeLengthMap).reduce((total, [sz, len]) => {
    const [w, h] = sz.split("x").map(n => parseInt(n));
    if (isNaN(w) || isNaN(h)) return total;
    const perimeter = 2 * (w + h) / 12;
    const sqft = perimeter * len;
    const lbs = sqft * (weightPerSqFtByGauge[gauge] || 1);
    return total + lbs;
  }, 0);

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductSizeLengthMap,
    ductLength: totalDuctLength,
    estimatedWeight: weightCalc.toFixed(1),
    estimatedLaborHours: (totalDuctLength * laborPerFt).toFixed(1)
  };
}

function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState("");

  useEffect(() => {
    onAuthStateChanged(auth, (u) => setUser(u));
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

  const handleUpload = async (e) => {
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
      <input type="file" accept="application/pdf" onChange={handleUpload} />
      {counts && (
        <div>
          <h3>📊 Scope Summary</h3>
          <p><strong>Duct Length:</strong> {counts.ductLength} ft</p>
          <p><strong>Estimated Weight:</strong> {counts.estimatedWeight} lbs</p>
          <p><strong>Labor (duct):</strong> {counts.estimatedLaborHours} hrs</p>
          <h4>Equipment</h4>
          <ul>{Object.entries(counts.equipmentCounts).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          <h4>Piping</h4>
          <ul>{Object.entries(counts.pipingCounts).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          <h4>Air Devices</h4>
          <ul>
            <li>Supply Tags: {counts.airDist.supplyTags}</li>
            <li>Return Tags: {counts.airDist.returnTags}</li>
            <li>Diffusers: {counts.airDist.diffusers}</li>
            <li>Grilles: {counts.airDist.grilles}</li>
            <li>Registers: {counts.airDist.registers}</li>
          </ul>
          <h4>Duct Sizes</h4>
          <ul>{Object.entries(counts.ductSizeLengthMap).map(([sz, len]) => <li key={sz}>{sz}: {len} ft</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export default HVACEstimator;
