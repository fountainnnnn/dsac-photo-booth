import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, DiceFive, X } from '@phosphor-icons/react';
import type { FrameConfig } from '@/types/frame';
import { pickWeighted } from '@/types/frame';

/**
 * FrameWheelModal — the frame is decided by chance, so the pick gets its own
 * card rather than a control tucked in the sidebar.
 *
 * Two independent random steps:
 *
 *   1. WHICH frame wins, drawn from the operator's weights. Segments are all
 *      the same size regardless, so the wheel never reveals that one frame is
 *      rarer than another.
 *   2. WHERE inside that segment the pointer stops, so it never parks
 *      dead-centre and the spin reads as genuine. Kept clear of the segment
 *      edges, where the pointer would look ambiguous.
 *
 * The winner is known before the animation starts and is never read back off
 * the rendered transform, so a rounding error cannot make the wheel disagree
 * with the frame that gets applied.
 */

/** Pastel fills with an ink tone dark enough to read on them. */
const SEGMENT_FILLS = [
  { fill: '#a9e2de', ink: '#0d5b56' }, // mint
  { fill: '#f9c2c6', ink: '#8f1219' }, // blush
  { fill: '#fbe0a6', ink: '#835403' }, // butter
  { fill: '#c6cbf5', ink: '#333a94' }, // periwinkle
];

const SPIN_MS = 4200;
// Enough rotations to read as a real spin at this duration without blurring
// into a smear.
const FULL_TURNS = 7;
/** Keep the pointer at least this far from a segment edge, in degrees. */
const BOUNDARY_GUARD_DEG = 4;

/**
 * Which segment sits under the top pointer at a given rotation.
 *
 * CSS rotation is clockwise, so the content beneath the pointer is at
 * unrotated angle -rotation (mod 360), measured clockwise from the top.
 */
export function segmentAtPointer(rotationDeg: number, count: number) {
  const seg = 360 / count;
  const angle = ((-rotationDeg % 360) + 360) % 360;
  const index = Math.min(count - 1, Math.floor(angle / seg));
  return { index, angle, seg, offsetInSeg: angle % seg };
}

export interface FrameWheelModalProps {
  open: boolean;
  frames: FrameConfig[];
  /** Fired the moment the wheel stops, so the live preview updates behind it. */
  onPicked: (frame: FrameConfig) => void;
  onClose: () => void;
  /**
   * Bumped by the phone remote to start a spin. A counter rather than a
   * boolean so repeated spins each register.
   */
  spinSignal?: number;
  /** Reports spinning/result so the phone can mirror the wheel. */
  onStatus?: (status: { spinning: boolean; result: string | null }) => void;
}

