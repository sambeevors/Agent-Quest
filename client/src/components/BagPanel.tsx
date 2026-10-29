import { useEffect, useState } from 'react';
import { PokeIcon } from './PokeIcon';
import { PartnerIcon } from './PartnerIcon';
import { portraitUrl } from '../game/pokemon';
import { trainerName } from '../naming/hero-names';
import { formatStationTime, STATION_ITEMS, STATION_ORDER } from '../progress/stations';
import type { Tally } from '../progress/tally';
import './BagPanel.css';

interface BagPanelProps {
  tally: Tally | null;
  onClose: () => void;
}

/**
 * The Bag: everything the town's stations have handed out, for the whole
 * fleet and trainer by trainer. Counts are time — one item per minute spent
 * at the place that gives it — so the Items pocket reads as where the
 * agents' hours have gone, and the Trainers pocket as who spent them.
 */
export function BagPanel({ tally, onClose }: BagPanelProps) {
  const [pocket, setPocket] = useState<'items' | 'trainers'>('items');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trainers = tally === null
    ? []
    : [...tally.byTrainer.values()].filter((t) => t.xp > 0).sort((a, b) => b.xp - a.xp);

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal bag-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Bag">
        <button className="settings-close" onClick={onClose} title="Close (Esc)">×</button>
        <h2 className="settings-title bag-title"><PokeIcon icon="bag" /> Bag</h2>

        <div className="bag-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={pocket === 'items'}
            className={`bag-tab ${pocket === 'items' ? 'active' : ''}`}
            onClick={() => setPocket('items')}
          >Items</button>
          <button
            type="button"
            role="tab"
            aria-selected={pocket === 'trainers'}
            className={`bag-tab ${pocket === 'trainers' ? 'active' : ''}`}
            onClick={() => setPocket('trainers')}
          >Trainers</button>
        </div>

        {tally === null ? (
          <p className="settings-muted">Counting…</p>
        ) : pocket === 'items' ? (
          <>
            <ul className="bag-items">
              {STATION_ORDER.map((a) => {
                const item = STATION_ITEMS[a];
                return (
                  <li key={a} className="bag-item">
                    <PokeIcon icon={item.icon} />
                    <span className="bag-item-name">
                      {item.plural}
                      <span className="bag-item-place">{item.place}</span>
                    </span>
                    <span className="bag-item-time">{formatStationTime(tally.global.activityMs[a] ?? 0)}</span>
                    <span className="bag-item-count">×{tally.global.items[a].toLocaleString()}</span>
                  </li>
                );
              })}
            </ul>
            <p className="bag-foot">
              {tally.global.xp.toLocaleString()} XP across {trainers.length} trainer{trainers.length === 1 ? '' : 's'}.
              One item per minute at a station.
            </p>
          </>
        ) : trainers.length === 0 ? (
          <p className="settings-muted">No trainer has earned anything yet.</p>
        ) : (
          <div className="bag-trainers-scroll">
            <table className="bag-trainers">
              <thead>
                <tr>
                  <th scope="col">Trainer</th>
                  <th scope="col">Partner</th>
                  {STATION_ORDER.map((a) => (
                    <th key={a} scope="col" title={STATION_ITEMS[a].plural}><PokeIcon icon={STATION_ITEMS[a].icon} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trainers.map((t) => (
                  <tr key={t.key}>
                    <th scope="row" className="bag-trainer">
                      <img className="bag-portrait" src={portraitUrl(t.trainer)} alt="" />
                      <span className="bag-trainer-name">
                        {trainerName(t.trainer)}
                        <span className="bag-item-place">{t.sessions} session{t.sessions === 1 ? '' : 's'}</span>
                      </span>
                    </th>
                    <td className="bag-partner">
                      <PartnerIcon species={t.species} />
                      <span className="bag-level">Lv{t.level}</span>
                    </td>
                    {STATION_ORDER.map((a) => (
                      <td key={a} className={`bag-count ${t.items[a] === 0 ? 'zero' : ''}`}>{t.items[a]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
