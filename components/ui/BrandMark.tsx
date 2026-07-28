interface BrandMarkProps {
  compact?: boolean;
  inverted?: boolean;
}

export default function BrandMark({ compact = false, inverted = false }: BrandMarkProps) {
  return (
    <div className="flex items-center gap-3" aria-label="Singapore Polytechnic Data Science and Analytics Centre">
      <img
        src="/sp-dsac-logo.png"
        alt="SP Data Science and Analytics Centre"
        className={compact ? 'h-14 w-auto' : 'h-20 w-auto md:h-24'}
      />
      {!compact && (
        <span
          className={`hidden border-l pl-3 text-[11px] font-medium leading-4 md:block ${
            inverted ? 'border-white/15 text-white/55' : 'border-[#e5e5e8] text-[#a1a1aa]'
          }`}
        >
          Event photo booth
        </span>
      )}
    </div>
  );
}
