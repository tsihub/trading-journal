// This file makes the app save its data ONLINE (Firebase) instead of
// just on one device, so the same data shows up on your phone AND
// computer. You don't need to understand this file — just fill in
// src/firebase-config.js with your own project keys (see README.md).

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteField } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const urlParams = new URLSearchParams(window.location.search);

// If someone opened a "view-only" link (?view=readonly&code=XYZ), use that
// code straight away and mark the app read-only — no prompt needed.
export const IS_READ_ONLY = urlParams.get("view") === "readonly";
const urlCode = urlParams.get("code");

// A "Sync Code" is a word/PIN you make up. Enter the SAME code on every
// device (phone, computer, etc.) and they'll all share the same data.
function getSyncCode() {
  if (urlCode) {
    localStorage.setItem("rrj-sync-code", urlCode);
    return urlCode;
  }
  let code = localStorage.getItem("rrj-sync-code");
  if (!code) {
    const entered = window.prompt(
      "Enter a Sync Code to link your devices.\n\n" +
      "First time ever? Make up any word or PIN (e.g. \"mytrades2026\") and remember it.\n\n" +
      "Already have a code from another device? Enter that exact code now so this device shows the same data."
    );
    code = (entered && entered.trim()) || "default";
    localStorage.setItem("rrj-sync-code", code);
    window.alert(
      "Your Sync Code is:\n\n" + code + "\n\n" +
      "Write it down. Enter this EXACT code when you open the app on any other device."
    );
  }
  return code;
}

export const SYNC_CODE = getSyncCode();
const docRef = doc(db, "journals", SYNC_CODE);

window.storage = {
  async get(key) {
    const snap = await getDoc(docRef);
    const data = snap.exists() ? snap.data() : null;
    if (!data || data[key] === undefined) {
      throw new Error("Key not found: " + key);
    }
    return { key, value: data[key], shared: false };
  },
  async set(key, value) {
    if (IS_READ_ONLY) return { key, value, shared: false }; // safety net, UI already blocks edits
    await setDoc(docRef, { [key]: value }, { merge: true });
    return { key, value, shared: false };
  },
  async delete(key) {
    if (IS_READ_ONLY) return { key, deleted: false, shared: false };
    await setDoc(docRef, { [key]: deleteField() }, { merge: true });
    return { key, deleted: true, shared: false };
  },
  async list(prefix) {
    const snap = await getDoc(docRef);
    const data = snap.exists() ? snap.data() : {};
    const keys = Object.keys(data).filter((k) => !prefix || k.startsWith(prefix));
    return { keys, prefix, shared: false };
  },
};
