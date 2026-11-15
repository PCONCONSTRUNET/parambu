import React, { useRef, useState } from 'react';
import { Camera, Trash2, Loader2 } from 'lucide-react';
import { uploadPhoto } from '../lib/api';
import { useFeedback } from './FeedbackContext';

interface ImageUploadProps {
  label?: string;
  value: string | null;
  onChange: (url: string | null) => void;
}

export function ImageUpload({ label = 'Foto (opcional)', value, onChange }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const { showError } = useFeedback();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(file);
      onChange(url);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <label className="block text-base font-bold text-stone-800 mb-1.5">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFile}
        className="hidden"
      />
      {value ? (
        <div className="p-3 rounded-2xl border-2 border-stone-300 bg-white space-y-2.5">
          <div className="w-full h-32 rounded-xl bg-stone-50 border border-stone-200 p-1.5 flex items-center justify-center overflow-hidden">
            <img
              src={value}
              alt="Foto escolhida"
              className="w-full h-full object-contain rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="py-2.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 font-bold text-stone-800 text-sm text-center"
            >
              Trocar foto
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="py-2.5 px-3 rounded-xl bg-red-50 hover:bg-red-100 border-2 border-red-300 text-red-700 font-bold text-sm flex items-center justify-center gap-1"
            >
              <Trash2 className="w-4 h-4" /> Tirar foto
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full py-5 px-4 rounded-2xl border-2 border-dashed border-stone-300 bg-white hover:bg-stone-50 flex items-center justify-center gap-2 text-stone-700 font-bold text-base"
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Enviando foto...
            </>
          ) : (
            <>
              <Camera className="w-6 h-6 text-orange-600" /> Tirar ou escolher foto
            </>
          )}
        </button>
      )}
    </div>
  );
}
