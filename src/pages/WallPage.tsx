import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowsInSimple, ArrowsOutSimple, Columns, Images, Rows,
} from '@phosphor-icons/react';
import { assignLanes, laneCount, repeatsToFill } from '@/components/features/wall/lanes';
import { dropThumb, makeThumbs, type Thumb } from '@/components/features/wall/thumbnails';

/**
 * The photo wall: every photo a guest let us keep, in lanes that drift past,
 * each lane the opposite way to the one beside it. Made to be put up on a
 * screen at the venue, so it fills the window and its controls only show
 * while the mouse is moving.
 */

type Layout = 'columns' | 'rows';

interface WallPhoto { token: string; src: string; keptAt: string }

/** Space between photos and round the edge, in pixels. */
const GAP = 16;
/** How often to look for newly kept (or taken back) photos. */
const POLL_MS = 15_000;
/** Pixels a second. Each lane runs a little faster or slower than this. */
const SPEED = { columns: 38, rows: 48 } as const;
const LANE_PACE = [1, 0.84, 1.12, 0.92, 1.06, 0.88, 1.1, 0.95];
/** About how wide a column, or how tall a row, before another is added. */
const LANE_TARGET = { columns: 400, rows: 300 } as const;
const LAYOUT_KEY = 'openhouse.wall.layout';
const IDLE_MS = 2500;

function savedLayout(): Layout {
  try { return localStorage.getItem(LAYOUT_KEY) === 'rows' ? 'rows' : 'columns'; } catch { return 'columns'; }
}

function useWindowSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * The kept photos, as wall copies, kept up to date. Copies are made a batch
 * at a time and the wall changes once per batch, so it does not reshuffle
 * photo by photo while it loads.
 */
function useWallThumbs() {
  const [thumbs, setThumbs] = useState<Thumb[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const have = useRef(new Map<string, Thumb>());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/wall', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { photos } = await res.json() as { photos: WallPhoto[] };
      const wanted = new Set(photos.map(p => p.token));

      const made = await makeThumbs(photos.filter(p => !have.current.has(p.token)));
      for (const t of made) have.current.set(t.token, t);
      for (const [token, t] of have.current) {
        if (!wanted.has(token)) { dropThumb(t); have.current.delete(token); }
      }

      const next = photos.map(p => have.current.get(p.token)).filter((t): t is Thumb => !!t);
      setThumbs(prev => (
        prev && prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next
      ));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the wall');
      setThumbs(prev => prev ?? []);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    void loop();
    const made = have.current;
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const t of made.values()) dropThumb(t);
      made.clear();
    };
  }, [refresh]);

  return { thumbs, error };
}

interface LaneProps {
  items: Thumb[];
  axis: 'x' | 'y';
  /** Down, or right, instead of up, or left. */
  reverse: boolean;
  speed: number;
  /** Where along the lane it starts, in pixels, so lanes do not line up. */
  phase: number;
  still: boolean;
}

/**
 * One lane. Its photos are laid out twice, end to end, and the strip slides
 * by one pass and wraps, so the loop has no seam. Moved by transform each
 * frame rather than a CSS animation, so a photo joining the lane changes its
 * length without making it jump back to the start.
 */
