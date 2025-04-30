import React, { useState, useEffect } from "react";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.entry";
import {
  initializeApp
} from "firebase/app";
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

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [quoteItems, setQuoteItems] = useState([{ description: "Rooftop Unit", qty: 1, unitPrice: 12000, vendor: "", status: "Requested", leadTime: 6 }]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [scopeSummary, setScopeSummary] = useState("");
  const [blueprintText, setBlueprintText] = useState("");
  const [veSuggestions, setVeSuggestions] = useState([]);
  const [laborInputs, setLaborInputs] = useState({
    ductwork: { qty: 0, hrsPerUnit: 0.1, rate: 60 },
    piping: { qty: 0, hrsPerUnit: 0.15, rate: 65 },
    controls: { qty: 0, hrsPerUnit: 0.2, rate: 75 },
    airDist: { qty: 0, hrsPerUnit: 0.05, rate: 55 }
  });

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
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

  const loadEstimates = async () => {
    const snap = await getDocs(collection(db, "estimates"));
    setSavedEstimates(snap.docs.map(doc => doc.data()));
  };

  const loadEstimate = (index) => {
    const est = savedEstimates[index];
    setProject(est.project);
    setQuoteItems(est.quoteItems);
  };

  const handleQuoteUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!selectedCategory || files.length === 0) return alert("Select category + file");
    const added = files.map((f, i) => ({ description: `${selectedCategory} - Quote ${i+1}`, qty: 1, unitPrice: 5000 + i * 500, vendor: "Uploaded", status: "Received", leadTime: 4 }));
    setQuoteItems([...quoteItems, ...added]);
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
    setBlueprintText(text);
    setScopeSummary("AI Summary: Detected text from blueprint. Ready for advanced NLP analysis.");
  };

  const suggestVEOptions = () => {
    const ve = quoteItems.map((item, i) => ({
      original: item.description,
      suggestion: item.description + " (alt brand)",
      savings: Math.floor(item.unitPrice * 0.15)
    }));
    setVeSuggestions(ve);
  };

  const calculateLaborTotal = () => {
    return Object.values(laborInputs).reduce((sum, l) => sum + l.qty * l.hrsPerUnit * l.rate, 0);
  };

  const materialTotal = quoteItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  const laborTotal = calculateLaborTotal();
  const subtotal = materialTotal + laborTotal;
  const markup = 0.15 * subtotal;
  const total = subtotal + markup;
  const marginPercent = ((markup / total) * 100).toFixed(1);
  const maxLeadTime = Math.max(...quoteItems.map(i => i.leadTime || 0));

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text("HVAC Estimate", 20, 20);
    doc.text(`Project: ${project.name}`, 20, 30);
    doc.text(`Location: ${project.location}`, 20, 36);
    doc.text(`Scope Summary: ${scopeSummary}`, 20, 44);

    quoteItems.forEach((item, i) => {
      const y = 52 + i * 6;
      doc.text(`${item.description} - ${item.vendor} | Qty: ${item.qty} | Unit: $${item.unitPrice} | Status: ${item.status}`, 20, y);
    });

    doc.text(`Material: $${materialTotal.toFixed(2)}`, 20, 140);
    doc.text(`Labor: $${laborTotal.toFixed(2)}`, 20, 146);
    doc.text(`Markup (15%): $${markup.toFixed(2)}`, 20, 152);
    doc.text(`Total: $${total.toFixed(2)}`, 20, 158);
    doc.text(`Margin: ${marginPercent}%`, 20, 164);
    doc.text(`Longest Lead Time: ${maxLeadTime} weeks`, 20, 170);

    doc.text("Value Engineering Suggestions:", 20, 180);
    veSuggestions.forEach((v, i) => {
      doc.text(`${v.original} → ${v.suggestion} | Savings: $${v.savings}`, 20, 186 + i * 6);
    });

    doc.save("HVAC_Estimate.pdf");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1>HVAC Estimator Pro</h1>

      {user ? (<><p>Welcome, {user.displayName}</p><button onClick={handleLogout}>Logout</button></>) : (<button onClick={handleLogin}>Login with Google</button>)}

      <input placeholder="Project Name" value={project.name} onChange={e => handleProjectChange("name", e.target.value)} />
      <input placeholder="Location" value={project.location} onChange={e => handleProjectChange("location", e.target.value)} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => handleProjectChange("squareFootage", e.target.value)} />
      <input placeholder="Floors" value={project.floors} onChange={e => handleProjectChange("floors", e.target.value)} />

      <h3>Blueprint Upload for AI Scope Reading</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />
      <p><strong>Scope Summary:</strong> {scopeSummary}</p>
      <textarea rows="6" value={blueprintText.slice(0, 1000)} readOnly style={{ width: "100%" }} />

      <!-- rest unchanged -->
    </div>
  );
}


