import { useState } from 'react';
import { Check, Copy, DownloadSimple } from '@phosphor-icons/react';
import BrandMark from '@/components/ui/BrandMark';
import CropCard from '@/components/features/crop-card/CropCard';
import { cardSrc, useCard } from '@/components/features/crop-card/useCard';

interface DownloadPageProps {
  token: string;
}

const DEFAULT_LINKEDIN_TEXT = `Just had an incredible AI Learning Journey at Singapore Polytechnic!

The Data Science & Analytics Centre showed me how artificial intelligence is transforming education and industry, from machine learning fundamentals to real-world applications.

A huge thank you to the SP DSAC team for an unforgettable experience!

#AILearningJourney #SingaporePolytechnic #DSAC #ArtificialIntelligence #MachineLearning #FutureOfLearning`;

export default function DownloadPage({ token }: DownloadPageProps) {
  // /api/download sends Content-Disposition: attachment (for the Save button);
  // /api/preview serves the same bytes inline, which is what an <img> needs.
  const downloadHref = `/api/download/${encodeURIComponent(token)}`;
  const previewHref = `/api/preview/${encodeURIComponent(token)}`;

  const [copied, setCopied] = useState(false);
  /**
   * The caption is a starting point, not a script. Guests were copying it
   * verbatim or not at all; letting them edit it in place is the difference
   * between a post that sounds like them and one that sounds like a form.
   * Deliberately not persisted — it belongs to this photo and this guest.
   */
  const [caption, setCaption] = useState(DEFAULT_LINKEDIN_TEXT);

  const { enabled: cardEnabled, card, event, faces, upload } = useCard(token);
  const [cardError, setCardError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCard = async (blob: Blob) => {
    setBusy(true);
    setCardError(null);
    try {
      await upload(blob);
    } catch (err) {
      setCardError(err instanceof Error ? err.message : 'Could not save your card.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(caption).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main
      data-testid="download-page-root"
      className="grid min-h-dvh bg-[#f6f6f7] text-[#18181b] md:grid-cols-[1fr_400px]"
    >
      <section className="flex items-center justify-center bg-[#0a0a0b] p-4 md:p-6">
        <img
          data-testid="download-page-photo"
          src={previewHref}
          alt="Your event photo"
          className="max-h-[86dvh] max-w-full rounded-lg object-contain shadow-[0_20px_70px_rgba(0,0,0,0.4)]"
        />
      </section>

      <aside className="flex flex-col overflow-y-auto border-l border-[#e5e5e8] bg-white">
        <div className="sticky top-0 z-10 border-b border-[#e5e5e8] bg-white/80 px-6 py-4 backdrop-blur-md">
          <BrandMark />
        </div>

        <div className="flex flex-col gap-6 px-6 py-6">
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Your photo</p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">Save your DSAC photo.</h1>
            <p className="mt-1.5 text-sm leading-6 text-[#52525b]">
              Download your composed event photo. Links are temporary for event use.
            </p>
            <a
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
            </a>
          </section>

          {/*
            Beta, switched on in Settings. Off, none of this renders and the
            page is exactly the download page it has always been.
          */}
          {cardEnabled && (
            <>
          <div className="h-px bg-[#ececee]" />

          {/*
            Make a card of yourself. Offered after the photo, never instead of
            it — a guest who only wants their picture should not have to walk
            past a feature to reach the save button.
          */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Make your card</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Tap yourself in the photo.</h2>
            <p className="mt-1.5 text-sm leading-6 text-[#52525b]">
              You’ll get a card of just you, stamped with the event.
            </p>

            <div className="mt-3">
              <CropCard
                photoSrc={previewHref}
                event={event}
                faces={faces}
                onCard={handleCard}
                busy={busy}
              />
            </div>

            {cardError && (
              <p className="mt-2 text-xs leading-5 text-[#b91c1c]">{cardError}</p>
            )}

            {card?.status === 'ready' && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-[#e5e5e8] bg-[#fafafa] p-3">
                <img
                  src={cardSrc(card.id)}
                  alt="Your card"
                  className="h-24 w-auto rounded shadow-sm"
                />
                <a
                  href={cardSrc(card.id, true)}
                  download
                  data-testid="download-page-save-card"
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#18181b] px-4 text-sm font-semibold text-white transition hover:bg-[#e1262f]"
                >
                  <DownloadSimple className="h-4 w-4" />
                  Save card
                </a>
              </div>
            )}
          </section>
            </>
          )}

          <div className="h-px bg-[#ececee]" />

          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Caption for your post</p>
            <p className="mt-1 text-sm leading-6 text-[#52525b]">
              Edit this however you like, then copy it and paste it into a new
              LinkedIn post along with your photo.
            </p>

            <textarea
              value={caption}
              onChange={(e) => { setCaption(e.target.value); setCopied(false); }}
              rows={7}
              aria-label="Your LinkedIn caption"
              className="mt-3 w-full resize-y rounded-lg border border-[#e5e5e8] bg-[#fafafa] px-3 py-2.5 text-xs leading-5 text-[#3f3f46] outline-none transition focus:border-[#0a66c2] focus:bg-white"
            />

            {caption.trim() !== DEFAULT_LINKEDIN_TEXT.trim() && (
              <button
                type="button"
                onClick={() => { setCaption(DEFAULT_LINKEDIN_TEXT); setCopied(false); }}
                className="mt-1.5 text-[11px] font-semibold text-[#a1a1aa] transition hover:text-[#52525b]"
              >
                Reset to the suggested caption
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#18181b] px-4 text-sm font-semibold text-white transition hover:bg-[#3f3f46] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#18181b] focus-visible:ring-offset-2"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied — now paste it into LinkedIn' : 'Copy caption'}
            </button>
          </section>
        </div>

        <div className="mt-auto border-t border-[#ececee] px-6 py-4">
          <p className="text-xs text-[#a1a1aa]">Powered by SP Data Science and Analytics Centre</p>
        </div>
      </aside>
    </main>
  );
}
