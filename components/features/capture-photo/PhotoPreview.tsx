export interface PhotoPreviewProps {
  /** data URL of the captured JPEG frame */
  imageUrl: string;
  onConfirm: () => void;
  onRetake: () => void;
  /** When true, disables both buttons and shows a loading indicator on Confirm */
  isConfirming?: boolean;
}

/**
 * PhotoPreview — shows the captured frame and lets the user confirm or retake.
 *
 * @testStrategy
 * - data-testid on root, image, confirm, and retake elements
 * - Colors via direct hex values; spacing via Tailwind classes
 */
export default function PhotoPreview({
  imageUrl,
  onConfirm,
  onRetake,
  isConfirming = false,
}: PhotoPreviewProps) {
  return (
    <div
      data-testid="photo-preview-root"
      className="relative flex h-full w-full flex-col bg-[#f4f1ec] text-[#11100f]"
    >
      <div className="border-b border-[#ded8cf] bg-white/80 px-5 py-4">
        <p className="text-xs font-semibold text-[#6e675d]">Review photo</p>
        <h1 className="text-xl font-semibold">Use this photo?</h1>
      </div>

      {/* Preview image */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#11100f] p-3 md:p-5">
        {/* Plain img is required because previews use data URLs. */}
        <img
          data-testid="photo-preview-image"
          src={imageUrl}
          alt="Captured photo preview"
          className="max-h-full max-w-full object-contain shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
        />
      </div>

      {/* Action buttons */}
      <div
        data-testid="photo-preview-controls"
        className="flex w-full items-center justify-center gap-3 border-t border-[#ded8cf] bg-white/90 px-4 py-5"
      >
        <button
          data-testid="photo-preview-retake"
          type="button"
          onClick={onRetake}
          disabled={isConfirming}
          className="
            min-h-12 flex-1 max-w-[180px] rounded-md border border-[#cfc7ba]
            bg-white px-5 text-sm font-semibold text-[#5d554b]
            transition duration-200
            hover:border-[#11100f] hover:text-[#11100f]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e1262f]
            disabled:cursor-not-allowed disabled:opacity-40
          "
        >
          Retake
        </button>

        <button
          data-testid="photo-preview-confirm"
          type="button"
          onClick={onConfirm}
          disabled={isConfirming}
          className="
            min-h-12 flex-1 max-w-[180px] rounded-md bg-[#11100f]
            px-5 text-sm font-semibold text-white
            shadow-[0_12px_30px_rgba(17,16,15,0.18)]
            transition duration-200
            hover:bg-[#e1262f]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e1262f]
            disabled:cursor-not-allowed disabled:opacity-60
          "
        >
          {isConfirming ? 'Saving…' : 'Use Photo'}
        </button>
      </div>
    </div>
  );
}
