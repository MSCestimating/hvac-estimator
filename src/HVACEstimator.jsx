// HVACEstimator.jsx with OCR-enhanced image detection and manual scale
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

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [scale, setScale] = useState(0.25);
  const [detectedText, setDetectedText] = useState("");
  const [results, setResults] = useState([]);
  const imageRef = useRef(null);

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      ctx.filter = "grayscale(100%) contrast(200%)";
      ctx.drawImage(img, 0, 0);
      Tesseract.recognize(canvas, "eng").then(({ data: { text } }) => {
        setDetectedText(text);
        const lines = text.match(/\d{1,3}\s?[xX]\s?\d{1,3}/g) || [];
        const parsed = lines.map(line => {
          const [w, h] = line.split(/x/i).map(Number);
          const length = 10; // assumed fixed run for demo
          const weight = calculateRectangularDuctWeight(w, h, length);
          return { size: `${w}x${h}`, length, weight: weight.toFixed(2) };
        });
        setResults(parsed);
      });
    };
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h1>HVAC Estimator – AI OCR Mode</h1>
      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Login</button>}
      <h3>Manual Scale</h3>
      <select onChange={(e) => setScale(parseFloat(e.target.value))} value={scale}>
        <option value={0.125}>1/8" = 1'</option>
        <option value={0.25}>1/4" = 1'</option>
        <option value={0.5}>1/2" = 1'</option>
      </select>
      <h3>Upload Blueprint Image</h3>
      <input type="file" accept="image/*" onChange={handleImageUpload} />
      <div>
        <h4>Detected Duct Sizes</h4>
        <ul>
          {results.map((r, i) => (
            <li key={i}><strong>{r.size}</strong> – {r.length}ft, {r.weight} lbs</li>
          ))}
        </ul>
        <textarea readOnly rows={5} style={{ width: "100%" }} value={detectedText.slice(0, 1000)} />
      </div>
    </div>
  );
}
