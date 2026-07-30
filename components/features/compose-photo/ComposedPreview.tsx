import { ArrowRight, ArrowCounterClockwise, CircleNotch } from '@phosphor-icons/react';
import AmbientOrb from '@/components/ui/AmbientOrb';
import SectionHeader from '@/components/ui/SectionHeader';
import Button from '@/components/ui/Button';

export interface ComposedPreviewProps {
  /** data URL of the composed JPEG (user photo + DSAC frame) */
  composedDataUrl: string;
  /** ISO timestamp of when the original photo was captured */
  capturedAt: string;
  onContinue: () => void;
  onRetake: () => void;
  /** Whether the composed image is being uploaded */
  isUploading?: boolean;
}

/**
 * ComposedPreview — shows the fully-composed branded photo and lets the user
 * proceed to the download step or retake the shot.
 *
 * The photo is the hero here, so it gets the glow-card treatment one size up:
 * a deep stage bed on the light canvas, header block above, actions below.
 *
 * @testStrategy
 * - data-testid on root, image, controls, continue, and retake elements
 * - Continue/Retake textContent must stay exactly those words
 */
export default function ComposedPreview({
  composedDataUrl,
  capturedAt,
  onContinue,
  onRetake,
  isUploading = false,
}: ComposedPreviewProps) {
  return (
    <div
      data-testid="composed-preview-root"
      className="relative flex h-full w-full flex-col items-center overflow-hidden px-8 py-8"
    >
      <AmbientOrb />

      <SectionHeader
        className="dsac-rise shrink-0"
        eyebrow="Final composition"
        title={
          <>
            Ready to share<span className="text-[var(--accent)]">.</span>
          </>
        }
        subtitle="Happy with it? Continue to get your download link."
      />

      {/* Photo stage.
          The image constrains itself directly against this flex cell, which has a
          definite height. Wrapping it in a padded, auto-height "bed" made
          `max-h-full` resolve against auto — no constraint — so the photo
          overflowed and got clipped at the bottom. */}
      <div className="dsac-rise mt-8 flex min-h-0 w-full flex-1 items-center justify-center">
        <img
          data-testid="composed-preview-image"
          src={composedDataUrl}
          alt="Your composed DSAC event photo"
          className="max-h-full max-w-full rounded-[20px] object-contain"
          style={{ boxShadow: '0 24px 60px -20px rgba(11, 10, 12, 0.5)' }}
        />
      </div>

      {capturedAt && (
        <p className="mt-5 shrink-0 text-[0.75rem] tabular-nums text-[var(--ink-3)]">
          {new Date(capturedAt).toLocaleString('en-SG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}

      {/* Actions */}
      <div
        data-testid="composed-preview-controls"
        className="mt-5 flex w-full shrink-0 items-center justify-center gap-3"
      >
        <Button
          data-testid="composed-preview-retake"
          type="button"
          variant="secondary"
          onClick={onRetake}
          className="w-[180px]"
        >
          <ArrowCounterClockwise className="h-4 w-4" />
          Retake
        </Button>

        <Button
          data-testid="composed-preview-continue"
          type="button"
          onClick={onContinue}
          disabled={isUploading}
          className="group w-[180px]"
        >
          {isUploading ? (
            <>
              <CircleNotch className="h-4 w-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              Continue
              <ArrowRight
                className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
