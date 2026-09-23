/**
 * The card a guest cropped from their photo, and where the faces in it are.
 *
 * Polling rather than a socket: the guest's phone is on mobile data through a
 * Cloudflare tunnel, and the booth already proved this shape works for the
 * remote. A socket would be more machinery for the same answer.
 *
 * Nothing here is slow enough to need watching, so the poll runs once on load
 * and again after an upload. A page left open on a lanyard all afternoon makes
 * no requests at all.
 */

import { useCallback, useEffect, useState } from 'react';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Card {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  mime: string | null;
  error: string | null;
  createdAt: string;
}

export function cardSrc(id: string, save = false): string {
  return `/api/derivatives/item/${encodeURIComponent(id)}${save ? '?save=1' : ''}`;
}

export function useCard(token: string) {
  const [card, setCard] = useState<Card | undefined>();
  const [event, setEvent] = useState<{ eventName: string; eventDate: string } | null>(null);
  /**
   * Whether the card beta is on. False until the booth says otherwise, so the
   * page never flashes a feature at a guest and then withdraws it.
   */
  const [enabled, setEnabled] = useState(false);
  /**
   * Face boxes for this photo, in its own pixels, found by the kiosk when the
   * shot was taken. Empty is normal and simply means the crop is placed where
   * the guest taps.
   */
  const [faces, setFaces] = useState<Rect[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/derivatives/${encodeURIComponent(token)}`);
      if (!res.ok) return;
      const body = await res.json() as { derivatives: Card[]; faces?: Rect[] };
      if (Array.isArray(body.faces)) setFaces(body.faces);
      setCard((body.derivatives ?? []).find(d => (d as Card & { kind: string }).kind === 'card'));
    } catch {
      // A poll that fails is a poll; the next one will say the same thing.
    }
  }, [token]);

  // Whether the card is offered at all, and the event to stamp on it. Asked
  // once. With the beta off, this one small request is the only difference
  // from the page as it was: the card and faces are never fetched.
  useEffect(() => {
    fetch('/api/derivatives/config')
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (body?.event) setEvent(body.event);
        const on = body?.cardEnabled === true;
        setEnabled(on);
        if (on) void refresh();
      })
      .catch(() => {});
  }, [refresh]);

  /** Send the finished card and pick the answer up. */
  const upload = useCallback(async (blob: Blob) => {
    const form = new FormData();
    form.append('file', blob, 'card.png');

    const res = await fetch(`/api/derivatives/${encodeURIComponent(token)}/card`, {
      method: 'POST', body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Could not save your card.');
    }
    await refresh();
    return res.json() as Promise<{ id: string }>;
  }, [token, refresh]);

  return { enabled, card, event, faces, upload, refresh };
}
