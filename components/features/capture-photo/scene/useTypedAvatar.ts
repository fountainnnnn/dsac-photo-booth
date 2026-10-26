import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarOption } from '@/types/scene';
import { cutOutAvatar, typedAvatarOption, type AvatarFit } from './typedAvatar';

/**
 * Having an avatar drawn from what a guest types: the capture page's side of
 * server/avatars.mjs, as `useTypedBackground` is for backgrounds. The picture
 * comes back on a flat colour, which is taken away here, with where on the
 * face it goes.
 *
 * Lives on the capture page, so a retake keeps the guest's avatars; `reset`
 * is for the next guest.
 */

export interface TypedAvatarState {
  /** Typing is offered: a key is set and Settings has not switched it off. */
  available: boolean;
  busy: boolean;
  error: string | null;
  generate: (text: string) => Promise<AvatarOption | null>;
  reset: () => void;
}

function readFit(header: string | null): AvatarFit | null {
  if (!header) return null;
  try {
    const fit = JSON.parse(header) as Partial<AvatarFit>;
    return [fit.x, fit.y, fit.faceWidth].every(v => typeof v === 'number' && Number.isFinite(v))
      ? fit as AvatarFit : null;
  } catch {
    return null;
  }
}

/** `refresh` changes whenever availability is worth asking again. */
export function useTypedAvatar(refresh: unknown): TypedAvatarState {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  const made = useRef(0);

  useEffect(() => {
    let live = true;
    fetch('/api/avatars/status')
      .then(r => (r.ok ? r.json() as Promise<{ available?: boolean }> : null))
      .then(s => { if (live) setAvailable(Boolean(s?.available)); })
      .catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [refresh]);

  const reset = useCallback(() => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    setError(null);
  }, []);

  useEffect(() => () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
  }, []);

  const generate = useCallback(async (text: string): Promise<AvatarOption | null> => {
    const clean = text.trim();
    if (!clean || busy) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/avatars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; code?: string } | null;
        if (data?.code === 'not-configured') setAvailable(false);
        setError(data?.error ?? 'Could not make that avatar. Pick one of ours for now.');
        return null;
      }
      const cut = await cutOutAvatar(await res.blob());
      if (!cut) {
        setError('That one did not come out right. Try again, or pick one of ours.');
        return null;
      }
      const src = URL.createObjectURL(cut.png);
      urls.current.push(src);
      made.current += 1;
      return typedAvatarOption({
        id: `typed-${made.current}`,
        label: clean,
        src,
        where: res.headers.get('X-Avatar-Where') ?? 'head',
        size: res.headers.get('X-Avatar-Size') ?? 'normal',
        fit: readFit(res.headers.get('X-Avatar-Fit')),
        box: cut.box,
        width: cut.width,
        height: cut.height,
      });
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
    generate,
    reset,
  };
}
