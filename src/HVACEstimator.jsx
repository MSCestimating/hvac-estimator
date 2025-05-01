// Cleaned FULL HVACEstimator.jsx with Enhanced Ductwork Detection (text + dimension based)

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

  const equipmentTags = [...cleanText.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND)[-\s]?\d+\b/g)].map(m => m[0]);
  const equipmentCounts = equipmentTags.reduce((acc, tag) => {
    const key = tag.split(/[-\s]/)[0].toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const pipeSizes = [...cleanText.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
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

  const ductMentions = [
    // Patterns like "50' DUCT" or "25 FT SUPPLY DUCT"
    ...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?DUCT\b/g),
    // Patterns like "QTY 4 — 10 FT DUCT RUNS"
    ...cleanText.matchAll(/QTY\s*(\d+)\D+(\d{1,3})\s?(?:'|FT|FEET)\s+DUCT/gi)
  ].map(m => m.length === 3 ? parseInt(m[1]) * parseInt(m[2]) : parseInt(m[1]));

  const dimDuctRuns = [...cleanText.matchAll(/(\d{1,3})\s?[x×X]\s?(\d{1,3}).*?DUCT/gi)].map(() => 10); // default 10 ft per dim-tag

  const totalDuctLength = [...ductMentions, ...dimDuctRuns].reduce((a, b) => a + b, 0);

  const pipeMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?PIPE\b/g)].map(m => parseInt(m[1]));
  const totalPipeLength = pipeMentions.reduce((a, b) => a + b, 0);

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductLength: totalDuctLength,
    pipeLength: totalPipeLength
  };
}

// Component continues unchanged...
