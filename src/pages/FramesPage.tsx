import { useCallback, useEffect, useState } from 'react';
import { ArrowsOut, Camera, Eye, LockSimple, X } from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import { useFrameCatalogue } from '@/components/features/frames/useFrameCatalogue';
import type { FrameConfig } from '@/types/frame';

/**
 * Frames — the whole catalogue at a readable size, any one of which opens
 * full screen.
 *
 * Browsing only. The live frame is chosen in Settings, never here, so nothing
 * on this page changes what ends up on a photo.
 */
export default function FramesPage() {
  const { frames, loading } = useFrameCatalogue();
  const [zoomed, setZoomed] = useState<FrameConfig | null>(null);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  const navigate = useCallback((section: StudioSection) => {
    window.location.href = section === 'settings' ? '/settings'
      : section === 'gallery' ? '/gallery'
      : section === 'frames' ? '/frames'
      : '/capture';
  }, []);

  const inWheel = frames.filter(f => f.enabled !== false);

  return (
    <StudioShell active="frames" onNavigate={navigate}>
      <header className="flex shrink-0 items-center gap-6">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            Frames<span className="text-[var(--accent)]">.</span>
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-[0.85rem] text-[var(--ink-2)]">
            <Eye size={16} />
            {inWheel.length} in the wheel · browsing only, frames are won by spinning
          </p>
        </div>

        <a href="/capture"
          className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-[0.85rem] font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2">
          <Camera size={17} weight="fill" />
          Back to camera
        </a>
      </header>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-[0.85rem] text-[var(--ink-3)]">Loading frames…</p>
        ) : (
          <div className="grid grid-cols-2 gap-6 xl:grid-cols-3">
            {frames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                onClick={() => setZoomed(frame)}
                className="group flex flex-col overflow-hidden rounded-[18px] border border-[var(--border)] text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--ink-3)] hover:shadow-[0_14px_34px_-16px_rgba(11,10,12,0.3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span
                  className="relative block w-full overflow-hidden"
                  style={{ aspectRatio: '1921 / 1201', background: '#8a8f8a' }}
                >
                  <img src={frame.src} alt={`${frame.label} frame`} draggable={false}
                    className="absolute inset-0 h-full w-full" />
                  <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100">
                    <ArrowsOut size={17} />
                  </span>
                  {frame.enabled === false && (
                    <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[0.7rem] font-semibold text-white backdrop-blur-sm">
                      Not in the wheel
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-2 px-4 py-3">
                  <span className="flex items-center gap-1.5 truncate text-[0.95rem] font-semibold text-[var(--ink)]">
                    {frame.label}
                    {frame.builtIn && <LockSimple size={13} className="text-[var(--ink-3)]" />}
                  </span>
                  <span className="ml-auto shrink-0 text-[0.75rem] text-[var(--ink-3)]">
                    {frame.dateStamp ? 'stamps the date' : 'no date'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen viewer */}
      {zoomed && (
        <div
          role="dialog" aria-modal="true" aria-label={`${zoomed.label} frame, full screen`}
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 p-8"
          style={{ background: 'color-mix(in srgb, var(--stage) 90%, transparent)', backdropFilter: 'blur(10px)' }}
        >
          <button
            type="button" onClick={() => setZoomed(null)} aria-label="Close"
            className="absolute right-7 top-7 flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 text-white/75 transition hover:border-white/45 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X size={20} />
          </button>

          <img
            src={zoomed.src}
            alt={`${zoomed.label} frame`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[78vh] max-w-full rounded-[14px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
            style={{ background: '#8a8f8a' }}
          />

          <div className="text-center">
            <p className="text-[1.15rem] font-semibold text-white">{zoomed.label}</p>
            <p className="mt-1 text-[0.8rem] text-white/55">
              Frames are won on the wheel — this is just a closer look. Press Esc to close.
            </p>
          </div>
        </div>
      )}
    </StudioShell>
  );
}
