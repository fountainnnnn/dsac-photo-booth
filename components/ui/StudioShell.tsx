import { CaretDown, Camera, Gear, Images } from '@phosphor-icons/react';

/**
 * StudioShell — the persistent left rail and page frame.
 *
 * Icons come from Phosphor rather than the app's usual set, at the designer's
 * request. The rail is deliberately wider than the reference mockup.
 */

export type StudioSection = 'capture' | 'gallery' | 'frames' | 'filters' | 'adjust' | 'settings';

// Frames, filters and adjustments are configured in Settings now, so the rail
// only carries the two places an operator actually stands in.
const NAV: { id: StudioSection; label: string; Icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold' }> }[] = [
  { id: 'capture', label: 'Capture', Icon: Camera },
  { id: 'gallery', label: 'Gallery', Icon: Images },
];

export interface StudioShellProps {
  active: StudioSection;
  onNavigate: (section: StudioSection) => void;
  children: React.ReactNode;
  /** Let the page scroll instead of pinning the card to one viewport. */
  scroll?: boolean;
}

export default function StudioShell({ active, onNavigate, children, scroll = false }: StudioShellProps) {
  return (
    <div className="flex h-dvh w-full overflow-hidden" style={{ background: 'var(--shell-bg)' }}>
      {/* Left rail */}
      <aside className="flex w-[272px] flex-shrink-0 flex-col bg-white px-5 py-6">
        <div className="flex items-center gap-3 px-2">
          <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-9 w-auto" />
          <span className="text-[0.9rem] font-semibold leading-[1.15] tracking-tight text-[var(--ink)]">
            Photo<br />Booth
          </span>
        </div>

        <nav className="mt-9 flex flex-col gap-1.5">
          {NAV.map(({ id, label, Icon }) => {
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-left text-[0.9rem] font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  on
                    ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                    : 'text-[var(--ink-2)] hover:bg-[var(--shell-bg)] hover:text-[var(--ink)]'
                }`}
              >
                <Icon size={20} weight={on ? 'fill' : 'regular'} />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1.5 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            aria-current={active === 'settings' ? 'page' : undefined}
            className={`flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-left text-[0.9rem] font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              active === 'settings'
                ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                : 'text-[var(--ink-2)] hover:bg-[var(--shell-bg)] hover:text-[var(--ink)]'
            }`}
          >
            <Gear size={20} weight={active === 'settings' ? 'fill' : 'regular'} />
            Settings
          </button>

          <div className="mt-1 flex items-center gap-3 rounded-xl px-2.5 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--shell-bg)] text-[0.7rem] font-bold text-[var(--ink)]">
              SP
            </span>
            <span className="text-[0.85rem] font-semibold text-[var(--ink)]">Studio Pro</span>
            <CaretDown size={14} weight="bold" className="ml-auto text-[var(--ink-3)]" />
          </div>
        </div>
      </aside>

      {/* Main panel — padded on every side so the card floats clear of the
          rail instead of butting up against it.

          Capture is a kiosk screen and must never scroll: the camera has to
          fill exactly one viewport. Settings is a long form, so it scrolls the
          page instead — nesting its own scrollbars inside a fixed-height card
          meant hunting for content in three separate little windows. */}
      <main className={`min-w-0 flex-1 p-4 ${scroll ? 'overflow-y-auto' : ''}`}>
        <div
          className={`flex flex-col rounded-[26px] bg-white px-8 py-7 shadow-[0_1px_3px_rgba(11,10,12,0.06),0_12px_32px_-16px_rgba(11,10,12,0.14)] ${
            scroll ? 'min-h-full' : 'h-full min-h-0 overflow-hidden'
          }`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
