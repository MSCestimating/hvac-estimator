// HVACEstimator.jsx with R/S tag integration for supply and return counts
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
  const equipmentTags = [...text.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND)[-\s]?\d+\b/gi)].map(m => m[0]);
  const ductSizes = [...text.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => ({ w: +m[1], h: +m[2] }));
  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
    size: normalizeFractionalSize(m[1]),
    type: m[3]?.toUpperCase()
  }));
  const lengths = [...text.matchAll(/(\d{1,4})\s?(FT|FEET|FOOT|')/gi)].map(m => parseInt(m[1]));

  const airDist = {
    diffusers: (text.match(/\b(DIFF[-\s]?\d+|DIFFUSER(S)?|SD|RD)\b/gi) || []).length,
    grilles: (text.match(/\b(GRL|GRILLE(S)?|RG|EG)\b/gi) || []).length,
    registers: (text.match(/\b(REG|REGISTER(S)?)\b/gi) || []).length,
    supplyTags: (text.match(/\bS[-\s]?\d+\b/gi) || []).length,
    returnTags: (text.match(/\bR[-\s]?\d+\b/gi) || []).length
  };

  const equipmentCounts = equipmentTags.reduce((acc, tag) => {
    const key = tag.split(/[-\s]/)[0].toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return { equipmentCounts, equipmentTags, ductSizes, pipeSizes, lengths, airDist };
}

function summarizeScope(data) {
  const { equipmentCounts, ductSizes, pipeSizes, lengths, airDist } = data;
  const sections = { Equipment: [], Ductwork: [], Piping: [], "Air Distribution": [] };

  for (const [key, value] of Object.entries(equipmentCounts)) {
    sections.Equipment.push(`Install ${value} ${key} units.`);
  }

  if (ductSizes.length > 0) {
    const mostCommonDuct = ductSizes.sort((a, b) => ductSizes.filter(d => d.w === b.w && d.h === b.h).length - ductSizes.filter(d => d.w === a.w && d.h === a.h).length)[0];
    sections.Ductwork.push(`Install approx. ${lengths.reduce((a, b) => a + b, 0)} ft of ductwork (common size: ${mostCommonDuct.w}x${mostCommonDuct.h}).`);
  }

  if (pipeSizes.length > 0) {
    const grouped = pipeSizes.reduce((acc, cur) => {
      const key = `${cur.size || '?"'} ${cur.type}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    Object.entries(grouped).forEach(([type, count]) => sections.Piping.push(`Install ${count} runs of ${type} piping.`));
  }

  if (airDist.diffusers) sections["Air Distribution"].push(`Install ${airDist.diffusers} diffusers.`);
  if (airDist.grilles) sections["Air Distribution"].push(`Install ${airDist.grilles} grilles.`);
  if (airDist.registers) sections["Air Distribution"].push(`Install ${airDist.registers} registers.`);
  if (airDist.supplyTags) sections["Air Distribution"].push(`Install ${airDist.supplyTags} supply air terminals (S-# tags).`);
  if (airDist.returnTags) sections["Air Distribution"].push(`Install ${airDist.returnTags} return air terminals (R-# tags).`);

  return Object.entries(sections).map(([section, lines]) => `\n--- ${section} ---\n${lines.join("\n")}`).join("\n");
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [scopeSummary, setScopeSummary] = useState("");
  const [equipmentSummary, setEquipmentSummary] = useState("");
  const [blueprintText, setBlueprintText] = useState("");

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

    if (fullText.length < 50) {
      const formData = new FormData();
      formData.append("apikey", "helloworld");
      formData.append("isOverlayRequired", "false");
      formData.append("file", file);
      formData.append("OCREngine", "2");

      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: formData
      });

      const result = await response.json();
      fullText = result.ParsedResults?.[0]?.ParsedText || "";
    }

    return fullText;
  };

  const handleBlueprintUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await extractPDFText(file);
    const parsed = extractHVACDetails(text);
    setBlueprintText(text);
    setScopeSummary(summarizeScope(parsed));
    const tagList = Object.entries(parsed.equipmentCounts).map(([k, v]) => `${v} ${k}`).join(", ");
    setEquipmentSummary(tagList || "No mechanical tags detected.");
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

      <h4>Detected Equipment:</h4>
      <pre>{equipmentSummary}</pre>

      <h4>Scope of Work:</h4>
      <pre style={{ background: "#f9f9f9", padding: "1rem" }}>{scopeSummary}</pre>

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={5} />
    </div>
  );
}