function Lane({ items, axis, reverse, speed, phase, still }: LaneProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const passRef = useRef(0);
  const offsetRef = useRef(phase);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => { passRef.current = (axis === 'y' ? el.offsetHeight : el.offsetWidth) / 2; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const place = () => {
      const pass = passRef.current;
      if (pass <= 0) return;
      const at = offsetRef.current % pass;
      const pos = reverse ? at - pass : -at;
      el.style.transform = axis === 'y' ? `translate3d(0, ${pos}px, 0)` : `translate3d(${pos}px, 0, 0)`;
    };

    if (still) { place(); return; }

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Capped, so a tab coming back from the background does not leap; high
      // enough that a slow laptop drawing a few frames a second keeps pace.
      const dt = Math.min(now - last, 250) / 1000;
      last = now;
      offsetRef.current += speed * dt;
      const pass = passRef.current;
      if (pass > 0 && offsetRef.current > pass * 1000) offsetRef.current %= pass;
      place();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [axis, reverse, speed, still]);

  const strip = [...items, ...items];
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        ref={trackRef}
        className={axis === 'y' ? 'flex flex-col' : 'flex h-full'}
        style={{ willChange: 'transform' }}
      >
        {strip.map((t, k) => (
          <div
            key={k}
            className="shrink-0"
            style={axis === 'y' ? { paddingBottom: GAP } : { paddingRight: GAP, height: '100%' }}
          >
            <img
              src={t.url}
              alt=""
              draggable={false}
              className="block select-none rounded-[14px] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)]"
              style={axis === 'y'
                ? { width: '100%', aspectRatio: t.aspect }
                : { height: '100%', width: 'auto', aspectRatio: t.aspect }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WallPage() {
  const { thumbs, error } = useWallThumbs();
  const { w, h } = useWindowSize();
  const still = useReducedMotion();
  const [layout, setLayout] = useState<Layout>(savedLayout);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* private mode */ }
  }, [layout]);

  // Controls and cursor show while the mouse moves, and go after a moment.
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let timer = setTimeout(() => setAwake(false), IDLE_MS);
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), IDLE_MS);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const axis = layout === 'columns' ? 'y' : 'x';
  const across = layout === 'columns' ? w : h;
  const along = layout === 'columns' ? h : w;
  const lanes = laneCount(across, LANE_TARGET[layout]);
  const laneSize = (across - GAP * (lanes + 1)) / lanes;

  const laneItems = useMemo(() => {
    if (!thumbs?.length) return [];
    return assignLanes(thumbs, lanes).map((seq) => {
      const lengths = seq.map(t => (axis === 'y' ? laneSize / t.aspect : laneSize * t.aspect) + GAP);
      const reps = repeatsToFill(lengths, along);
      return Array.from({ length: reps }, () => seq).flat();
    });
  }, [thumbs, lanes, laneSize, axis, along]);

  const fade = layout === 'columns'
    ? 'linear-gradient(to bottom, var(--stage) 0%, transparent 9%, transparent 91%, var(--stage) 100%)'
    : 'linear-gradient(to right, var(--stage) 0%, transparent 7%, transparent 93%, var(--stage) 100%)';

  const button = 'inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[0.82rem] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

  return (
    <main
      data-testid="wall-root"
      className="relative h-dvh w-full overflow-hidden"
      style={{ background: 'var(--stage)', cursor: awake ? 'default' : 'none' }}
    >
      {thumbs === null ? (
        <p className="flex h-full items-center justify-center text-[0.95rem] text-white/55">Loading photos…</p>
      ) : thumbs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white/70">
            <Images size={26} />
          </span>
          <p className="text-[1.05rem] font-semibold text-white">No photos on the wall yet</p>
          <p className="max-w-[44ch] text-[0.88rem] leading-6 text-white/55">
            A photo appears here when its guest ticks &ldquo;Let us keep this photo&rdquo;
            on their download page.
          </p>
        </div>
      ) : (
        <div
          data-testid="wall-lanes"
          className={`flex h-full ${layout === 'columns' ? 'flex-row' : 'flex-col'}`}
          style={{ gap: GAP, padding: GAP }}
        >
          {laneItems.map((items, i) => (
            <Lane
              key={`${layout}-${i}`}
              items={items}
              axis={axis}
              reverse={i % 2 === 1}
              speed={SPEED[layout] * LANE_PACE[i % LANE_PACE.length]}
              phase={i * 173}
              still={still}
            />
          ))}
        </div>
      )}

      {/* Soft edges, so photos drift in and out rather than being cut off. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: fade }} />

      <div
        className={`absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-3 p-5 transition-opacity duration-300 ${
          awake ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/60 p-2 backdrop-blur-md">
          <span className="px-3 text-[0.82rem] text-white/70">
            {thumbs?.length ?? 0} {thumbs?.length === 1 ? 'photo' : 'photos'}
            {error ? ' · could not refresh' : ''}
          </span>

          <div role="group" aria-label="Layout" className="flex gap-1">
            {(['columns', 'rows'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                onClick={() => setLayout(l)}
                className={`${button} ${layout === l ? 'bg-white text-[#0b0a0c]' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}
              >
                {l === 'columns' ? <Columns size={17} /> : <Rows size={17} />}
                {l === 'columns' ? 'Columns' : 'Rows'}
              </button>
            ))}
          </div>

          <button type="button" onClick={toggleFullscreen}
            className={`${button} text-white/75 hover:bg-white/10 hover:text-white`}>
            {fullscreen ? <ArrowsInSimple size={17} /> : <ArrowsOutSimple size={17} />}
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>

          <a href="/gallery" className={`${button} text-white/75 hover:bg-white/10 hover:text-white`}>
            Gallery
          </a>
        </div>
      </div>
    </main>
  );
}
