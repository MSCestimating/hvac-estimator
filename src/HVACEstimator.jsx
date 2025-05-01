// HVACEstimator.jsx — with enhanced tag detection for equipment summary
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
  const [quoteItems, setQuoteItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [scopeSummary, setScopeSummary] = useState("");
  const [equipmentSummary, setEquipmentSummary] = useState("");
  const [blueprintText, setBlueprintText] = useState("");
  const [veSuggestions, setVeSuggestions] = useState([]);
  const [laborInputs, setLaborInputs] = useState({
    ductwork: { qty: 1000, hrsPerUnit: 0.1, rate: 60 },
    piping: { qty: 0, hrsPerUnit: 0.15, rate: 65 },
    controls: { qty: 0, hrsPerUnit: 0.2, rate: 75 },
    airDist: { qty: 0, hrsPerUnit: 0.05, rate: 55 }
  });

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  const handleLogin = async () => await signInWithPopup(auth, provider);
  const handleLogout = async () => await signOut(auth);
  const handleProjectChange = (field, value) => setProject({ ...project, [field]: value });

  const handleItemChange = (index, field, value) => {
    const updated = [...quoteItems];
    updated[index][field] = field === "qty" || field === "unitPrice" || field === "leadTime" ? Number(value) : value;
    setQuoteItems(updated);
  };

  const addItem = () => setQuoteItems([...quoteItems, { description: "", qty: 0, unitPrice: 0, vendor: "", status: "Requested", leadTime: 0 }]);
  const removeItem = (i) => setQuoteItems(quoteItems.filter((_, idx) => i !== idx));

  const saveEstimate = async () => {
    if (!user) return alert("Login required");
    await addDoc(collection(db, "estimates"), { project, quoteItems, user: user.email, timestamp: new Date() });
    alert("Saved to Firebase!");
  };

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
    const parsed = simulateDomainHVACEstimator(text);
    setBlueprintText(text);
    setScopeSummary(parsed.summaryText);
    setEquipmentSummary(parsed.tagSummary);
  };

  const suggestVEOptions = () => {
    const ve = quoteItems.map((item) => ({
      original: item.description,
      suggestion: item.description + " (alt brand)",
      savings: Math.floor(item.unitPrice * 0.15)
    }));
    setVeSuggestions(ve);
  };

  const materialTotal = quoteItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  const laborTotal = Object.values(laborInputs).reduce((sum, l) => sum + l.qty * l.hrsPerUnit * l.rate, 0);
  const subtotal = materialTotal + laborTotal;
  const markup = 0.15 * subtotal;
  const total = subtotal + markup;

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1>HVAC Estimator Pro</h1>

      {user ? (<><p>Welcome, {user.displayName}</p><button onClick={handleLogout}>Logout</button></>) : (<button onClick={handleLogin}>Login with Google</button>)}

      <input placeholder="Project Name" value={project.name} onChange={e => handleProjectChange("name", e.target.value)} />
      <input placeholder="Location" value={project.location} onChange={e => handleProjectChange("location", e.target.value)} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => handleProjectChange("squareFootage", e.target.value)} />
      <input placeholder="Floors" value={project.floors} onChange={e => handleProjectChange("floors", e.target.value)} />

      <h3>Blueprint Upload</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />
      <h4>Detected Equipment:</h4>
      <pre>{equipmentSummary}</pre>
      <h4>Scope of Work:</h4>
      <pre style={{ background: "#f8f8f8", padding: "1rem" }}>{scopeSummary}</pre>

      <textarea rows="6" value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%", marginBottom: "1rem" }} />

      <h3>Quote Line Items</h3>
      {quoteItems.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input value={item.description} onChange={e => handleItemChange(i, "description", e.target.value)} placeholder="Description" />
          <input type="number" value={item.qty} onChange={e => handleItemChange(i, "qty", e.target.value)} placeholder="Qty" />
          <input type="number" value={item.unitPrice} onChange={e => handleItemChange(i, "unitPrice", e.target.value)} placeholder="Unit Price" />
          <input value={item.vendor} onChange={e => handleItemChange(i, "vendor", e.target.value)} placeholder="Vendor" />
          <input value={item.status} onChange={e => handleItemChange(i, "status", e.target.value)} placeholder="Status" />
          <input type="number" value={item.leadTime} onChange={e => handleItemChange(i, "leadTime", e.target.value)} placeholder="Lead Time" />
          <button onClick={() => removeItem(i)}>Remove</button>
        </div>
      ))}
      <button onClick={addItem}>Add Item</button>

      <h3>Labor Inputs</h3>
      {Object.entries(laborInputs).map(([key, val]) => (
        <div key={key}>
          <strong>{key}</strong>
          <input type="number" value={val.qty} onChange={e => setLaborInputs({ ...laborInputs, [key]: { ...val, qty: +e.target.value } })} placeholder="Qty" />
          <input type="number" value={val.hrsPerUnit} onChange={e => setLaborInputs({ ...laborInputs, [key]: { ...val, hrsPerUnit: +e.target.value } })} placeholder="Hours/Unit" />
          <input type="number" value={val.rate} onChange={e => setLaborInputs({ ...laborInputs, [key]: { ...val, rate: +e.target.value } })} placeholder="Rate/hr" />
        </div>
      ))}

      <button onClick={suggestVEOptions}>Suggest VE</button>
      {veSuggestions.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h4>Value Engineering Suggestions</h4>
          <ul>
            {veSuggestions.map((v, i) => (
              <li key={i}>{v.original} → {v.suggestion} — Save ${v.savings}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>Summary</h3>
      <p>Material Total: ${materialTotal.toFixed(2)}</p>
      <p>Labor Total: ${laborTotal.toFixed(2)}</p>
      <p>Markup: ${(markup).toFixed(2)}</p>
      <p><strong>Total: ${total.toFixed(2)}</strong></p>

      <button onClick={saveEstimate}>Save Estimate</button>
    </div>
  );
}
