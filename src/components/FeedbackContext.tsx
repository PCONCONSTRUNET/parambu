import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react';

type FeedbackKind = 'success' | 'error';

interface FeedbackState {
  id: number;
  kind: FeedbackKind;
  message: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface FeedbackContextValue {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  confirmAction: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<FeedbackState | null>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
  const confirmRef = useRef<PendingConfirm | null>(null);
  confirmRef.current = confirmState;

  const show = useCallback((kind: FeedbackKind, message: string) => {
    const id = Date.now();
    setToast({ id, kind, message });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4000);
  }, []);

  const showSuccess = useCallback((msg: string) => show('success', msg), [show]);
  const showError = useCallback((msg: string) => show('error', msg), [show]);

  const confirmAction = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (confirmRef.current) {
        confirmRef.current.resolve(false);
      }
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const finishConfirm = useCallback((accepted: boolean) => {
    const current = confirmRef.current;
    if (!current) return;
    setConfirmState(null);
    current.resolve(accepted);
  }, []);

  useEffect(() => {
    if (!confirmState) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finishConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [confirmState, finishConfirm]);

  return (
    <FeedbackContext.Provider value={{ showSuccess, showError, confirmAction }}>
      {children}
      {confirmState && (
        <div
          className="fixed inset-0 z-[55] bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => finishConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            className="w-full max-w-sm bg-[#FAF8F5] rounded-3xl border-[3px] border-stone-400 shadow-[0_24px_60px_rgba(0,0,0,0.45)] overflow-hidden animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 px-5 py-4 bg-white border-b-2 border-stone-200">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                    confirmState.tone === 'warning'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {confirmState.tone === 'warning' ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <Trash2 className="w-5 h-5" />
                  )}
                </div>
                <h2
                  id="confirm-modal-title"
                  className="text-lg font-black text-stone-900 min-w-0 break-words leading-tight"
                >
                  {confirmState.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => finishConfirm(false)}
                className="w-10 h-10 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-300 flex items-center justify-center text-stone-700 shrink-0"
                aria-label="Cancelar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <p className="text-sm sm:text-base font-bold text-stone-700 leading-relaxed break-words">
                {confirmState.message}
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => finishConfirm(false)}
                  className="py-3.5 px-4 rounded-2xl bg-white hover:bg-stone-100 border-2 border-stone-300 text-stone-800 font-extrabold text-base"
                >
                  {confirmState.cancelLabel || 'Cancelar'}
                </button>
                <button
                  type="button"
                  onClick={() => finishConfirm(true)}
                  className={`py-3.5 px-4 rounded-2xl text-white font-black text-base shadow-sm ${
                    confirmState.tone === 'warning'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {confirmState.confirmLabel || 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed top-3 left-3 right-3 z-[60] flex justify-center pointer-events-none">
          <div
            role="alert"
            className={`pointer-events-auto flex items-center gap-3 w-full max-w-md rounded-2xl px-4 py-4 shadow-xl border-2 text-base font-bold animate-in fade-in ${
              toast.kind === 'success'
                ? 'bg-emerald-700 text-white border-emerald-900'
                : 'bg-red-700 text-white border-red-900'
            }`}
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 className="w-7 h-7 shrink-0" />
            ) : (
              <AlertCircle className="w-7 h-7 shrink-0" />
            )}
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 rounded-lg hover:bg-white/20"
              aria-label="Fechar aviso"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}
