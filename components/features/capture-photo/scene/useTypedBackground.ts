import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPED_PER_GUEST, type TypedBackground } from '@/types/scene';

/**
 * Having a background drawn from what a guest types. The server does the
 * work (see server/backgrounds.mjs); this keeps the capture page's side:
 * whether typing is offered at all, the wait, the error, and how many tries
 * the current guest has left.
 *
 * Lives on the capture page rather than the camera view, so a retake keeps
 * the guest's picture and their count; `reset` is for the next guest.
 */

export interface TypedBackgroundState {
  /** Typing is offered: a key is set and Settings has not switched it off. */
  available: boolean;
  busy: boolean;
  error: string | null;
  left: number;
  generate: (text: string) => Promise<TypedBackground | null>;
  reset: () => void;
}

/** `refresh` changes whenever availability is worth asking again. */
export function useTypedBackground(refresh: unknown): TypedBackgroundState {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(0);
  // Every picture made for the current guest, so they can all be let go.
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let live = true;
    fetch('/api/backgrounds/status')
      .then(r => (r.ok ? r.json() as Promise<{ available?: boolean }> : null))
      .then(s => { if (live) setAvailable(Boolean(s?.available)); })
      .catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [refresh]);

  const reset = useCallback(() => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    setUsed(0);
    setError(null);
  }, []);

  useEffect(() => () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
  }, []);

  const generate = useCallback(async (text: string): Promise<TypedBackground | null> => {
    const clean = text.trim();
    if (!clean || busy) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/backgrounds/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; code?: string } | null;
        // A guest who was turned away for their words has not used a try.
        if (data?.code !== 'blocked' && data?.code !== 'empty') setUsed(n => n + 1);
        if (data?.code === 'not-configured') setAvailable(false);
        setError(data?.error ?? 'Could not make that background. Pick one of ours for now.');
        return null;
      }
      const src = URL.createObjectURL(await res.blob());
      urls.current.push(src);
      setUsed(n => n + 1);
      return { src, text: clean };
    } catch {
      setError('Could not reach the booth. Pick one of ours for now.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return {
    available,
    busy,
    error,
    left: Math.max(0, TYPED_PER_GUEST - used),
    generate,
    reset,
  };
}
