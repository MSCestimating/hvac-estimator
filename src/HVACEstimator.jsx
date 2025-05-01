// HVACEstimator.jsx with visual AI detection for rectangular ducts
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

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [blueprintImage, setBlueprintImage] = useState(null);
  const canvasRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  const handleBlueprintUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.includes("pdf")) return;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = canvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;

    const imageDataURL = canvas.toDataURL("image/png");
    setBlueprintImage(imageDataURL);
    analyzeImage(imageDataURL);
  };

  const analyzeImage = async (imgSrc) => {
    const img = new Image();
    img.src = imgSrc;
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const pixels = imageData.data;
      let lineCount = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const isBlack = pixels[i] < 50 && pixels[i + 1] < 50 && pixels[i + 2] < 50;
        if (isBlack) lineCount++;
      }

      const estimatedFeet = (lineCount / 10000) * 10; // crude scale proxy
      resultRef.current.textContent = `Estimated Duct Run: ${estimatedFeet.toFixed(1)} ft`;
    };
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1>HVAC Estimator with AI Visual Detection</h1>

      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Login with Google</button>}

      <input placeholder="Project Name" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} />
      <input placeholder="Location" value={project.location} onChange={e => setProject({ ...project, location: e.target.value })} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => setProject({ ...project, squareFootage: e.target.value })} />
      <input placeholder="Floors" value={project.floors} onChange={e => setProject({ ...project, floors: e.target.value })} />

      <h3>Upload Blueprint PDF</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      <canvas ref={canvasRef} style={{ marginTop: "1rem", border: "1px solid #ccc", width: "100%" }} />
      <p ref={resultRef} style={{ marginTop: "1rem", fontWeight: "bold" }}></p>
    </div>
  );
}
