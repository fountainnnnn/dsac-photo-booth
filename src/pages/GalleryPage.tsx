import { useCallback, useEffect, useState } from 'react';
import {
  ArrowClockwise, Camera, DownloadSimple, FolderOpen, X,
} from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';

/**
 * Gallery — what the booth has actually shot, read from the server.
 *
 * It used to be localStorage thumbnails, which meant the gallery was per
 * browser profile and lost the moment anyone cleared site data. The photos
 * already live in the database with a download link attached, so the gallery
 * reads those instead: same list the guest's QR points at, survives a reload,
 * and shows the full picture rather than a 360px approximation of it.
 */

interface RecentPhoto {
  token: string;
  createdAt: string;
  src: string;
}

export default function GalleryPage() {
  const [photos, setPhotos] = useState<RecentPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [zoomed, setZoomed] = useState<RecentPhoto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/photos/recent');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { photos: RecentPhoto[] };
      setPhotos(data.photos ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load photos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The folder note is an acknowledgement, not a state — it fades on its own
  // so the header does not accumulate stale messages over an evening.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const openFolder = useCallback(async () => {
    try {
      const res = await fetch('/api/gallery/open-folder', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { dir: string };
      setNote({ kind: 'ok', text: `Opened ${data.dir}` });
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : 'Could not open the folder' });
    }
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  const navigate = (section: StudioSection) => {
    window.location.href = section === 'settings' ? '/settings'
      : section === 'gallery' ? '/gallery'
      : '/capture';
  };

  const stamp = (iso: string) => new Date(iso).toLocaleString('en-SG', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <StudioShell active="gallery" onNavigate={navigate}>
      <header className="flex shrink-0 items-center gap-6">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            Gallery<span className="text-[var(--accent)]">.</span>
          </h1>
          <p className="mt-1 text-[0.85rem] text-[var(--ink-2)]">
            Recent photos from this kiosk. Guests keep their copy via the QR code.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {note && (
            <span className={`max-w-[26rem] truncate text-[0.78rem] font-medium ${
              note.kind === 'ok' ? 'text-[#127a4a]' : 'text-[var(--accent-ink)]'
            }`}>
              {note.text}
            </span>
          )}

          <button type="button" onClick={() => void load()} disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-5 text-[0.85rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <ArrowClockwise size={17} />
            Refresh
          </button>

          <button type="button" onClick={() => void openFolder()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-5 text-[0.85rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <FolderOpen size={17} />
            Open folder
          </button>

          <a href="/capture"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-[0.85rem] font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2">
            <Camera size={17} weight="fill" />
            Take a photo
          </a>
        </div>
      </header>

      {error && (
        <p className="mt-4 shrink-0 rounded-xl border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] px-4 py-3 text-[0.82rem] text-[var(--accent-ink)]">
          Could not load the gallery ({error}). The photos are still on this machine — try Refresh.
        </p>
      )}

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        {photos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[20px]"
            style={{ background: 'var(--shell-bg)' }}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[var(--ink-3)]">
              <Camera size={26} />
            </span>
            <p className="text-[0.95rem] font-semibold text-[var(--ink)]">
              {loading ? 'Loading photos…' : 'No photos yet'}
            </p>
            <p className="text-[0.82rem] text-[var(--ink-3)]">Photos taken at this booth appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {photos.map((photo) => (
              <button
                key={photo.token}
                type="button"
                onClick={() => setZoomed(photo)}
                className="group overflow-hidden rounded-[16px] border border-[var(--border)] text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--ink-3)] hover:shadow-[0_14px_34px_-16px_rgba(11,10,12,0.3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <img src={photo.src} alt="" loading="lazy" className="block w-full" />
                <span className="block px-3 py-2 text-[0.72rem] text-[var(--ink-3)]">
                  {stamp(photo.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen viewer, with the one action worth having here: save a
          copy to this machine's Downloads. */}
      {zoomed && (
        <div
          role="dialog" aria-modal="true" aria-label="Photo, full screen"
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

          {/* The height budget leaves room for everything below the photo —
              the Save button, its caption and the column's gaps — or the
              bottom of the column is pushed off the screen and the photo is
              shoved into the top edge. */}
          <img
            src={zoomed.src}
            alt={`Photo taken ${stamp(zoomed.createdAt)}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[calc(100dvh-11rem)] max-w-[90vw] rounded-[14px] object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
          />

          <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <a
              href={`/api/download/${encodeURIComponent(zoomed.token)}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-[0.85rem] font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <DownloadSimple size={17} />
              Save
            </a>
            <p className="text-[0.8rem] text-white/55">
              {stamp(zoomed.createdAt)} · press Esc to close
            </p>
          </div>
        </div>
      )}
    </StudioShell>
  );
}
