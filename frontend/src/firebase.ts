// frontend/src/firebase.ts

import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
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

// Google provider
const googleProvider = new GoogleAuthProvider();

/**
 * Sign in using Google popup
 */
export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

/**
 * Sign out current user
 */
export async function signOutUser() {
  return signOut(auth);
}
