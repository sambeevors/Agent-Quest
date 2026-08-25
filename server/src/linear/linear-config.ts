import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Persistence for the Linear API key so it survives a restart and doesn't have
 * to be prefixed onto every `bun start`.
 *
 * Stored under `server/data/` alongside the map slots — the existing home for
 * per-user state that isn't committed. The file is gitignored and written
 * 0600, because it holds a live credential in plaintext. There is no way to
 * avoid plaintext here short of pulling in an OS keychain dependency, so the
 * mitigations are: restrictive permissions, never echoing the key back over
 * HTTP, and saying plainly in the docs what's on disk.
 *
 * `LINEAR_API_KEY` in the environment always wins. An operator who set the key
 * explicitly shouldn't have it silently overridden by whatever a browser tab
 * once saved, so when the env var is present the stored file is ignored and
 * the UI reports the key as externally managed.
 */

const DATA_DIR = resolve(import.meta.dir, '../../data');
const CONFIG_PATH = resolve(DATA_DIR, 'linear.json');

/** Where the active key came from. `null` means none is configured. */
export type KeySource = 'env' | 'stored' | null;

export interface ResolvedKey {
  apiKey: string | undefined;
  source: KeySource;
  /** Last 4 characters, for confirming *which* key is active. Never the whole key. */
  hint: string | undefined;
}

interface StoredConfig {
  apiKey?: unknown;
}

/** Last 4 chars, or undefined for an absent/too-short key. */
export function keyHint(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined || apiKey.length < 4) return undefined;
  return apiKey.slice(-4);
}

/**
 * Shape check only — this doesn't prove the key works, which is why the route
 * verifies against the live API before saving. It exists to reject obvious
 * paste errors (an empty field, a whole URL) without a network round trip.
 */
export function looksLikeLinearKey(value: unknown): value is string {
  return typeof value === 'string' && /^lin_(api|oauth)_[A-Za-z0-9]{16,}$/.test(value.trim());
}

export class LinearConfigStore {
  private readonly envKey: string | undefined;
  private storedKey: string | undefined;
  private readyPromise: Promise<void>;

  constructor(envKey: string | undefined = process.env.LINEAR_API_KEY) {
    const trimmed = envKey?.trim();
    this.envKey = trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
    this.readyPromise = this.load();
  }

  /** Resolves once the stored key has been read from disk. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** True when the key is fixed by the environment and the UI must not offer to change it. */
  get isEnvManaged(): boolean {
    return this.envKey !== undefined;
  }

  resolve(): ResolvedKey {
    if (this.envKey !== undefined) {
      return { apiKey: this.envKey, source: 'env', hint: keyHint(this.envKey) };
    }
    if (this.storedKey !== undefined) {
      return { apiKey: this.storedKey, source: 'stored', hint: keyHint(this.storedKey) };
    }
    return { apiKey: undefined, source: null, hint: undefined };
  }

  /** Persist a key. Throws when the environment already fixes one. */
  async save(apiKey: string): Promise<void> {
    if (this.envKey !== undefined) {
      throw new Error('LINEAR_API_KEY is set in the environment — unset it to manage the key from the app.');
    }
    const trimmed = apiKey.trim();
    this.storedKey = trimmed;
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(CONFIG_PATH, JSON.stringify({ apiKey: trimmed }, null, 2));
    // Owner read/write only — this is a live credential sitting in a repo
    // checkout. Best-effort: some filesystems (and Windows) don't honour it.
    await chmod(CONFIG_PATH, 0o600).catch(() => {});
  }

  /** Forget the stored key. No-op when the environment manages it. */
  async clear(): Promise<void> {
    if (this.envKey !== undefined) {
      throw new Error('LINEAR_API_KEY is set in the environment — unset it to manage the key from the app.');
    }
    this.storedKey = undefined;
    await Bun.write(CONFIG_PATH, JSON.stringify({}, null, 2));
    await chmod(CONFIG_PATH, 0o600).catch(() => {});
  }

  private async load(): Promise<void> {
    try {
      const file = Bun.file(CONFIG_PATH);
      if (!(await file.exists())) return;
      const parsed = (await file.json()) as StoredConfig;
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0) {
        this.storedKey = parsed.apiKey;
      }
    } catch {
      // Unreadable or corrupt config is equivalent to none — the UI will offer
      // to reconnect rather than the server failing to boot over it.
      console.warn('[Linear] could not read stored config; treating the key as unset.');
    }
  }
}
