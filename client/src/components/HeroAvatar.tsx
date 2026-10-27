import { useEffect, useRef, type CSSProperties } from 'react';
import { portraitUrl } from '../game/pokemon';
import type { AgentState } from '../types/agent';
import { trainerFor, trainerName } from '../naming/hero-names';

interface HeroAvatarProps {
  agent: AgentState;
  /**
   * Numeric pixel size, or 'inherit' to let the parent container drive
   * width/height via CSS (the background-size then scales in percentages
   * of that parent). Use 'inherit' when you want the avatar to respond
   * to a CSS variable, e.g. inside a responsive grid cell.
   *
   * IMPORTANT: when `size="inherit"`, the parent element MUST have an
   * explicit width AND height (either inline style or CSS). Without them
   * the avatar renders 0×0 silently. The dev-mode warning below logs
   * the failure once per element instance to surface layout mistakes
   * before they ship.
   */
  size?: number | 'inherit';
  className?: string;
  title?: string;
}

const DEFAULT_SIZE = 24;

export function HeroAvatar({ agent, size = DEFAULT_SIZE, className, title }: HeroAvatarProps) {
  // The trainer's FireRed battle portrait, cropped square to the face.
  const trainer = trainerFor(agent.id, agent.source);
  const inherit = size === 'inherit';
  const sizeStyle: CSSProperties = inherit
    ? { width: '100%', height: '100%' }
    : { width: size, height: size };

  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!inherit) return;
    if (import.meta.env.MODE === 'production') return;
    const el = ref.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn(
        '[HeroAvatar] size="inherit" requires the parent to have explicit width and height — got 0×0.',
        el.parentElement,
      );
    }
  }, [inherit]);

  return (
    <div
      ref={ref}
      className={className}
      title={title ?? trainerName(trainer)}
      role="img"
      aria-label={trainerName(trainer)}
      style={{
        backgroundImage: `url('${portraitUrl(trainer)}')`,
        backgroundSize: '100% 100%',
        backgroundPosition: '0 0',
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        flexShrink: 0,
        ...sizeStyle,
      }}
    />
  );
}
