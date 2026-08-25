import type { LinearStatus } from '../types';
import { fetchLinearProjects } from './linear-client';
import type { KeySource } from './linear-config';

/**
 * Polls Linear for in-progress projects and hands the result to the server as
 * a `LinearStatus`. Entirely opt-in: with no API key configured the provider
 * never makes a request and reports `connected: false`, so the UI can explain
 * how to connect instead of silently showing an empty village.
 *
 * The key is settable at RUNTIME (`setKey`) rather than fixed at construction,
 * because it's configurable from the app — connecting shouldn't require a
 * server restart.
 *
 * A failed poll keeps the LAST GOOD project list and attaches an `error`,
 * rather than clearing the map: a transient 500 or a laptop waking from sleep
 * shouldn't demolish every construction site on screen.
 */

/** Default poll interval. Project progress moves on the order of hours. */
export const DEFAULT_POLL_MS = 2 * 60_000;

export interface LinearProviderOptions {
  pollMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Called after every poll and every key change with the new status. */
  onStatus?: (status: LinearStatus) => void;
}

export interface KeyState {
  apiKey: string | undefined;
  source: KeySource;
  hint: string | undefined;
  /** True when the environment fixes the key and the UI must not offer to change it. */
  envManaged: boolean;
}

const NO_KEY: KeyState = { apiKey: undefined, source: null, hint: undefined, envManaged: false };

export class LinearProvider {
  private key: KeyState = NO_KEY;
  private readonly pollMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly onStatus: ((status: LinearStatus) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private projects: LinearStatus['projects'] = [];
  private lastSyncedAt: number | null = null;
  private error: string | undefined;

  constructor(opts: LinearProviderOptions = {}) {
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.fetchImpl = opts.fetchImpl;
    this.onStatus = opts.onStatus;
  }

  /** True when a key is configured, from any source. */
  get enabled(): boolean {
    return this.key.apiKey !== undefined;
  }

  getStatus(): LinearStatus {
    return {
      connected: this.key.apiKey !== undefined,
      keySource: this.key.source,
      keyHint: this.key.hint,
      envManaged: this.key.envManaged,
      projects: this.projects,
      lastSyncedAt: this.lastSyncedAt,
      error: this.error,
    };
  }

  /**
   * Point the provider at a different key (or none) and re-sync immediately.
   * Clearing the key also clears the project list — leaving sites on the map
   * for a workspace we can no longer read would be stale by definition, which
   * is the opposite of the transient-failure case where keeping them is right.
   */
  async setKey(key: KeyState): Promise<LinearStatus> {
    const changed = key.apiKey !== this.key.apiKey;
    this.key = key;

    if (key.apiKey === undefined) {
      this.stop();
      this.projects = [];
      this.lastSyncedAt = null;
      this.error = undefined;
      const status = this.getStatus();
      this.onStatus?.(status);
      return status;
    }

    if (changed) {
      this.projects = [];
      this.lastSyncedAt = null;
      this.error = undefined;
    }
    await this.poll();
    this.startTimer();
    return this.getStatus();
  }

  /** Begin polling if a key is configured. Safe to call when none is. */
  async start(): Promise<void> {
    if (this.key.apiKey === undefined) {
      console.log('[Linear] no API key configured — construction sites disabled until one is set.');
      return;
    }
    await this.poll();
    this.startTimer();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One fetch cycle. Never throws — failures are folded into the status. */
  async poll(): Promise<LinearStatus> {
    const apiKey = this.key.apiKey;
    if (apiKey === undefined) return this.getStatus();
    try {
      this.projects = await fetchLinearProjects({ apiKey, fetchImpl: this.fetchImpl });
      this.lastSyncedAt = Date.now();
      this.error = undefined;
      console.log(`[Linear] synced ${this.projects.length} in-progress project(s)`);
    } catch (err) {
      // Keep the previous projects so a blip doesn't wipe the map.
      this.error = err instanceof Error ? err.message : String(err);
      console.warn(`[Linear] sync failed: ${this.error}`);
    }
    const status = this.getStatus();
    this.onStatus?.(status);
    return status;
  }

  private startTimer(): void {
    this.stop();
    this.timer = setInterval(() => { void this.poll(); }, this.pollMs);
  }
}
