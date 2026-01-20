import { useState, useEffect, useCallback } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, signInWithGoogle, completeRedirectSignIn, signOutUser } from '../firebase';

interface UseAuthReturn {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Authentication handler
  const signIn = useCallback(async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(String(err));
    }
  }, []);

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
      // Only set error for actual auth errors, not null results
      if (e && typeof e === 'object' && 'code' in e) {
        setError(String(e));
      }
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
      setError(null); // Clear auth errors on successful auth
    });

    return () => unsubscribe();
  }, []);

  return { user, loading, error, signIn, signOut };
}
