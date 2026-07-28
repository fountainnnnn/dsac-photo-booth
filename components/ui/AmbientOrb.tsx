/**
 * AmbientOrb — one large soft orb drifting behind the page, plus a fainter
 * offset companion. Purely atmospheric: fixed, behind everything, inert.
 *
 * One orb is atmosphere; several is a lava lamp. Two is the ceiling.
 */
export default function AmbientOrb({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const peak = tone === 'dark' ? 0.2 : 0.13;
  const peak2 = tone === 'dark' ? 0.13 : 0.08;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute rounded-full"
        style={{
          width: '68vw',
          height: '68vw',
          top: '-22vw',
          left: '-12vw',
          background: `radial-gradient(circle, var(--accent) 0%, var(--glow-amber) 55%, transparent 72%)`,
          opacity: peak,
          filter: 'blur(120px)',
          animation: 'dsac-orb-drift 32s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: '52vw',
          height: '52vw',
          bottom: '-20vw',
          right: '-10vw',
          background: `radial-gradient(circle, var(--glow-iris) 0%, var(--accent) 60%, transparent 74%)`,
          opacity: peak2,
          filter: 'blur(140px)',
          animation: 'dsac-orb-drift 41s ease-in-out infinite reverse',
        }}
      />
    </div>
  );
}
