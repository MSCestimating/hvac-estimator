// Full HVACEstimator.jsx with GPT-style AI summary from blueprint text
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

// Simulated GPT-style analysis of blueprint text
function getBlueprintInsights(text) {
  const summary = [];
  const rtuCount = (text.match(/RTU/gi) || []).length;
  const fanCount = (text.match(/fan/gi) || []).length;
  const zoneCount = (text.match(/zone/gi) || []).length;
  const ductEstimate = text.length > 500 ? 1000 : 300;
  if (rtuCount) summary.push(`Detected ${rtuCount} Rooftop Units (RTUs)`);
  if (fanCount) summary.push(`Detected ${fanCount} Fans`);
  if (zoneCount) summary.push(`Detected ${zoneCount} Zones`);
  summary.push(`Estimated Ductwork: ${ductEstimate} ft`);
  if (summary.length === 0) summary.push("No major HVAC components detected in blueprint text.");
  return summary.join("\n");
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [quoteItems, setQuoteItems] = useState([{ description: "Rooftop Unit", qty: 1, unitPrice: 12000, vendor: "", status: "Requested", leadTime: 6 }]);
  const [scopeSummary, setScopeSummary] = useState("");
  const [blueprintText, setBlueprintText] = useState("");

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
  }, []);

  const handleLogin = async () => await signInWithPopup(auth, provider);
  const handleLogout = async () => await signOut(auth);
  const handleProjectChange = (field, value) => setProject({ ...project, [field]: value });

  const extractPDFText = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str);
      fullText += strings.join(" ") + "\n";
    }
    return fullText;
  };

  const handleBlueprintUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await extractPDFText(file);
    const summary = getBlueprintInsights(text);
    setBlueprintText(text);
    setScopeSummary(summary);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1>HVAC Estimator AI</h1>

      {user ? (
        <>
          <p>Welcome, {user.displayName}</p>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <button onClick={handleLogin}>Login with Google</button>
      )}

      <input placeholder="Project Name" value={project.name} onChange={e => handleProjectChange("name", e.target.value)} />
      <input placeholder="Location" value={project.location} onChange={e => handleProjectChange("location", e.target.value)} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => handleProjectChange("squareFootage", e.target.value)} />
      <input placeholder="Floors" value={project.floors} onChange={e => handleProjectChange("floors", e.target.value)} />

      <h3>Blueprint Upload</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      <p><strong>AI Scope Summary:</strong></p>
      <pre style={{ background: "#f4f4f4", padding: "1rem" }}>{scopeSummary}</pre>

      <h4>Extracted Text (Preview):</h4>
      <textarea
        rows="6"
        value={blueprintText.slice(0, 1000)}
        readOnly
        style={{ width: "100%", marginBottom: "2rem" }}
      />
    </div>
  );
}
