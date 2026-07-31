import CapturePage from './pages/CapturePage';
import DownloadPage from './pages/DownloadPage';
import FramesPage from './pages/FramesPage';
import GalleryPage from './pages/GalleryPage';
import HomePage from './pages/HomePage';
import RemotePage from './pages/RemotePage';
import SettingsPage from './pages/SettingsPage';

function getDownloadToken(pathname: string): string | null {
  const prefix = '/download/';
  if (!pathname.startsWith(prefix)) return null;

  const token = pathname.slice(prefix.length).split('/')[0];
  return token ? decodeURIComponent(token) : null;
}

export default function App() {
  const { pathname } = window.location;
  const downloadToken = getDownloadToken(pathname);

  if (pathname === '/capture') return <CapturePage />;
  if (pathname === '/settings') return <SettingsPage />;
  if (pathname === '/gallery') return <GalleryPage />;
  if (pathname === '/frames') return <FramesPage />;
  if (pathname === '/remote') return <RemotePage />;
  if (downloadToken) return <DownloadPage token={downloadToken} />;

  return <HomePage />;
}
