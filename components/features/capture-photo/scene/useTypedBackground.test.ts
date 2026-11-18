import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTypedBackground } from './useTypedBackground';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

afterEach(() => vi.unstubAllGlobals());

describe('useTypedBackground', () => {
  it('shows the SP campus photo for SP without asking the image service', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/status') ? json({ available: true }) : json({ error: 'should not be asked' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTypedBackground(1));
    await waitFor(() => expect(result.current.available).toBe(true));

    let made: Awaited<ReturnType<typeof result.current.generate>> = null;
    await act(async () => { made = await result.current.generate('  Singapore Polytechnic ') });
    expect(made).toEqual({ src: '/backgrounds/sp-campus.jpg', text: 'Singapore Polytechnic' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/backgrounds/status']);
    expect(result.current.error).toBeNull();
  });

  it('still has anywhere else drawn', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/status') ? json({ available: true }) : new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:drawn');
    URL.revokeObjectURL = vi.fn();
    const { result } = renderHook(() => useTypedBackground(1));

    let made: Awaited<ReturnType<typeof result.current.generate>> = null;
    await act(async () => { made = await result.current.generate('Marina Bay Sands') });
    expect(result.current.error).toBeNull();
    expect(made).toEqual({ src: 'blob:drawn', text: 'Marina Bay Sands' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/backgrounds/generate');
  });
});