export default function FrameWheelModal({
  open,
  frames,
  onPicked,
  onClose,
  spinSignal = 0,
  onStatus,
}: FrameWheelModalProps) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<FrameConfig | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const segment = frames.length > 0 ? 360 / frames.length : 360;

  useEffect(() => { if (open) setResult(null); }, [open]);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  // Esc always works — a kiosk must never trap someone in a dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !spinning) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, spinning, onClose]);

  const spin = useCallback(() => {
    if (spinning || frames.length === 0) return;
    setSpinning(true);
    setResult(null);

    const base = Math.ceil(rotation / 360) * 360; // always travel forwards
    const n = frames.length;

    // The odds come from the weights; the wheel only has to land there.
    // Segments are all drawn the same size, so nothing on screen betrays that
    // one frame is rarer than another.
    const picked = pickWeighted(frames);
    const winner = Math.max(0, frames.findIndex((f) => f.id === picked?.id));

    // Randomise WHERE inside the winning segment we stop, so the pointer never
    // parks dead-centre and the spin reads as genuine. The guard keeps it clear
    // of the segment edges, where the pointer would look ambiguous.
    const seg = 360 / n;
    const usable = Math.max(0, seg - BOUNDARY_GUARD_DEG * 2);
    const offset = BOUNDARY_GUARD_DEG + Math.random() * usable;
    const landing = -(winner * seg + offset);
    const target = base + FULL_TURNS * 360 + landing;

    setRotation(target);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setSpinning(false);
      setResult(frames[winner]);
      onPicked(frames[winner]);
    }, SPIN_MS);
  }, [spinning, frames, rotation, onPicked]);

  // Let the phone start a spin. Held in a ref so re-rendering never re-fires it.
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const lastSignal = useRef(spinSignal);
  useEffect(() => {
    if (spinSignal === lastSignal.current) return;
    lastSignal.current = spinSignal;
    if (open) spinRef.current();
  }, [spinSignal, open]);

  // Keep the phone's view of the wheel in step with this one.
  useEffect(() => {
    onStatus?.({ spinning, result: result?.label ?? null });
  }, [spinning, result, onStatus]);

  if (!open) return null;

  const R = 96;

  return (
    <div
      data-testid="frame-wheel-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Spin for your frame"
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{
        background: 'color-mix(in srgb, var(--stage) 74%, transparent)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Card */}
      <div
        className="relative flex max-h-full w-full max-w-3xl flex-col items-center overflow-y-auto rounded-[28px] px-10 py-9 text-center"
        style={{
          background: 'var(--background)',
          boxShadow: '0 40px 100px -24px rgba(11,10,12,0.55)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={spinning}
          aria-label="Close"
          className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink-3)] transition hover:bg-[var(--border)] hover:text-[var(--ink)] disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="dsac-gradient-text text-[0.75rem] font-semibold uppercase tracking-[1px]">
          Your frame is up to chance
        </p>
        <h2 className="mt-3 text-[2rem] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--ink)]">
          {result
            ? <>You got {result.label}<span className="text-[var(--accent)]">.</span></>
            : <>Spin the wheel<span className="text-[var(--accent)]">.</span></>}
        </h2>

        {/* Wheel */}
        <div className="relative mt-7" style={{ width: 'min(38vh, 300px)', height: 'min(38vh, 300px)' }}>
          <div
            aria-hidden
            className="absolute left-1/2 top-[-5px] z-10 h-0 w-0 -translate-x-1/2"
            style={{
              borderLeft: '12px solid transparent',
              borderRight: '12px solid transparent',
              borderTop: '21px solid var(--ink)',
              filter: 'drop-shadow(0 2px 4px rgba(11,10,12,0.35))',
            }}
          />
          <svg
            viewBox="-100 -100 200 200"
            className="h-full w-full"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
              filter: 'drop-shadow(0 10px 26px rgba(11,10,12,0.2))',
            }}
          >
            {frames.map((frame, i) => {
              const { fill, ink } = SEGMENT_FILLS[i % SEGMENT_FILLS.length];
              const a0 = ((i * segment - 90) * Math.PI) / 180;
              const a1 = (((i + 1) * segment - 90) * Math.PI) / 180;
              const x0 = R * Math.cos(a0), y0 = R * Math.sin(a0);
              const x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
              const largeArc = segment > 180 ? 1 : 0;

              const midDeg = i * segment + segment / 2 - 90;
              const mid = (midDeg * Math.PI) / 180;
              const lx = R * 0.58 * Math.cos(mid);
              const ly = R * 0.58 * Math.sin(mid);
              // Radial labels, flipped on the left half so they never appear
              // upside down once the wheel has turned.
              const norm = ((midDeg % 360) + 360) % 360;
              const labelDeg = norm > 90 && norm < 270 ? midDeg + 180 : midDeg;

              return (
                <g key={frame.id}>
                  <path
                    d={
                      frames.length === 1
                        ? `M 0 0 m -${R} 0 a ${R} ${R} 0 1 0 ${R * 2} 0 a ${R} ${R} 0 1 0 -${R * 2} 0`
                        : `M 0 0 L ${x0} ${y0} A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1} Z`
                    }
                    fill={fill}
                    stroke="#ffffff"
                    strokeWidth="2.5"
                  />
                  <text
                    x={lx}
                    y={ly}
                    fill={ink}
                    fontSize="13"
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${labelDeg} ${lx} ${ly})`}
                  >
                    {frame.label}
                  </text>
                </g>
              );
            })}
            <circle r="15" fill="#ffffff" stroke="rgba(11,10,12,0.10)" strokeWidth="2" />
          </svg>
        </div>

        {/* The pool — every frame that can come up */}
        <div className="mt-7 w-full">
          <p className="mb-2.5 text-[0.6875rem] font-semibold uppercase tracking-[1px] text-[var(--ink-3)]">
            In the pool
          </p>
          <div className="flex flex-wrap items-start justify-center gap-3">
            {frames.map((frame, i) => {
              const won = result?.id === frame.id;
              return (
                <div key={frame.id} className="flex w-[164px] flex-col items-center gap-1.5">
                  <div
                    className="relative w-full overflow-hidden rounded-xl transition-all duration-200"
                    style={{
                      aspectRatio: '16 / 10',
                      background: '#8a8f8a',
                      outline: won ? '2.5px solid var(--accent)' : '1px solid var(--border)',
                      outlineOffset: won ? '2px' : '0',
                      opacity: result && !won ? 0.4 : 1,
                    }}
                  >
                    <img
                      src={frame.src}
                      alt={`${frame.label} frame`}
                      className="absolute inset-0 h-full w-full"
                      draggable={false}
                    />
                    {won && (
                      <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] shadow">
                        <Check className="h-3 w-3 text-white" />
                      </span>
                    )}
                  </div>
                  <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-[var(--ink-2)]">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: SEGMENT_FILLS[i % SEGMENT_FILLS.length].fill }}
                    />
                    {frame.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={spin}
            disabled={spinning}
            className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-xl bg-[var(--accent)] px-8 text-[0.95rem] font-semibold text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_8px_24px_rgba(225,38,47,0.28)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            <DiceFive className="h-4 w-4" />
            {spinning ? 'Spinning…' : result ? 'Spin again' : 'Spin'}
          </button>

          {result && !spinning && (
            <button
              type="button"
              data-testid="frame-wheel-continue"
              onClick={onClose}
              className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] bg-white px-8 text-[0.95rem] font-semibold text-[var(--ink-2)] transition-all duration-150 hover:border-[var(--ink)] hover:text-[var(--ink)] active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <p aria-live="polite" className="mt-4 h-4 text-[0.75rem] text-[var(--ink-3)]">
          {spinning
            ? 'Picking your frame…'
            : result
              ? 'Your photo will use this frame.'
              : 'Everyone gets a random frame.'}
        </p>
      </div>
    </div>
  );
}
