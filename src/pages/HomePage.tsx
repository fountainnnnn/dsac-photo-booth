import { ArrowRight } from 'lucide-react';
import AmbientOrb from '@/components/ui/AmbientOrb';
import SectionHeader from '@/components/ui/SectionHeader';
import GlowCard, { MeshOverlay } from '@/components/ui/GlowCard';
import CursorArrow from '@/components/ui/CursorArrow';

/** The real event frame, shown in the "Add the frame" card. */
const EVENT_FRAME = '/frames/frame-polaroid.svg';

export default function HomePage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-8 py-10">
      <AmbientOrb />

      <img
        src="/sp-dsac-logo.png"
        alt="SP Data Science and Analytics Centre"
        className="dsac-rise h-16 w-auto"
      />

      <SectionHeader
        className="dsac-rise mt-10"
        size="lg"
        eyebrow="AI Learning Journey"
        title={
          <>
            Event photo booth<span className="text-[var(--accent)]">.</span>
          </>
        }
        subtitle="Take a photo, pick a branded frame, and walk away with it on your phone in under a minute."
      />

      {/* The flow, as three cards. Hues rotate so no two neighbours match. */}
      <div className="dsac-rise mt-12 grid w-full max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1 — the camera stage */}
        <GlowCard hue={0} label="Strike a pose" chip={<Chip>Step 1</Chip>} className="h-[300px]">
          <MeshOverlay />
          <div className="absolute inset-x-6 top-6 bottom-[76px]">
            <div className="relative h-full w-full overflow-hidden rounded-xl bg-[var(--stage)] shadow-[0_8px_24px_-8px_rgba(11,10,12,0.45)]">
              <Brackets />
              <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-md border border-white/15 bg-black/35 px-2 py-1 backdrop-blur-md">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                  style={{ animation: 'dsac-live-pulse 2s ease-in-out infinite' }}
                />
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/80">
                  Live
                </span>
              </div>
              {/* Shutter ring */}
              <div className="absolute bottom-3 left-1/2 h-9 w-9 -translate-x-1/2 rounded-full border-2 border-white/70 p-[3px]">
                <div className="h-full w-full rounded-full bg-white" />
              </div>
            </div>
          </div>
        </GlowCard>

        {/* 2 — the real frame asset */}
        <GlowCard hue={1} label="Add the frame" chip={<Chip>Step 2</Chip>} className="h-[300px]">
          <div className="absolute inset-x-6 top-7 bottom-[76px] flex items-center justify-center">
            <div
              className="relative w-[88%] overflow-hidden rounded-lg bg-[var(--stage)] shadow-[0_12px_30px_-10px_rgba(11,10,12,0.5)]"
              style={{ aspectRatio: '16 / 9' }}
            >
              <img
                src={EVENT_FRAME}
                alt="The DSAC event frame"
                className="absolute inset-0 h-full w-full"
                draggable={false}
              />
            </div>
          </div>
        </GlowCard>

        {/* 3 — the handoff */}
        <GlowCard hue={2} label="Scan to keep it" chip={<Chip>Step 3</Chip>} className="h-[300px]">
          <MeshOverlay />
          <div className="absolute inset-x-6 top-7">
            <div className="rounded-xl bg-white p-4 text-[0.8rem] leading-[1.6] text-[var(--ink-2)] shadow-[0_6px_20px_-8px_rgba(11,10,12,0.22)]">
              Your photo is{' '}
              <span className="dsac-gradient-text font-semibold">ready to download</span> — the
              private link stays live for 7 days.
            </div>
            <div className="relative mt-5 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-[20px] border border-[var(--ink)] bg-white px-4 py-1.5 text-[0.75rem] font-semibold text-[var(--ink)]">
                <span className="text-[1rem] leading-none text-[var(--accent)]">✦</span>
                Scan to download
              </span>
              <CursorArrow className="absolute -bottom-4 left-[62%]" />
            </div>
          </div>
        </GlowCard>
      </div>

      <a
        href="/capture"
        className="dsac-rise group mt-12 inline-flex min-h-15 items-center justify-center gap-2.5 rounded-xl bg-[var(--accent)] px-10 text-base font-semibold text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_8px_24px_rgba(225,38,47,0.28)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--accent-hover)] hover:shadow-[0_2px_4px_rgba(11,10,12,0.2),0_12px_30px_rgba(225,38,47,0.34)] active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
      >
        Start
        <ArrowRight
          className="h-[18px] w-[18px] transition-transform duration-150 group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </a>

      <p className="mt-8 text-[0.75rem] text-[var(--ink-3)]">
        Singapore Polytechnic · Data Science &amp; Analytics Centre
      </p>
    </main>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-[var(--accent-ink)]">
      {children}
    </span>
  );
}

function Brackets() {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => {
        const isLeft = pos.endsWith('l');
        const isTop = pos.startsWith('t');
        return (
          <span
            key={pos}
            className="pointer-events-none absolute h-4 w-4"
            style={{
              left: isLeft ? 10 : undefined,
              right: !isLeft ? 10 : undefined,
              top: isTop ? 10 : undefined,
              bottom: !isTop ? 10 : undefined,
              borderLeft: isLeft ? '1.5px solid rgba(255,255,255,0.45)' : undefined,
              borderRight: !isLeft ? '1.5px solid rgba(255,255,255,0.45)' : undefined,
              borderTop: isTop ? '1.5px solid rgba(255,255,255,0.45)' : undefined,
              borderBottom: !isTop ? '1.5px solid rgba(255,255,255,0.45)' : undefined,
            }}
          />
        );
      })}
    </>
  );
}
