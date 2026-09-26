// PASTE YOUR OWN FIREBASE PROJECT KEYS HERE.
// You get these from: Firebase console → gear icon (Project settings) →
// scroll to "Your apps" → the </> (Web) icon → register an app.
// It's completely free. Full instructions are in README.md, Step 5.

export const firebaseConfig = {
  apiKey: "AIzaSyCTYy8P2HdNyhqmgpx7QiJ4hTYtdNxYv2w",
  authDomain: "journal-938b1.firebaseapp.com",
  projectId: "journal-938b1",
  storageBucket: "journal-938b1.firebasestorage.app",
  messagingSenderId: "313800034476",
  appId: "1:313800034476:web:27bc01d45ee2bdda79f709",
};

// This is your ONE permanent account name. It is never typed or
// prompted for — it lives only here, in this file, on the live
// website. Every device that opens the site automatically uses this
// same account, so there is no way to end up on the wrong one.
//
// IMPORTANT — if you already have trades saved (from before this file
// existed), set this to whichever Firestore document name currently
// holds your real data, so you keep using the same account instead of
// starting a new empty one. Check Firebase console → Firestore
// Database → the "journals" collection → the document names there.
export const MY_SYNC_CODE = "trades1914";
