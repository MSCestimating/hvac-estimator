// Cleaned FULL HVACEstimator.jsx with Labor Calculation Integration

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
  const cleanText = text.toUpperCase();

  const tagMap = {
    RTU: /\bRTU[-\s]?\d+\b/g,
    VAV: /\bVAV[-\s]?\d+\b/g,
    EF: /\bEF[-\s]?\d+\b/g,
    EXFAN: /\bEX(FAN)?[-\s]?\d+\b/g,
    FCU: /\bFCU[-\s]?\d+\b/g,
    MAU: /\bMAU[-\s]?\d+\b/g,
    DOAS: /\bDOAS[-\s]?\d+\b/g,
    AHU: /\bAHU[-\s]?\d+\b/g,
    HP: /\bHP[-\s]?\d+\b/g,
    COND: /\bCOND[-\s]?\d+\b/g,
    OA: /\b(OA|O)[-\s]?\d+\b/g,
    FD: /\bFD[-\s]?\d+\b/g,
    SD: /\bSD[-\s]?\d+\b/g,
    CTRL: /\b(CTRL|BMS)[-\s]?\d*\b/g
  };

  const equipmentCounts = {};
  for (const [key, regex] of Object.entries(tagMap)) {
    const matches = cleanText.match(regex);
    if (matches) equipmentCounts[key] = matches.length;
  }

  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
    size: normalizeFractionalSize(m[1]),
    type: m[3]?.toUpperCase()
  }));

  const pipingCounts = pipeSizes.reduce((acc, cur) => {
    const key = `${cur.size || '?"'} ${cur.type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const supplyTags = (cleanText.match(/\bS[-\s]?\d+\b/g) || []).length;
  const returnTags = (cleanText.match(/\bR[-\s]?\d+\b/g) || []).length;
  const diffusers = (cleanText.match(/\b(DIFF[-\s]?\d+|DIFFUSER(S)?|SD)\b/g) || []).length;
  const grilles = (cleanText.match(/\b(GRL|GRILLE(S)?|RG|EG)\b/g) || []).length;
  const registers = (cleanText.match(/\b(REG|REGISTER(S)?)\b/g) || []).length;

  const airDist = {
    supplyTags,
    returnTags,
    diffusers,
    grilles,
    registers,
    supplyTotal: supplyTags + diffusers,
    returnTotal: returnTags + grilles + registers
  };

  const deviceSizes = [...cleanText.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => `${m[1]}x${m[2]}`);
  const sizeCounts = deviceSizes.reduce((acc, sz) => {
    acc[sz] = (acc[sz] || 0) + 1;
    return acc;
  }, {});

  const ductMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?\bDUCT\b/g)].map(m => parseInt(m[1]));
  const pipeMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?\bPIPE\b/g)].map(m => parseInt(m[1]));
  const dryerExhaustMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?(DRYER VENT|DRYER EXHAUST)\b/g)].map(m => parseInt(m[1]));
  const makeupAirMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?(MAKE[-\s]?UP AIR|MUA|MAU)\b/g)].map(m => parseInt(m[1]));

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductLength: ductMentions.reduce((a, b) => a + b, 0),
    pipeLength: pipeMentions.reduce((a, b) => a + b, 0),
    dryerExhaustLength: dryerExhaustMentions.reduce((a, b) => a + b, 0),
    makeupAirLength: makeupAirMentions.reduce((a, b) => a + b, 0)
  };
}

function calculateLabor(counts, laborRates, ratePerHour) {
  let totalHours = 0;
  let totalCost = 0;
  const laborBreakdown = [];

  const add = (label, qty, hoursPerUnit) => {
    const hours = qty * hoursPerUnit;
    const cost = hours * ratePerHour;
    totalHours += hours;
    totalCost += cost;
    laborBreakdown.push({ label, qty, hoursPerUnit, hours, cost });
  };

  add('Ductwork (ft)', counts.ductLength, laborRates.duct);
  add('Piping (ft)', counts.pipeLength, laborRates.pipe);
  add('Dryer Exhaust (ft)', counts.dryerExhaustLength, laborRates.dryer);
  add('Make-Up Air (ft)', counts.makeupAirLength, laborRates.makeup);

  Object.entries(counts.equipmentCounts).forEach(([key, val]) => {
    const rate = laborRates[key] || 0;
    add(`${key} (qty)`, val, rate);
  });

  return { laborBreakdown, totalHours, totalCost };
}

function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState("");
  const [laborRates, setLaborRates] = useState({
    duct: 0.08,
    pipe: 0.12,
    dryer: 0.1,
    makeup: 0.1,
    RTU: 6,
    VAV: 2.5,
    EF: 2,
    EXFAN: 2,
    FCU: 4,
    MAU: 5
  });
  const [ratePerHour, setRatePerHour] = useState(55);

  useEffect(() => {
    onAuthStateChanged(auth, setUser);
  }, []);

  const extractPDFText = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => item.str).join(" ");
    fullText += strings + "
";
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

  const labor = counts ? calculateLabor(counts, laborRates, ratePerHour) : null;

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

      {counts && (
        <div style={{ background: "#f3f3f3", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>📊 Scope Breakdown:</h4>
          <h5>🔹 Air Distribution</h5>
          <ul>
            <li><strong>Supply Tags:</strong> {counts.airDist.supplyTags}</li>
            <li><strong>Diffusers:</strong> {counts.airDist.diffusers}</li>
            <li><strong>Return Tags:</strong> {counts.airDist.returnTags}</li>
            <li><strong>Grilles:</strong> {counts.airDist.grilles}</li>
            <li><strong>Registers:</strong> {counts.airDist.registers}</li>
          </ul>
          <h5>🔧 Equipment</h5>
          <ul>
            {Object.entries(counts.equipmentCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
          <h5>📐 Duct & Pipe Lengths</h5>
          <ul>
            <li><strong>Duct Length:</strong> {counts.ductLength} feet</li>
            <li><strong>Pipe Length:</strong> {counts.pipeLength} feet</li>
            <li><strong>Dryer Exhaust Length:</strong> {counts.dryerExhaustLength} feet</li>
            <li><strong>Make-Up Air Length:</strong> {counts.makeupAirLength} feet</li>
          </ul>
          <h5>🛠️ Pipe Sizes</h5>
          <ul>
            {Object.entries(counts.pipingCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
          <h5>📏 Device Sizes</h5>
          <ul>
            {Object.entries(counts.sizeCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
          </ul>
        </div>
      )}

      {labor && (
        <div style={{ background: "#e8f4f8", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>🧑‍🔧 Labor Estimate</h4>
          <ul>
            {labor.laborBreakdown.map((item, i) => (
              <li key={i}>{item.label}: {item.qty} × {item.hoursPerUnit} hrs = {item.hours.toFixed(2)} hrs (${item.cost.toFixed(2)})</li>
            ))}
          </ul>
          <p><strong>Total Hours:</strong> {labor.totalHours.toFixed(2)} hrs</p>
          <p><strong>Total Labor Cost:</strong> ${labor.totalCost.toFixed(2)}</p>
        </div>
      )}

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );

}

export default HVACEstimator;
