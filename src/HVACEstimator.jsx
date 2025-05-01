// HVACEstimator.jsx with full scope and duct weight estimation in lbs
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

function extractDuctSizes(text) {
  const rectangularMatches = [...text.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => ({
    type: "rectangular",
    width: parseFloat(m[1]),
    height: parseFloat(m[2]),
    label: `${m[1]}x${m[2]}`
  }));

  const roundMatches = [...text.matchAll(/\b(\d{1,2})\"?\s?(DIA|Ø|SPIRAL|PIPE)\b/gi)].map(m => ({
    type: "round",
    diameter: parseFloat(m[1]),
    label: `${m[1]}" DIA`
  }));

  return [...rectangularMatches, ...roundMatches];
}

function estimateDuctWeight(ducts) {
  let totalWeight = 0;
  const assumedLengthFt = 10; // per mention
  ducts.forEach(duct => {
    if (duct.type === 'rectangular') {
      const w = duct.width / 12;
      const h = duct.height / 12;
      const sa = 2 * (w + h) * assumedLengthFt;
      totalWeight += sa * 0.95; // avg weight 0.95 lbs/sqft
    } else if (duct.type === 'round') {
      const d = duct.diameter / 12;
      const sa = Math.PI * d * assumedLengthFt;
      totalWeight += sa * 1.25; // avg spiral weight
    }
  });
  return totalWeight.toFixed(2);
}

function countDuctSizes(ducts) {
  const counts = {};
  ducts.forEach(d => {
    counts[d.label] = (counts[d.label] || 0) + 1;
  });
  return counts;
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [blueprintText, setBlueprintText] = useState("");
  const [ductSizes, setDuctSizes] = useState({});
  const [ductWeight, setDuctWeight] = useState(null);

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
    const ducts = extractDuctSizes(text);
    const ductCounts = countDuctSizes(ducts);
    const lbs = estimateDuctWeight(ducts);
    setBlueprintText(text);
    setDuctSizes(ductCounts);
    setDuctWeight(lbs);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1>HVAC Estimator – Ductwork by Pounds</h1>

      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Login with Google</button>}

      <input placeholder="Project Name" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} />
      <input placeholder="Location" value={project.location} onChange={e => setProject({ ...project, location: e.target.value })} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => setProject({ ...project, squareFootage: e.target.value })} />
      <input placeholder="Floors" value={project.floors} onChange={e => setProject({ ...project, floors: e.target.value })} />

      <h3>Upload Blueprint PDF</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      {ductWeight && (
        <div style={{ background: "#f5f5f5", padding: "1rem", marginTop: "1rem", borderRadius: "8px" }}>
          <h4>📦 Duct Summary</h4>
          <p><strong>Estimated Duct Weight:</strong> {ductWeight} lbs</p>
          <h5>Duct Size Breakdown:</h5>
          <ul>
            {Object.entries(ductSizes).map(([size, count]) => (
              <li key={size}>{size}: {count}</li>
            ))}
          </ul>
        </div>
      )}

      <h4>Raw Extracted Text</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} rows={6} />
    </div>
  );
}
