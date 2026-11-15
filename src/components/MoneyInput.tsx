import { formatMoneyMask } from '../lib/format';

interface MoneyInputProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  required?: boolean;
  helper?: string;
}

export function MoneyInput({
  label,
  value,
  onChange,
  placeholder = '0,00',
  required = false,
  helper = 'Digite só os números (ex: 4000 vira 40,00)',
}: MoneyInputProps) {
  return (
    <div className="min-w-0">
      <label className="block text-sm sm:text-base font-bold text-stone-800 mb-1.5">
        {label} {required && <span className="text-orange-600">*</span>}
      </label>
      <div className="flex items-center rounded-2xl border-2 border-stone-300 bg-white focus-within:border-[#0B4619] overflow-hidden min-w-0">
        <span className="px-2.5 sm:px-3.5 py-3.5 bg-stone-100 text-stone-700 font-extrabold text-sm sm:text-base border-r border-stone-200 select-none shrink-0">
          R$
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(formatMoneyMask(e.target.value))}
          placeholder={placeholder}
          required={required}
          className="min-w-0 flex-1 w-full px-2.5 sm:px-3.5 py-3.5 text-base sm:text-xl font-bold text-stone-900 bg-white focus:outline-none tabular-nums"
        />
      </div>
      {helper && <p className="mt-1 text-xs font-semibold text-stone-500">{helper}</p>}
    </div>
  );
}
