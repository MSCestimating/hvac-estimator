// HVACEstimator.jsx - Full AI Blueprint Detection + Rectangular Duct Weight Estimation (AutoBid Logic)
import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.entry';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs
} from 'firebase/firestore';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';

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
  if (!size) return '?';
  if (size.includes('-')) {
    const parts = size.split('-');
    if (parts.length === 2) {
      const whole = parseInt(parts[0]);
      const fraction = parts[1] === '1/4' ? 0.25 : parts[1] === '1/2' ? 0.5 : parts[1] === '3/4' ? 0.75 : 0;
      return (whole + fraction).toFixed(2);
    }
  }
  return size.replace(/[^\d.]/g, '');
}

function estimateRectDuctWeight(width, height, lengthFt, gauge = 26) {
  const sheetThickness = gauge === 26 ? 0.0187 : 0.0239; // inch thickness
  const density = 0.284; // lb/in³ for steel
  const perimeter = 2 * (width + height); // inches
  const areaIn2 = perimeter * 12 * lengthFt;
  const volume = areaIn2 * sheetThickness;
  return volume * density;
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
  const ductWeightMap = {};
  const gauge = 26;
  const rectDucts = [...text.matchAll(/(\d{1,3})\s?[x×X]\s?(\d{1,3})\s*(RECT)?\s*(\d{1,4})\s?(FT|FEET|')/gi)];
  rectDucts.forEach(m => {
    const size = `${m[1]}x${m[2]}`;
    const width = parseInt(m[1]);
    const height = parseInt(m[2]);
    const length = parseInt(m[4]);
    if (!isNaN(width) && !isNaN(height) && !isNaN(length)) {
      ductSizeLengthMap[size] = (ductSizeLengthMap[size] || 0) + length;
      const weight = estimateRectDuctWeight(width, height, length, gauge);
      ductWeightMap[size] = (ductWeightMap[size] || 0) + weight;
    }
  });

  const totalDuctLength = Object.values(ductSizeLengthMap).reduce((a, b) => a + b, 0);
  const totalDuctWeight = Object.values(ductWeightMap).reduce((a, b) => a + b, 0);

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductSizeLengthMap,
    ductWeightMap,
    ductLength: totalDuctLength,
    ductWeight: totalDuctWeight.toFixed(2)
  };
}

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: '', location: '', squareFootage: '', floors: '' });
  const [counts, setCounts] = useState(null);
  const [blueprintText, setBlueprintText] = useState('');

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  const extractPDFText = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str).join(' ');
      fullText += strings + '\n';
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

  return (
    <div style={{ padding: '2rem', maxWidth: 1000, margin: '0 auto' }}>
      <h1>HVAC Estimator</h1>
      {user ? <p>Welcome, {user.displayName}</p> : <button onClick={() => signInWithPopup(auth, provider)}>Login with Google</button>}

      <input placeholder="Project Name" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} />
      <input placeholder="Location" value={project.location} onChange={e => setProject({ ...project, location: e.target.value })} />
      <input placeholder="Square Footage" value={project.squareFootage} onChange={e => setProject({ ...project, squareFootage: e.target.value })} />
      <input placeholder="Floors" value={project.floors} onChange={e => setProject({ ...project, floors: e.target.value })} />

      <h3>Upload Blueprint PDF</h3>
      <input type="file" accept="application/pdf" onChange={handleBlueprintUpload} />

      {counts && (
        <div style={{ background: '#f3f3f3', padding: '1rem', marginTop: '1rem', borderRadius: '8px' }}>
          <h4>📊 Scope Breakdown:</h4>
          <ul>
            <li><strong>Supply Tags:</strong> {counts.airDist.supplyTags}</li>
            <li><strong>Diffusers:</strong> {counts.airDist.diffusers}</li>
            <li><strong>Return Tags:</strong> {counts.airDist.returnTags}</li>
            <li><strong>Grilles:</strong> {counts.airDist.grilles}</li>
            <li><strong>Registers:</strong> {counts.airDist.registers}</li>
            <li><strong>Total Duct Length:</strong> {counts.ductLength} ft</li>
            <li><strong>Total Duct Weight:</strong> {counts.ductWeight} lbs</li>
          </ul>
          <h5>🔧 Equipment</h5>
          <ul>
            {Object.entries(counts.equipmentCounts).map(([key, val]) => <li key={key}>{key}: {val}</li>)}
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

      <h4>Raw Extracted Text (first 1000 chars)</h4>
      <textarea value={blueprintText.slice(0, 1000)} readOnly style={{ width: '100%' }} rows={5} />
    </div>
  );
}
