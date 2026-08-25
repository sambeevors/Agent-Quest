import { useEffect, useRef, useState } from 'react';
import type { LinearStatus } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { LinearConnect } from './LinearConnect';
import './ConstructionPanel.css';

/**
 * Construction sites — in-progress Linear projects, rendered in the village as
 * buildings that finish as their issues close. This panel is the readable
 * companion to the sprites on the map: the same list, with exact counts, and a
 * way to pan the camera to a given site.
 *
 * When no API key is configured the panel offers the connect form rather than
 * hiding: a silently absent feature reads as a bug.
 */

interface ConstructionPanelProps {
  linear: LinearStatus | null;
  /** Applies a status the server returned after a key change, without waiting for the next push. */
  onLinearStatus: (status: LinearStatus) => void;
}

function relativeTime(ms: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function ConstructionPanel({ linear, onLinearStatus }: ConstructionPanelProps) {
  const [open, setOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Clicking a site on the map opens this panel with that project highlighted.
  useEffect(() => {
    const onSiteClick = (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null || !('id' in payload)) return;
      setHighlightId((payload as { id: string }).id);
      setOpen(true);
    };
    eventBridge.on('construction:clicked', onSiteClick);
    return () => eventBridge.off('construction:clicked', onSiteClick);
  }, []);

  // Nothing at all from the server yet — stay out of the way rather than
  // flashing an empty panel during connect.
  if (linear === null) return null;

  const projects = linear.projects;
  const count = projects.length;

  return (
    <div className="construction">
      <button
        ref={buttonRef}
        type="button"
        className="construction-button"
        aria-expanded={open}
        aria-label={linear.connected ? `Construction sites: ${count}` : 'Connect Linear'}
        title={linear.connected ? `${count} project(s) under construction` : 'Linear not connected'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="construction-icon" aria-hidden="true">{'\u{1F3D7}\u{FE0F}'}</span>
        <span className="construction-count">{linear.connected ? count : '—'}</span>
      </button>

      {open && (
        <>
          <div className="construction-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="construction-popover" role="dialog" aria-label="Construction sites">
            <div className="construction-pop-header">
              <span className="construction-pop-title">Construction Sites</span>
              {linear.connected && linear.lastSyncedAt !== null && (
                <span className="construction-synced">
                  synced {relativeTime(linear.lastSyncedAt, Date.now())}
                </span>
              )}
            </div>

            {!linear.connected ? (
              <div className="construction-empty">
                <p>Linear isn't connected.</p>
                <p className="construction-hint">
                  Every in-progress project becomes a building site that finishes
                  as its issues close.
                </p>
                <LinearConnect status={linear} onChanged={onLinearStatus} />
              </div>
            ) : linear.error !== undefined && projects.length === 0 ? (
              <div className="construction-empty">
                <p className="construction-error">{linear.error}</p>
                <LinearConnect status={linear} onChanged={onLinearStatus} />
              </div>
            ) : projects.length === 0 ? (
              <div className="construction-empty">
                <p>No projects in progress.</p>
                <p className="construction-hint">
                  Projects in a <em>started</em> or <em>planned</em> state show up here.
                </p>
                <LinearConnect status={linear} onChanged={onLinearStatus} />
              </div>
            ) : (
              <>
                {linear.error !== undefined && (
                  <p className="construction-error construction-error--stale">
                    Last sync failed ({linear.error}) — showing the previous state.
                  </p>
                )}
                <ul className="construction-list">
                  {projects.map((p) => {
                    const pct = Math.round(p.progress * 100);
                    const accent = p.color ?? '#C4A35A';
                    return (
                      <li
                        key={p.id}
                        className={`construction-item ${highlightId === p.id ? 'is-highlighted' : ''}`}
                      >
                        <button
                          type="button"
                          className="construction-item-main"
                          title="Show this site on the map"
                          onClick={() => eventBridge.emit('construction:focus', p.id)}
                        >
                          <span className="construction-item-head">
                            <span className="construction-name" style={{ color: accent }}>{p.name}</span>
                            <span className="construction-pct">{pct}%</span>
                          </span>
                          <span className="construction-bar">
                            <span
                              className="construction-bar-fill"
                              style={{ width: `${Math.max(2, pct)}%`, background: accent }}
                            />
                          </span>
                          <span className="construction-meta">
                            {p.completedIssues}/{p.totalIssues} issues
                            {p.targetDate !== undefined && ` · due ${p.targetDate}`}
                          </span>
                        </button>
                        <a
                          className="construction-link"
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in Linear"
                          aria-label={`Open ${p.name} in Linear`}
                        >{'↗'}</a>
                      </li>
                    );
                  })}
                </ul>
                <LinearConnect status={linear} onChanged={onLinearStatus} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
