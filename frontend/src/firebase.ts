// frontend/src/firebase.ts

import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
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

export async function completeRedirectSignIn(): Promise<UserCredential | null> {
  // Redirect flow is disabled to avoid CSP-unsafe gapi internals.
  return null;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            ux_mode?: "popup" | "redirect";
          }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });

  return gisScriptPromise;
}

async function getGoogleIdToken(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new Error("Missing VITE_GOOGLE_CLIENT_ID");
  }

  await loadGisScript();
  if (!window.google?.accounts?.id) {
    throw new Error("Google Identity Services unavailable");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Google sign-in timed out"));
      }
    }, 60000);

    window.google.accounts.id.initialize({
      client_id: clientId,
      ux_mode: "popup",
      cancel_on_tap_outside: true,
      callback: (response) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        const token = response?.credential;
        if (!token) {
          reject(new Error("No Google credential returned"));
          return;
        }
        resolve(token);
      },
    });

    window.google.accounts.id.prompt();
  });
}

export async function signInWithGoogle(): Promise<UserCredential> {
  const idToken = await getGoogleIdToken();
  const credential = GoogleAuthProvider.credential(idToken);
  return await signInWithCredential(auth, credential);
}


/**
 * Sign out current user
 */
export async function signOutUser() {
  return signOut(auth);
}
