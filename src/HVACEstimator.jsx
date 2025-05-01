// HVACEstimator.jsx using OCR.space API for scanned PDF text extraction
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

function extractMechanicalTags(text) {
  return {
    rtus: (text.match(/RTU[-\s]?\d+/gi) || []).length,
    ahus: (text.match(/AHU[-\s]?\d+/gi) || []).length,
    fans: (text.match(/EF[-\s]?\d+|EXH FAN[-\s]?\d+|SF[-\s]?\d+|SUP FAN[-\s]?\d+/gi) || []).length,
    ervs: (text.match(/ERV[-\s]?\d+|HRV[-\s]?\d+/gi) || []).length,
    vavs: (text.match(/VAV[-\s]?\d+/gi) || []).length,
    fcus: (text.match(/FCU[-\s]?\d+/gi) || []).length,
    maus: (text.match(/MAU[-\s]?\d+/gi) || []).length,
    doas: (text.match(/DOAS[-\s]?\d+/gi) || []).length,
    diffusers: (text.match(/DIFF[-\s]?\d+|diffuser/gi) || []).length
  };
}

function generateTagSummary(counts) {
  const entries = Object.entries(counts).filter(([_, v]) => v > 0);
  if (entries.length === 0) return "No mechanical tags detected.";
  return entries.map(([k, v]) => `${v} ${k.toUpperCase()}`).join(", ");
}

function simulateDomainHVACEstimator(text) {
  const counts = extractMechanicalTags(text);
  const zones = (text.match(/zone\s?-?\d+/gi) || []).length || 1;
  const ductRefs = [...text.matchAll(/(\d{2,4})\s?(ft|')\s?(duct|supply|return)?/gi)];
  const ductwork = ductRefs.reduce((sum, match) => sum + parseInt(match[1]), 0) || zones * 250 + counts.rtus * 100;

  const scope = [];
  if (counts.rtus) scope.push(`Install ${counts.rtus} Rooftop Units.`);
  if (counts.fans) scope.push(`Install ${counts.fans} supply and exhaust fans.`);
  if (counts.vavs) scope.push(`Install ${counts.vavs} VAV boxes.`);
  if (counts.diffusers) scope.push(`Distribute air using ${counts.diffusers} diffusers.`);
  scope.push(`Provide and hang ${ductwork} ft of ductwork across ${zones} zones.`);
  scope.push(`Include insulation, balancing, and controls per plans.`);

  return {
    summaryText: scope.join("\n"),
    tagSummary: generateTagSummary(counts)
  };
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

    // If no text found, fallback to OCR.space
    if (fullText.length < 50) {
      const formData = new FormData();
      formData.append("apikey", "helloworld"); // Free public test key
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
    const parsed = simulateDomainHVACEstimator(text);
    setBlueprintText(text);
    setScopeSummary(parsed.summaryText);
    setEquipmentSummary(parsed.tagSummary);
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
