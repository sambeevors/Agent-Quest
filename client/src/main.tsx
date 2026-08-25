import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './fonts.css';

// Phaser rasterises each in-world label into a canvas texture the first time it
// draws and never re-renders it when a webfont arrives later, so a label built
// before RuneScape loads keeps the fallback face for the life of the scene.
// Mount only once the font is resolved. The 2s cap is a safety net: a font that
// never arrives must not leave the village unmounted.
const MOUNT_TIMEOUT_MS = 2000;

function fontReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return Promise.race([
    Promise.all([
      document.fonts.load('16px RuneScape'),
      document.fonts.load('16px "RuneScape UI"'),
    ]).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, MOUNT_TIMEOUT_MS)),
  ]);
}

void fontReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
