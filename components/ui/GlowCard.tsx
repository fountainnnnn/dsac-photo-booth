/**
 * GlowCard — the content container the whole system is built from.
 *
 * A top-heavy radial glow that fully resolves to the card base by 60%, so the
 * label at the bottom always sits on flat color. `hue` rotates the pairing
 * between adjacent cards; pass the array index and neighbours never match.
 */

const HUE_PAIRS = [
  ['var(--glow-rose)', 'var(--glow-amber)'],
  ['var(--glow-amber)', 'var(--glow-iris)'],
  ['var(--glow-iris)', 'var(--glow-rose)'],
] as const;

export interface GlowCardProps {
  /** Index into the hue rotation — pass the card's position in its grid. */
  hue?: number;
  /** Bottom label. Omit for a card that is purely a visual bed. */
  label?: React.ReactNode;
  /** Small chip shown inline beside the label (STEP 1, LIVE, …). */
  chip?: React.ReactNode;
  /** Everything layered above the glow and below the label. */
  children?: React.ReactNode;
  /** Tailwind height utility — cards are ~340px by default. */
  className?: string;
  style?: React.CSSProperties;
}

export default function GlowCard({
  hue = 0,
  label,
  chip,
  children,
  className = '',
  style,
}: GlowCardProps) {
  const [h1, h2] = HUE_PAIRS[hue % HUE_PAIRS.length];

  return (
    <div
      className={`relative flex min-w-0 flex-col justify-end overflow-hidden rounded-[20px] text-left ${className}`}
      style={{
        background: 'var(--card)',
        boxShadow: '0 10px 30px -10px rgba(11, 10, 12, 0.12)',
        ...style,
      }}
    >
      {/* Top glow — resolved to the base color well before the label */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 0%, color-mix(in srgb, ${h1} 26%, var(--card)) 0%, color-mix(in srgb, ${h2} 16%, var(--card)) 30%, var(--card) 60%, var(--card) 100%)`,
        }}
      />

      {children}

      {label && (
        <h3 className="relative z-[2] flex min-w-0 items-center gap-2 p-6 text-[1.05rem] font-semibold text-[var(--ink)]">
          <span className="min-w-0 truncate">{label}</span>
          {chip}
        </h3>
      )}
    </div>
  );
}

/** Faint grid texture for use under a centered visual inside a card. */
export function MeshOverlay() {
  const mask = 'radial-gradient(circle at center top, black 0%, transparent 80%)';
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          'linear-gradient(0deg, rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  );
}
