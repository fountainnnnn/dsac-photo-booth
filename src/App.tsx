import CapturePage from './pages/CapturePage';
import DownloadPage from './pages/DownloadPage';
import HomePage from './pages/HomePage';

function getDownloadToken(pathname: string): string | null {
  const prefix = '/download/';
  if (!pathname.startsWith(prefix)) return null;

  const token = pathname.slice(prefix.length).split('/')[0];
  return token ? decodeURIComponent(token) : null;
}

export default function App() {
  const { pathname } = window.location;
  const downloadToken = getDownloadToken(pathname);

  if (pathname === '/capture') {
    return <CapturePage />;
  }

  if (downloadToken) {
    return <DownloadPage token={downloadToken} />;
  }

  return <HomePage />;
}
