// This file makes the app save its data ONLINE (Firebase) instead of
// just on one device, so the same data shows up on your phone AND
// computer. You don't need to understand this file — just fill in
// src/firebase-config.js with your own project keys (see README.md).
//
// There is ONE fixed account (MY_SYNC_CODE, set in firebase-config.js).
// Nothing is ever typed or prompted for, so a device can never
// accidentally end up pointed at the wrong / an empty account. All of
// your data lives in a single Firestore document at:
//   journals / <MY_SYNC_CODE>
// exactly as it always has — this file does not change where your
// existing data lives, only how new screenshots are stored (see below).
//
// SCREENSHOTS are uploaded to Firebase Storage (a separate service made
// for files/images) instead of being crammed into the database as
// text. Only a small link is saved in the database — the actual image
// lives in Storage. This is what actually fixes the "data too large to
// save" problem, no matter how many screenshots get added.

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteField } from "firebase/firestore";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";
import { firebaseConfig, MY_SYNC_CODE } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const fbStorage = getStorage(app);

const urlParams = new URLSearchParams(window.location.search);

// A "?view=readonly" link puts the app in read-only mode. It always
// points at the SAME fixed account above — there's no separate code to
// get out of sync, so a shared link can never "reset" your own device
// to a different / empty account.
export const IS_READ_ONLY = urlParams.get("view") === "readonly";
export const SYNC_CODE = MY_SYNC_CODE;

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
    if (IS_READ_ONLY) return { key, value, shared: false };
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

// ---- Screenshot upload (goes to Storage, not the database) ----

function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

// Compresses the image, uploads it to Firebase Storage, and returns a
// small download-link string (this is what actually gets saved in the
// trade data — never the raw image itself).
export async function uploadScreenshot(file, label) {
  if (IS_READ_ONLY) throw new Error("View-only mode — uploads are disabled.");
  const dataUrl = await resizeImage(file, 1100, 0.72);
  const path = `screenshots/${SYNC_CODE}/${Date.now()}-${label}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const sref = ref(fbStorage, path);
  await uploadString(sref, dataUrl, "data_url");
  return await getDownloadURL(sref);
}
