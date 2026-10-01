import CapturePage from './pages/CapturePage';
import DownloadPage from './pages/DownloadPage';
import FramesPage from './pages/FramesPage';
import GalleryPage from './pages/GalleryPage';
import RemotePage from './pages/RemotePage';
import SettingsPage from './pages/SettingsPage';
import PasswordGate from '@/components/features/auth/PasswordGate';

function getDownloadToken(pathname: string): string | null {
  const prefix = '/download/';
  if (!pathname.startsWith(prefix)) return null;

  const token = pathname.slice(prefix.length).split('/')[0];
  return token ? decodeURIComponent(token) : null;
}

/** The interface, phone remote included — one password for the whole booth. */
function boothGated(page: React.ReactNode) {
  return (
    <PasswordGate scope="booth" title="Booth locked" hint="Enter the booth password to continue.">
      {page}
    </PasswordGate>
  );
}

export default function App() {
  const { pathname } = window.location;
  const downloadToken = getDownloadToken(pathname);

  if (pathname === '/capture') return boothGated(<CapturePage />);
  if (pathname === '/settings') return boothGated(<SettingsPage />);
  if (pathname === '/gallery') return boothGated(<GalleryPage />);
  if (pathname === '/frames') return boothGated(<FramesPage />);
  if (pathname === '/remote') return boothGated(<RemotePage />);

  // The guest side, with no password: the token in the link is unguessable,
  // so holding the link is what lets a guest in.
  if (downloadToken) return <DownloadPage token={downloadToken} />;

  return boothGated(<CapturePage />);
}
