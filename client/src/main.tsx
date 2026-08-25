import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './fonts.css';

// Phaser bakes each label into a texture on first draw and never re-renders it,
// so mount behind the font. The cap keeps a stalled font from blocking the app.
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
