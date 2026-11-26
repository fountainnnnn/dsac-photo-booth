import { useCallback, useEffect, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import BrandMark from '@/components/ui/BrandMark';

interface DownloadPageProps {
  token: string;
}

export default function DownloadPage({ token }: DownloadPageProps) {
  // /api/download sends Content-Disposition: attachment (for the Save button);
  // /api/preview serves the same bytes inline, which is what an <img> needs.
  const downloadHref = `/api/download/${encodeURIComponent(token)}`;
  const previewHref = `/api/preview/${encodeURIComponent(token)}`;
  const keepHref = `/api/keep/${encodeURIComponent(token)}`;

  // The booth deletes each photo a few minutes after its QR code goes up, so
  // a guest who scans late finds nothing. Say so, rather than show a broken
  // picture and a Save button that downloads an error.
  const [gone, setGone] = useState(false);

  // Whether the guest has let us keep the photo: null, and the box disabled,
  // until the booth answers. If it cannot, unticked, which is the default.
  const [kept, setKept] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(keepHref, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404 || res.status === 410) { setGone(true); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { kept: boolean };
        if (live) setKept(Boolean(data.kept));
      })
      .catch(() => { if (live) setKept(false); });
    return () => { live = false; };
  }, [keepHref]);

  // Saved the moment it is ticked: a guest who ticks it and walks off has
  // still said yes. The box shows what the booth now holds, not what was sent.
  const setKeep = useCallback(async (keep: boolean) => {
    setSaving(true);
    setKeepError(null);
    setKept(keep);
    try {
      const res = await fetch(keepHref, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
      });
      if (res.status === 404 || res.status === 410) { setGone(true); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { kept: boolean; deleted?: boolean };
      setKept(Boolean(data.kept));
      if (data.deleted) setGone(true);
    } catch {
      setKept(!keep);
      setKeepError('Could not save that. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [keepHref]);

  const intro = gone
    ? 'This photo is no longer available: the booth deletes photos a few minutes after they are taken, unless the guest lets us keep them.'
    : kept
      ? 'Download your composed event photo. You have let us keep it, so the booth will not delete it.'
      : 'Download your composed event photo. Save it now: the booth deletes it a few minutes after it is taken.';

  return (
    <main
      data-testid="download-page-root"
      className="grid min-h-dvh bg-[#f6f6f7] text-[#18181b] md:grid-cols-[1fr_400px]"
    >
      <section className="flex items-center justify-center bg-[#0a0a0b] p-4 md:p-6">
        {gone ? (
          <p data-testid="download-page-gone" className="max-w-[30ch] text-center text-sm leading-6 text-white/70">
            This photo has been deleted.
          </p>
        ) : (
          <img
            data-testid="download-page-photo"
            src={previewHref}
            alt="Your event photo"
            onError={() => setGone(true)}
            className="max-h-[86dvh] max-w-full rounded-lg object-contain shadow-[0_20px_70px_rgba(0,0,0,0.4)]"
          />
        )}
      </section>

      <aside className="flex flex-col overflow-y-auto border-l border-[#e5e5e8] bg-white">
        <div className="sticky top-0 z-10 border-b border-[#e5e5e8] bg-white/80 px-6 py-4 backdrop-blur-md">
          <BrandMark />
        </div>

        <div className="flex flex-col gap-6 px-6 py-6">
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Your photo</p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">Save your Open House photo.</h1>
            <p className="mt-1.5 text-sm leading-6 text-[#52525b]">{intro}</p>
            {!gone && <a
              data-testid="download-page-save-btn"
              href={downloadHref}
              // No `download` value: a bare attribute lets the server's
              // Content-Disposition name the file, which is where the
              // timestamp lives. Hard-coding one here would flatten every
              // photo back to the same name.
              download
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#18181b] px-8 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(24,24,27,0.16),0_8px_24px_rgba(24,24,27,0.12)] transition duration-200 hover:bg-[#e1262f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e1262f]"
            >
              <DownloadSimple className="h-4 w-4" />
              Save photo
            </a>}

            {/* Consent, so unticked until the guest ticks it. The whole card
                is the label, so it is an easy target for a thumb. */}
            {!gone && (
              <label
                data-testid="download-page-keep"
                className={`mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors duration-150 ${
                  kept ? 'border-[#e1262f]/40 bg-[#e1262f]/[0.04]' : 'border-[#e5e5e8] hover:border-[#d4d4d8]'
                }`}
              >
                <input
                  type="checkbox"
                  data-testid="download-page-keep-box"
                  checked={kept === true}
                  disabled={kept === null || saving}
                  onChange={(e) => void setKeep(e.target.checked)}
                  aria-describedby="keep-help"
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#e1262f] disabled:cursor-wait"
                />
                <span>
                  <span className="block text-sm font-semibold leading-5">Let us keep this photo</span>
                  <span id="keep-help" className="mt-1 block text-xs leading-5 text-[#71717a]">
                    The booth will not delete it after a few minutes, and it may be
                    shown on the Open House photo wall. Untick to take it back: the
                    photo is then deleted as usual.
                  </span>
                </span>
              </label>
            )}
            <p role="status" aria-live="polite"
              className={`mt-2 min-h-5 text-xs ${keepError ? 'text-[#c81e1e]' : 'text-[#71717a]'}`}>
              {keepError ?? (saving ? 'Saving…' : '')}
            </p>
          </section>
        </div>

        <div className="mt-auto border-t border-[#ececee] px-6 py-4">
          <p className="text-xs text-[#a1a1aa]">Powered by SP Data Science and Analytics Centre</p>
        </div>
      </aside>
    </main>
  );
}
