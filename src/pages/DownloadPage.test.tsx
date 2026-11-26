import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DownloadPage from './DownloadPage';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

function mockKeep(handlers: { get: () => Promise<Response>; put?: (keep: boolean) => Promise<Response> }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/keep/')) throw new Error(`unexpected ${url}`);
    if (init?.method === 'PUT') return handlers.put!(JSON.parse(String(init.body)).keep);
    return handlers.get();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('DownloadPage: keeping the photo', () => {
  it('starts unticked when the guest has not said yes', async () => {
    mockKeep({ get: () => json({ kept: false }) });
    render(<DownloadPage token="abc" />);
    const box = screen.getByTestId('download-page-keep-box') as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
  });

  it('shows the box ticked when the photo is already kept', async () => {
    mockKeep({ get: () => json({ kept: true }) });
    render(<DownloadPage token="abc" />);
    const box = screen.getByTestId('download-page-keep-box') as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
  });

  it('saves the guest\'s yes as soon as they tick it', async () => {
    const fetchMock = mockKeep({ get: () => json({ kept: false }), put: keep => json({ kept: keep }) });
    render(<DownloadPage token="abc" />);
    const box = screen.getByTestId('download-page-keep-box') as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));

    fireEvent.click(box);

    await waitFor(() => expect(box.checked).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/api/keep/abc');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ keep: true });
  });

  it('shows the photo as deleted when unticking comes after its time', async () => {
    mockKeep({ get: () => json({ kept: true }), put: () => json({ kept: false, deleted: true }) });
    render(<DownloadPage token="abc" />);
    const box = screen.getByTestId('download-page-keep-box') as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));

    fireEvent.click(box);

    await waitFor(() => expect(screen.getByTestId('download-page-gone')).toBeTruthy());
    expect(screen.queryByTestId('download-page-keep-box')).toBeNull();
  });

  it('puts the box back and says so when the save fails', async () => {
    mockKeep({ get: () => json({ kept: false }), put: () => json({ error: 'x' }, 500) });
    render(<DownloadPage token="abc" />);
    const box = screen.getByTestId('download-page-keep-box') as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));

    fireEvent.click(box);

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not save/i));
    expect(box.checked).toBe(false);
  });

  it('shows a lapsed photo as gone, with no box to tick', async () => {
    mockKeep({ get: () => json({ error: 'gone' }, 410) });
    render(<DownloadPage token="abc" />);
    await waitFor(() => expect(screen.getByTestId('download-page-gone')).toBeTruthy());
    expect(screen.queryByTestId('download-page-keep-box')).toBeNull();
  });
});
