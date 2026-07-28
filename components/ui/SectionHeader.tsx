/**
 * SectionHeader — the centered header block that opens every screen.
 *
 * Gradient eyebrow, weight-500 display title ending in a period, one- or
 * two-line subtitle. Repeating this exact grammar is what makes the screens
 * read as siblings rather than as four separate builds.
 */
export interface SectionHeaderProps {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Kiosk screens are read at TV distance; 'lg' is for the landing hero,
   *  'sm' for the narrow control panel. */
  size?: 'sm' | 'md' | 'lg';
  align?: 'center' | 'left';
  className?: string;
}

export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
  size = 'md',
  align = 'center',
  className = '',
}: SectionHeaderProps) {
  const alignment = align === 'center' ? 'items-center text-center' : 'items-start text-left';

  const titleSize = {
    sm: 'text-[1.375rem] leading-[1.15] mt-2',
    md: 'text-[2rem] leading-[1.1] mt-4',
    lg: 'text-[3.25rem] leading-[1.05] mt-4',
  }[size];

  const subSize = {
    sm: 'text-[0.8125rem] mt-2',
    md: 'text-[1rem] mt-4',
    lg: 'text-[1.125rem] mt-4',
  }[size];

  return (
    <div className={`flex flex-col ${alignment} ${className}`}>
      <p
        className={`dsac-gradient-text font-semibold uppercase tracking-[1px] ${
          size === 'sm' ? 'text-[0.6875rem]' : 'text-[0.75rem]'
        }`}
      >
        {eyebrow}
      </p>
      <h1 className={`font-medium tracking-[-0.02em] text-[var(--ink)] ${titleSize}`}>{title}</h1>
      {subtitle && (
        <p className={`max-w-[46ch] leading-[1.5] text-[var(--ink-2)] ${subSize}`}>{subtitle}</p>
      )}
    </div>
  );
}
