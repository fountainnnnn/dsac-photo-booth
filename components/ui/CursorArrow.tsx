/**
 * CursorArrow — the pointer prop that sits just below-right of a pill so a
 * card reads as a captured interaction rather than a static illustration.
 */
export default function CursorArrow({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`h-6 w-6 ${className}`}
      style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.2))' }}
    >
      <path
        d="M4 2L20 11L11 13L9 22L4 2Z"
        fill="var(--ink)"
        stroke="#ffffff"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
