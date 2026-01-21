// frontend/src/firebase.ts

import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type UserCredential,
} from "firebase/auth";

// Firebase configuration (public-safe)
const firebaseConfig = {
  apiKey: "AIzaSyDCG9iB4_TlRthf8Er5RqCsqo_uQj9eH9A",
  authDomain: "photo-app-f8102.firebaseapp.com",
  projectId: "photo-app-f8102",
  storageBucket: "photo-app-f8102.firebasestorage.app",
  messagingSenderId: "215545346854",
  appId: "1:215545346854:web:e6eda35d274e80cd3b9fe7",
  measurementId: "G-CGF3CVN02E",
};

// Initialize Firebase (singleton)
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export async function completeRedirectSignIn(): Promise<UserCredential | null> {
  // Call once on app load to finish a redirect flow
  return await getRedirectResult(auth);
}

export async function signInWithGoogle(): Promise<UserCredential> {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;

    // COOP can cause Firebase to think the popup was closed.
    if (code === "auth/popup-closed-by-user" || code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
      // Redirect happens; this promise won't resolve in the current page.
      return new Promise<UserCredential>(() => {});
    }

    throw err;
  }
}


/**
 * Sign out current user
 */
export async function signOutUser() {
  return signOut(auth);
}
