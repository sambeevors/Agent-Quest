import { useState } from 'react';
import type { LinearStatus } from '../types/agent';
import { SERVER_URL } from '../config';

/**
 * Connect / disconnect controls for Linear, so the API key can be set from the
 * app instead of prefixed onto every `bun start`.
 *
 * The key travels one way only: the browser posts it, and the server replies
 * with a status carrying nothing but a 4-character hint. Nothing here ever
 * holds or displays a full key after submission.
 *
 * The server verifies the key against the live API before saving, so the error
 * shown below is Linear's own verdict rather than a guess — a typo is caught
 * while the key is still on the user's clipboard.
 */

interface LinearConnectProps {
  status: LinearStatus;
  /** Called with the fresh status the server returns after a change. */
  onChanged: (status: LinearStatus) => void;
}

export function LinearConnect({ status, onChanged }: LinearConnectProps) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/linear/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const body = await res.json() as LinearStatus & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status}).`);
        return;
      }
      // Clear the field on success so a live credential doesn't linger in the
      // DOM after it's been accepted.
      setApiKey('');
      onChanged(body);
    } catch {
      setError('Could not reach the Agent Quest server.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/linear/key`, { method: 'DELETE' });
      const body = await res.json() as LinearStatus & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status}).`);
        return;
      }
      onChanged(body);
    } catch {
      setError('Could not reach the Agent Quest server.');
    } finally {
      setBusy(false);
    }
  }

  // Key fixed by the environment — show what's active but offer no controls,
  // since changing it here couldn't take effect.
  if (status.envManaged) {
    return (
      <div className="linear-connect">
        <p className="linear-connect-note">
          Connected with the key from <code>LINEAR_API_KEY</code>
          {status.keyHint !== undefined && <> (…{status.keyHint})</>}.
          Unset that variable to manage the key from here.
        </p>
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="linear-connect">
        <div className="linear-connect-row">
          <span className="linear-connect-status">
            Connected{status.keyHint !== undefined && <> · key …{status.keyHint}</>}
          </span>
          <button
            type="button"
            className="linear-connect-btn is-secondary"
            onClick={() => void disconnect()}
            disabled={busy}
          >{busy ? 'Working…' : 'Disconnect'}</button>
        </div>
        {error !== null && <p className="linear-connect-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="linear-connect">
      <p className="linear-connect-note">
        Paste a personal API key from Linear (Settings → Security &amp; access →
        API keys). It's stored on this machine, not in the browser.
      </p>
      <div className="linear-connect-row">
        <input
          type="password"
          className="linear-connect-input"
          placeholder="lin_api_…"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          aria-label="Linear API key"
        />
        <button
          type="button"
          className="linear-connect-btn"
          onClick={() => void submit()}
          disabled={busy || apiKey.trim().length === 0}
        >{busy ? 'Checking…' : 'Connect'}</button>
      </div>
      {error !== null && <p className="linear-connect-error">{error}</p>}
    </div>
  );
}
