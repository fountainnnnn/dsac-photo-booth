import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './globals.css';

/**
 * Pull Aeonik in before anyone takes a photo.
 *
 * A canvas will not wait for a webfont. `ctx.font = '... Aeonik'` silently
 * falls through to the next family in the stack if the face has not loaded
 * yet, and the shutter would bake that fallback into the photo — while the
 * live preview, being ordinary CSS, shows Aeonik correctly. The two would
 * disagree, and only the JPEG would be wrong.
 *
 * Both weights, because the event name is set bold and the fallback is per
 * weight as much as per family. Failure is ignored on purpose: a missing font
 * is a caption in the sans behind it, never a booth that will not open.
 */
function loadCaptionFont() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  void Promise.all([
    document.fonts.load('400 100px Aeonik'),
    document.fonts.load('700 100px Aeonik'),
  ]).catch(() => { /* the stack falls back on its own */ });
}

loadCaptionFont();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
