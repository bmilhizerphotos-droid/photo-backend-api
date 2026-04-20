import React, { useEffect, useState, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'info';

type ToastMessage = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
};

type ToastProps = {
  toast: ToastMessage;
  onRemove: (id: string) => void;
};

function Toast({ toast, onRemove }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger animation
    const timer = setTimeout(() => setIsVisible(true), 10);

    // Auto remove after duration
    const duration = toast.duration || 5000;
    const removeTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onRemove(toast.id), 300); // Wait for animation
    }, duration);

    return () => {
      clearTimeout(timer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onRemove]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onRemove(toast.id), 300);
  };

  const getToastStyles = () => {
    const baseStyles = "flex items-center justify-between p-4 rounded-lg shadow-lg border transition-all duration-300 max-w-md";

    switch (toast.type) {
      case 'success':
        return `${baseStyles} bg-green-50 border-green-200 text-green-800`;
      case 'error':
        return `${baseStyles} bg-red-50 border-red-200 text-red-800`;
      case 'info':
      default:
        return `${baseStyles} bg-blue-50 border-blue-200 text-blue-800`;
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  return (
    <div
      className={`${getToastStyles()} transform transition-transform duration-300 ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className="flex items-center space-x-3">
        <span className="text-lg">{getIcon()}</span>
        <p className="text-sm font-medium">{toast.message}</p>
      </div>
      <button
        onClick={handleClose}
        className="text-gray-400 hover:text-gray-600 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

type ToastContainerProps = {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
};

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

// Toast context and hook
type ToastContextType = {
  showToast: (type: ToastType, message: string, duration?: number) => void;
};

export const ToastContext = React.createContext<ToastContextType | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

type ToastProviderProps = {
  children: React.ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (type: ToastType, message: string, duration?: number) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message, duration }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <UndoToastContainer />
    </ToastContext.Provider>
  );
}

// ── Dark-pill undo toast system ──────────────────────────────────────────────

type UndoToastEntry = {
  id: number;
  message: string;
  undoFn?: () => void;
  exiting: boolean;
};

type UndoToastStore = {
  toasts: UndoToastEntry[];
  show: (msg: string, undoFn?: () => void, duration?: number) => void;
};

// Singleton store so showUndoToast() can be called from anywhere
let _setUndoToasts: React.Dispatch<React.SetStateAction<UndoToastEntry[]>> | null = null;

export function showUndoToast(message: string, undoFn?: () => void, duration = 4500) {
  if (!_setUndoToasts) return;
  const id = Date.now();
  _setUndoToasts((prev) => [...prev, { id, message, undoFn, exiting: false }]);
  setTimeout(() => {
    _setUndoToasts?.((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => _setUndoToasts?.((prev) => prev.filter((t) => t.id !== id)), 320);
  }, duration);
}

function UndoToastContainer() {
  const [toasts, setToasts] = useState<UndoToastEntry[]>([]);

  useEffect(() => {
    _setUndoToasts = setToasts;
    return () => { _setUndoToasts = null; };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 320);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none" }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 16px", borderRadius: 14,
            background: "rgba(15,23,42,0.92)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            color: "white", fontSize: 13, fontWeight: 500,
            pointerEvents: "all", whiteSpace: "nowrap",
            animation: toast.exiting
              ? "undoToastOut 0.3s ease forwards"
              : "undoToastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
            minWidth: 220,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span style={{ flex: 1, color: "rgba(255,255,255,0.9)" }}>{toast.message}</span>
          {toast.undoFn && (
            <button
              onClick={() => { toast.undoFn?.(); dismiss(toast.id); }}
              style={{ fontSize: 13, fontWeight: 700, color: "#818cf8", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", borderRadius: 6 }}
            >
              Undo
            </button>
          )}
          <button
            onClick={() => dismiss(toast.id)}
            style={{ width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)", flexShrink: 0, padding: 0 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
      <style>{`
        @keyframes undoToastIn {
          from { opacity: 0; transform: translateY(12px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes undoToastOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(8px) scale(0.96); }
        }
      `}</style>
    </div>
  );
}