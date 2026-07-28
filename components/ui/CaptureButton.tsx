interface CaptureButtonProps {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export default function CaptureButton({
  onClick,
  disabled = false,
  ariaLabel = 'Take photo',
  className,
}: CaptureButtonProps) {
  return (
    <button
      data-testid="capture-button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${className ?? ''} group relative flex h-[62px] w-[62px] items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-30`}
    >
      {/* Slow ambient pulse ring — only when ready */}
      {!disabled && (
        <span
          className="absolute inset-0 rounded-full border border-white/25"
          style={{ animation: 'shutter-breathe 3s ease-in-out infinite' }}
        />
      )}

      {/* Outer border ring */}
      <span
        className="absolute inset-0 rounded-full border-2 border-white/55 transition-all duration-200 group-hover:border-white/90 group-active:scale-95"
      />

      {/* Inner gap ring (mimics camera shutter ring) */}
      <span className="absolute inset-[5px] rounded-full border border-white/15" />

      {/* Red shutter disc */}
      <span
        className="relative h-[42px] w-[42px] rounded-full bg-[var(--accent)] transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-[0.91]"
        style={{
          boxShadow: '0 0 18px rgba(225,38,47,0.45), 0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
        }}
      />

      <style>{`
        @keyframes shutter-breathe {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.18); opacity: 0; }
        }
      `}</style>
    </button>
  );
}
