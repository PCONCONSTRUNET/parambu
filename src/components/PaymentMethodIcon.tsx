import { paymentMethodLabel } from '../lib/format';

export type PaymentMethodValue = 'DINHEIRO' | 'PIX' | 'CARTAO';

export const PAYMENT_METHODS: readonly {
  key: PaymentMethodValue;
  label: string;
  iconSrc: string;
  alt: string;
}[] = [
  {
    key: 'DINHEIRO',
    label: 'Dinheiro',
    iconSrc: '/icons/dinheiro.png',
    alt: 'money',
  },
  {
    key: 'PIX',
    label: 'Pix',
    iconSrc: '/icons/pix.png',
    alt: 'pix',
  },
  {
    key: 'CARTAO',
    label: 'Cartão',
    iconSrc: '/icons/cartao.png',
    alt: 'bank-card-back-side',
  },
];

const ICON_MAP: Record<string, { src: string; alt: string }> = {
  DINHEIRO: { src: '/icons/dinheiro.png', alt: 'money' },
  PIX: { src: '/icons/pix.png', alt: 'pix' },
  CARTAO: { src: '/icons/cartao.png', alt: 'bank-card-back-side' },
};

export function PaymentMethodIcon({
  method,
  className = 'w-5 h-5',
  pill = false,
}: {
  method: string;
  className?: string;
  pill?: boolean;
}) {
  const info = ICON_MAP[method];
  if (!info) return null;

  const img = (
    <img
      src={info.src}
      alt={info.alt}
      width={48}
      height={48}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );

  if (!pill) return img;

  return (
    <span className="inline-flex items-center justify-center rounded-lg bg-white/95 p-0.5 shrink-0">
      {img}
    </span>
  );
}

export function PaymentMethodInline({
  method,
  iconClassName = 'w-4 h-4',
}: {
  method: string;
  iconClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <PaymentMethodIcon method={method} className={iconClassName} />
      <span>{paymentMethodLabel(method)}</span>
    </span>
  );
}

export function PaymentMethodSelector({
  value,
  onChange,
  tone = 'green',
  size = 'md',
}: {
  value: PaymentMethodValue;
  onChange: (method: PaymentMethodValue) => void;
  tone?: 'green' | 'orange';
  size?: 'sm' | 'md';
}) {
  const activeClass =
    tone === 'orange'
      ? 'bg-[#EA580C] text-white border-[#EA580C]'
      : 'bg-[#0B4619] text-white border-[#0B4619]';

  const sizeClass =
    size === 'sm' ? 'py-2.5 px-1.5 rounded-xl text-xs sm:text-sm' : 'py-3 px-2 rounded-2xl text-sm sm:text-base';

  return (
    <div className="grid grid-cols-3 gap-2">
      {PAYMENT_METHODS.map((m) => {
        const selected = value === m.key;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className={`${sizeClass} font-extrabold border-2 flex items-center justify-center gap-1.5 transition ${
              selected ? activeClass : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
            }`}
          >
            <PaymentMethodIcon method={m.key} className="w-5 h-5 sm:w-6 sm:h-6" pill={selected} />
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
