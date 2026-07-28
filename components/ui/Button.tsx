/**
 * Button — the three variants used across the kiosk.
 *
 * primary   accent fill, layered shadow, lifts on hover
 * secondary white glass with a hairline
 * ghost     transparent until hovered
 *
 * Heights are one step up from web defaults (44/52/60) because every tap here
 * happens on a touchscreen with a queue behind it.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-5 text-sm gap-1.5',
  md: 'min-h-13 px-7 text-[0.95rem] gap-2',
  lg: 'min-h-15 px-9 text-base gap-2.5',
};

const BASE =
  'inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-150 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px';

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-[var(--accent)] text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_8px_24px_rgba(225,38,47,0.28)] ' +
      'hover:bg-[var(--accent-hover)] hover:-translate-y-px ' +
      'hover:shadow-[0_2px_4px_rgba(11,10,12,0.2),0_12px_30px_rgba(225,38,47,0.34)]',
    secondary:
      'border border-[var(--border)] bg-white/70 text-[var(--ink-2)] backdrop-blur-xl ' +
      'shadow-[0_1px_2px_rgba(11,10,12,0.05)] hover:border-[var(--ink)] hover:text-[var(--ink)]',
    ghost:
      'text-[var(--ink-2)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:text-[var(--accent)]',
  };

  return (
    <button
      className={`${BASE} ${SIZES[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
