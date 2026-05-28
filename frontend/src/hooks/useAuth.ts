import { useState, useEffect, useCallback } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, signInWithGoogle, completeRedirectSignIn, signOutUser } from '../firebase';

interface UseAuthReturn {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authentication handler
  const signIn = useCallback(async () => {
    if (signingIn) return;          // prevent double-click
    setSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code ?? '';
      // Redirect/popup transitional states are expected and not user-actionable.
      if (
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/popup-blocked'
      ) {
        return;
      }
      setError(String(err));
    } finally {
      setSigningIn(false);
    }
  }, [signingIn]);

  const signOut = useCallback(async () => {
    try {
      await signOutUser();
    } catch (err) {
      console.error('Error signing out:', err);
    }
  }, []);

  // Authentication state listener
  useEffect(() => {
    // Finish redirect flow if we came back from Google
    completeRedirectSignIn().catch((e) => {
      const code = (e as { code?: string } | null)?.code ?? '';
      if (
        code === 'auth/no-auth-event' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        return;
      }
      if (e && typeof e === 'object' && 'code' in e) setError(String(e));
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
      setError(null); // Clear auth errors on successful auth
    });

    return () => unsubscribe();
  }, []);

  return { user, loading, signingIn, error, signIn, signOut };
}
