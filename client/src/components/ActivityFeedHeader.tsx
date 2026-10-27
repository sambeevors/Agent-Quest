import type { FoldState } from '../hooks/useFeedPrefs';
import type { ActionFilter } from './activityFeedUtils';
import type { AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { heroNameFor } from '../naming/hero-names';

interface ActivityFeedHeaderProps {
  foldState: FoldState;
  activeHighlights: ActionFilter[];
  availableCategories: Set<ActionFilter>;
  categoryCounts: Record<ActionFilter, number>;
  agentFilter: string | null;
  agents: AgentState[];
  newCount: number;
  onFoldChange: (state: FoldState) => void;
  onHighlightsChange: (highlights: ActionFilter[]) => void;
  onClearAgentFilter: () => void;
}

const PILL_ORDER: { id: ActionFilter; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'errors',   label: 'Errors'   },
  { id: 'edits',    label: 'Edits'    },
  { id: 'bash',     label: 'Bash'     },
  { id: 'reads',    label: 'Reads'    },
  { id: 'agent',    label: 'Agent'    },
  { id: 'other',    label: 'Other'    },
];

/**
 * Each fold mode drawn as the panel it leaves you with — tall, half, just the
 * header bar — in 8x8 pixel blocks at x2, inked in the button's colour.
 * [x, y, w, h] per block.
 */
const FOLD_ICON: Record<FoldState, [number, number, number, number][]> = {
  full:    [[0, 0, 8, 1], [0, 7, 8, 1], [0, 0, 1, 8], [7, 0, 1, 8], [2, 2, 4, 1], [2, 4, 4, 1]],
  compact: [[0, 4, 8, 1], [0, 7, 8, 1], [0, 4, 1, 4], [7, 4, 1, 4], [2, 5, 4, 1]],
  closed:  [[0, 6, 8, 2]],
};

const FOLD_LABEL: Record<FoldState, string> = { full: 'Full', compact: 'Compact', closed: 'Close' };

function FoldIcon({ state }: { state: FoldState }) {
  return (
    <svg width="16" height="16" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      {FOLD_ICON[state].map(([x, y, w, h]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

export function ActivityFeedHeader({
  foldState, activeHighlights, availableCategories, categoryCounts,
  agentFilter, agents, newCount,
  onFoldChange, onHighlightsChange, onClearAgentFilter,
}: ActivityFeedHeaderProps) {
  const filteredAgent = agentFilter !== null ? agents.find((a) => a.id === agentFilter) ?? null : null;

  function toggleHighlight(id: ActionFilter) {
    if (activeHighlights.includes(id)) {
      onHighlightsChange(activeHighlights.filter((f) => f !== id));
    } else {
      onHighlightsChange([...activeHighlights, id]);
    }
  }

  const showSecondRow = foldState === 'full';
  const pills = PILL_ORDER.filter((p) => availableCategories.has(p.id));
  const hasChip = filteredAgent !== null;
  const secondRowHasContent = pills.length > 0 || hasChip;

  return (
    <div className="feed-header">
      <div className="feed-header-row">
        <span className="feed-title">
          Activity Feed
          {foldState === 'closed' && newCount > 0 && (
            <span className="feed-new-badge" aria-live="polite">{newCount} new</span>
          )}
        </span>

        <span className="feed-spacer" />

        <div className="feed-fold-buttons">
          {(['full', 'compact', 'closed'] as const).map((state) => (
            <button
              type="button"
              key={state}
              aria-label={FOLD_LABEL[state]}
              title={FOLD_LABEL[state]}
              aria-pressed={foldState === state}
              className={`feed-fold-btn ${foldState === state ? 'active' : ''}`}
              onClick={() => onFoldChange(state)}
            ><FoldIcon state={state} /></button>
          ))}
        </div>
      </div>

      {showSecondRow && secondRowHasContent && (
        <div className="feed-header-row feed-filter-row">
          {pills.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeHighlights.includes(id)}
              className={`feed-pill ${id} ${activeHighlights.includes(id) ? 'on' : ''}`}
              onClick={() => toggleHighlight(id)}
            >{label} ({categoryCounts[id]})</button>
          ))}
          {filteredAgent !== null && (
            <span className="feed-agent-chip">
              <HeroAvatar agent={filteredAgent} size={14} />
              <span>{heroNameFor(filteredAgent.id, filteredAgent.source)}</span>
              <button type="button" aria-label="Clear agent filter" className="feed-chip-close" onClick={onClearAgentFilter}>×</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
