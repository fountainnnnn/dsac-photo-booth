import { useCallback, useEffect, useState } from 'react';
import { Camera, Trash } from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import { readGallery, clearGallery, type GalleryEntry } from '@/components/features/gallery/galleryStore';

export default function GalleryPage() {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);

  useEffect(() => { setEntries(readGallery()); }, []);

  const onClear = useCallback(() => {
    if (!window.confirm('Clear every photo from this kiosk’s gallery?')) return;
    clearGallery();
    setEntries([]);
  }, []);

  const navigate = (section: StudioSection) => {
    window.location.href = section === 'settings' ? '/settings'
      : section === 'gallery' ? '/gallery'
      : '/capture';
  };

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
          {entries.length > 0 && (
            <button type="button" onClick={onClear}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-5 text-[0.85rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              <Trash size={17} />
              Clear
            </button>
          )}
          <a href="/capture"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-[0.85rem] font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2">
            <Camera size={17} weight="fill" />
            Take a photo
          </a>
        </div>
      </header>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[20px]"
            style={{ background: 'var(--shell-bg)' }}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[var(--ink-3)]">
              <Camera size={26} />
            </span>
            <p className="text-[0.95rem] font-semibold text-[var(--ink)]">No photos yet</p>
            <p className="text-[0.82rem] text-[var(--ink-3)]">Captures from this session will show up here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {entries.map((entry) => (
              <figure key={entry.at} className="overflow-hidden rounded-[16px] border border-[var(--border)]">
                <img src={entry.thumb} alt="" className="block w-full" />
                <figcaption className="px-3 py-2 text-[0.72rem] text-[var(--ink-3)]">
                  {new Date(entry.at).toLocaleString('en-SG', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </StudioShell>
  );
}
