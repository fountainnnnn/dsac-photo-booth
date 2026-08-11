import { useEffect, useRef, useState } from 'react';
import { CaretDown, Camera, Gear, Images, SignOut, SidebarSimple } from '@phosphor-icons/react';

/**
 * StudioShell — the persistent left rail and page frame.
 *
 * Icons come from Phosphor rather than the app's usual set, at the designer's
 * request. The rail is deliberately wider than the reference mockup, and can
 * be collapsed to icons when the stage wants the room.
 */

export type StudioSection = 'capture' | 'gallery' | 'frames' | 'filters' | 'adjust' | 'settings';

// Frames, filters and adjustments are configured in Settings now, so the rail
// only carries the two places an operator actually stands in.
type NavIcon = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold' }>;

const NAV: { id: StudioSection; label: string; Icon: NavIcon }[] = [
  { id: 'capture', label: 'Capture', Icon: Camera },
  { id: 'gallery', label: 'Gallery', Icon: Images },
];

/** Remembered per device: whoever runs the booth has a standing preference. */
const COLLAPSE_KEY = 'dsac.rail.collapsed';

export interface StudioShellProps {
  active: StudioSection;
  onNavigate: (section: StudioSection) => void;
  children: React.ReactNode;
  /** Let the page scroll instead of pinning the card to one viewport. */
  scroll?: boolean;
}

export default function StudioShell({ active, onNavigate, children, scroll = false }: StudioShellProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
  }, [collapsed]);

  // The account menu, which today is one item. It closes on an outside click
  // like any other popover — Escape is not wired up because there is nothing
  // else in it yet to tab past.
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [accountOpen]);

  // Booth is the one scope the studio itself runs behind, so logging out just
  // drops that cookie and reloads — the same PasswordGate that let the page
  // through picks the lock back up.
  const logOut = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'booth' }),
      });
    } finally {
      window.location.reload();
    }
  };

  /** One row of the rail, which is a label + icon open and an icon alone shut. */
  const navButton = (id: StudioSection, label: string, Icon: NavIcon) => {
    const on = active === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onNavigate(id)}
        aria-current={on ? 'page' : undefined}
        // The label is the accessible name when open; collapsed it is gone from
        // the DOM, so the title has to carry it for both sighted and AT users.
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        className={`flex items-center rounded-xl py-3 text-left text-[0.9rem] font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          collapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'
        } ${
          on
            ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
            : 'text-[var(--ink-2)] hover:bg-[var(--shell-bg)] hover:text-[var(--ink)]'
        }`}
      >
        <Icon size={20} weight={on ? 'fill' : 'regular'} />
        {!collapsed && label}
      </button>
    );
  };

  /**
   * The collapse toggle is an icon alone, tucked at the top right of the rail.
   * Open it rides in the header beside the wordmark; shut the rail is only
   * 76px, so it drops to its own centred row under the logo.
   */
  const collapseButton = (
    <button
      type="button"
      onClick={() => setCollapsed(c => !c)}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
      aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
      className={`flex h-10 w-10 items-center justify-center rounded-xl p-2 text-[var(--ink-3)] transition-colors duration-150 hover:bg-[var(--shell-bg)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        collapsed ? 'mx-auto' : 'ml-auto'
      }`}
    >
      <SidebarSimple size={18} weight={collapsed ? 'fill' : 'regular'} />
    </button>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden" style={{ background: 'var(--shell-bg)' }}>
      {/* Left rail */}
      <aside
        className={`flex flex-shrink-0 flex-col bg-white py-6 transition-[width] duration-200 ${
          collapsed ? 'w-[76px] px-3' : 'w-[272px] px-5'
        }`}
      >
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 pl-2'}`}>
          <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-9 w-auto" />
          {!collapsed && (
            <>
              <span className="text-[0.9rem] font-semibold leading-[1.15] tracking-tight text-[var(--ink)]">
                Photo<br />Booth
              </span>
              {collapseButton}
            </>
          )}
        </div>

        {collapsed && <div className="mt-3 flex">{collapseButton}</div>}

        <nav className="mt-6 flex flex-col gap-1.5">
          {NAV.map(({ id, label, Icon }) => navButton(id, label, Icon))}
        </nav>

        <div className="mt-auto flex flex-col gap-1.5 border-t border-[var(--border)] pt-4">
          {navButton('settings', 'Settings', Gear)}

          <div ref={accountRef} className="relative mt-1">
            <button
              type="button"
              onClick={() => setAccountOpen(o => !o)}
              aria-expanded={accountOpen}
              aria-label={collapsed ? 'Account menu' : undefined}
              className={`flex w-full items-center rounded-xl py-2 transition-colors duration-150 hover:bg-[var(--shell-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                collapsed ? 'justify-center px-0' : 'gap-3 px-2.5'
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--shell-bg)] text-[0.7rem] font-bold text-[var(--ink)]">
                SP
              </span>
              {!collapsed && (
                <>
                  <span className="text-[0.85rem] font-semibold text-[var(--ink)]">Studio Pro</span>
                  <CaretDown size={14} weight="bold" className="ml-auto text-[var(--ink-3)]" />
                </>
              )}
            </button>

            {accountOpen && (
              <div
                className={`absolute bottom-full z-10 mb-1.5 w-44 rounded-xl border border-[var(--border)] bg-white py-1.5 shadow-[0_4px_16px_rgba(11,10,12,0.12)] ${
                  collapsed ? 'left-0' : 'left-0 right-0 w-auto'
                }`}
              >
                <button
                  type="button"
                  onClick={() => { setAccountOpen(false); void logOut(); }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[0.85rem] font-medium text-[var(--ink)] hover:bg-[var(--shell-bg)]"
                >
                  <SignOut size={16} />
                  Log out
                </button>
              </div>
            )}
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
