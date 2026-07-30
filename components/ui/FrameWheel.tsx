import { useCallback, useRef, useState } from 'react';
import { Dices } from 'lucide-react';
import type { FrameConfig } from '@/types/frame';

/**
 * FrameWheel — the frame is decided by chance, not chosen, so the pick gets a
 * spin instead of a dropdown.
 *
 * The winner is drawn up front with Math.random() and the wheel is then rotated
 * to land on it. Deciding from the final rotation instead would let a rounding
 * error at a segment boundary disagree with what the user sees.
 */

const SEGMENT_FILLS = [
  ['#1f8f88', '#0f6f6a'],
  ['#e1262f', '#b4171f'],
  ['#f0a020', '#c97c0d'],
  ['#5b62d6', '#3f45a8'],
];

const SPIN_MS = 2600;
const FULL_TURNS = 4;

export interface FrameWheelProps {
  frames: FrameConfig[];
  active: FrameConfig;
  spinning: boolean;
  onSpinStart: () => void;
  onSpinEnd: (frame: FrameConfig) => void;
}

export default function FrameWheel({
  frames,
  active,
  spinning,
  onSpinStart,
  onSpinEnd,
}: FrameWheelProps) {
  const [rotation, setRotation] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const segment = 360 / frames.length;

  const spin = useCallback(() => {
    if (spinning || frames.length === 0) return;
    onSpinStart();

    const winner = Math.floor(Math.random() * frames.length);
    // Segment i is centred at i*segment + segment/2, measured clockwise from
    // the top. Rotating by the negative of that brings it under the pointer.
    const landing = -(winner * segment + segment / 2);

    setRotation((prev) => {
      // Always advance forwards past a whole number of turns from where we are.
      const base = Math.ceil(prev / 360) * 360;
      return base + FULL_TURNS * 360 + landing;
    });

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onSpinEnd(frames[winner]), SPIN_MS);
  }, [spinning, frames, segment, onSpinStart, onSpinEnd]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-[148px] w-[148px]">
        {/* Pointer */}
        <div
          aria-hidden
          className="absolute left-1/2 top-[-2px] z-10 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: '9px solid transparent',
            borderRight: '9px solid transparent',
            borderTop: '15px solid var(--ink)',
            filter: 'drop-shadow(0 1px 2px rgba(11,10,12,0.3))',
          }}
        />

        <svg
          viewBox="-100 -100 200 200"
          className="h-full w-full"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            filter: 'drop-shadow(0 6px 18px rgba(11,10,12,0.22))',
          }}
        >
          {frames.map((frame, i) => {
            const [from, to] = SEGMENT_FILLS[i % SEGMENT_FILLS.length];
            // Start at -90deg so segment 0 begins at the top.
            const a0 = ((i * segment - 90) * Math.PI) / 180;
            const a1 = (((i + 1) * segment - 90) * Math.PI) / 180;
            const R = 96;
            const x0 = R * Math.cos(a0), y0 = R * Math.sin(a0);
            const x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
            const largeArc = segment > 180 ? 1 : 0;
            const mid = ((i * segment + segment / 2 - 90) * Math.PI) / 180;
            const lx = R * 0.58 * Math.cos(mid);
            const ly = R * 0.58 * Math.sin(mid);

            return (
              <g key={frame.id}>
                <defs>
                  <linearGradient id={`wheel-seg-${frame.id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor={from} />
                    <stop offset="1" stopColor={to} />
                  </linearGradient>
                </defs>
                <path
                  d={
                    frames.length === 1
                      ? `M0,0 m-${R},0 a${R},${R} 0 1,0 ${R * 2},0 a${R},${R} 0 1,0 -${R * 2},0`
                      : `M 0 0 L ${x0} ${y0} A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1} Z`
                  }
                  fill={`url(#wheel-seg-${frame.id})`}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                />
                {/* Left upright rather than rotated to the segment: with only
                    a couple of wide segments, horizontal text is far easier to
                    read mid-spin than radial text. */}
                <text
                  x={lx}
                  y={ly}
                  fill="#ffffff"
                  fontSize="15"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {frame.label}
                </text>
              </g>
            );
          })}
          <circle r="15" fill="#ffffff" stroke="var(--border)" strokeWidth="2" />
        </svg>
      </div>

      <button
        type="button"
        onClick={spin}
        disabled={spinning}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_6px_18px_rgba(225,38,47,0.26)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
      >
        <Dices className="h-4 w-4" strokeWidth={2} />
        {spinning ? 'Spinning…' : 'Spin for a frame'}
      </button>

      <p aria-live="polite" className="text-[0.6875rem] text-[var(--ink-3)]">
        {spinning ? 'Picking your frame…' : <>Frame: <strong className="font-semibold text-[var(--ink)]">{active.label}</strong></>}
      </p>
    </div>
  );
}
