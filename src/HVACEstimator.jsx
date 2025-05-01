// FULL HVACEstimator.jsx with Labor Calculation Integration

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

  const tagMap = {
    RTU: /\bRTU[-\s]?\d+\b/g,
    VAV: /\bVAV[-\s]?\d+\b/g,
    EF: /\bEF[-\s]?\d+\b/g,
    EXFAN: /\bEX(FAN)?[-\s]?\d+\b/g,
    FCU: /\bFCU[-\s]?\d+\b/g,
    MAU: /\bMAU[-\s]?\d+\b/g,
    DOAS: /\bDOAS[-\s]?\d+\b/g,
    AHU: /\bAHU[-\s]?\d+\b/g,
    HP: /\bHP[-\s]?\d+\b/g,
    COND: /\bCOND[-\s]?\d+\b/g,
    OA: /\b(OA|O)[-\s]?\d+\b/g,
    FD: /\bFD[-\s]?\d+\b/g,
    SD: /\bSD[-\s]?\d+\b/g,
    CTRL: /\b(CTRL|BMS)[-\s]?\d*\b/g
  };

  const equipmentCounts = {};
  for (const [key, regex] of Object.entries(tagMap)) {
    const matches = cleanText.match(regex);
    if (matches) equipmentCounts[key] = matches.length;
  }

  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
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

  const ductMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?\bDUCT\b/g)].map(m => parseInt(m[1]));
  const pipeMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?\bPIPE\b/g)].map(m => parseInt(m[1]));
  const dryerExhaustMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?(DRYER VENT|DRYER EXHAUST)\b/g)].map(m => parseInt(m[1]));
  const makeupAirMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?(MAKE[-\s]?UP AIR|MUA|MAU)\b/g)].map(m => parseInt(m[1]));

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductLength: ductMentions.reduce((a, b) => a + b, 0),
    pipeLength: pipeMentions.reduce((a, b) => a + b, 0),
    dryerExhaustLength: dryerExhaustMentions.reduce((a, b) => a + b, 0),
    makeupAirLength: makeupAirMentions.reduce((a, b) => a + b, 0)
  };
}

function calculateLabor(counts, laborRates, ratePerHour) {
  let totalHours = 0;
  let totalCost = 0;
  const laborBreakdown = [];

  const add = (label, qty, hoursPerUnit) => {
    const hours = qty * hoursPerUnit;
    const cost = hours * ratePerHour;
    totalHours += hours;
    totalCost += cost;
    laborBreakdown.push({ label, qty, hoursPerUnit, hours, cost });
  };

  add('Ductwork (ft)', counts.ductLength, laborRates.duct);
  add('Piping (ft)', counts.pipeLength, laborRates.pipe);
  add('Dryer Exhaust (ft)', counts.dryerExhaustLength, laborRates.dryer);
  add('Make-Up Air (ft)', counts.makeupAirLength, laborRates.makeup);

  Object.entries(counts.equipmentCounts).forEach(([key, val]) => {
    const rate = laborRates[key] || 0;
    add(`${key} (qty)`, val, rate);
  });

  return { laborBreakdown, totalHours, totalCost };
}

export default HVACEstimator;
