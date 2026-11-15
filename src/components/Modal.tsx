import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#FAF8F5] rounded-3xl border-[3px] border-stone-400 shadow-[0_24px_60px_rgba(0,0,0,0.4)] max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-white border-b-2 border-stone-200">
          <h2 className="text-lg font-black text-stone-900 min-w-0 break-words leading-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 border border-stone-300 flex items-center justify-center text-stone-800 shrink-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 pb-5 overflow-y-auto space-y-3">{children}</div>
      </div>
    </div>
  );
}
