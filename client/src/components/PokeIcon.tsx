import { iconUrl, type UiIcon } from '../game/pokemon';
import './PokeIcon.css';

/**
 * A FireRed icon where an emoji used to be. Decorative: the control it sits in
 * carries the label. Drawn at its native size, centred in a 24px box, so the
 * 24px item icons and the 16px emote bubbles share a footprint without either
 * being scaled off the pixel grid.
 */
export function PokeIcon({ icon, className }: { icon: UiIcon; className?: string }) {
  return (
    <img
      src={iconUrl(icon)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className === undefined ? 'poke-icon' : `poke-icon ${className}`}
    />
  );
}
