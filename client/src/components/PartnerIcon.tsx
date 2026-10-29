import { pokemonIconUrl } from '../game/pokemon';
import { speciesName } from '../progress/evolution';
import './PartnerIcon.css';

/**
 * A partner Pokémon's party icon, resting frame, at native 32px (or `size`).
 * The strip holds a rest frame and a hop frame side by side; the hop plays
 * on hover, as it does on FireRed's party screen when a slot is selected.
 */
export function PartnerIcon({ species, size = 32 }: { species: number; size?: number }) {
  return (
    <span
      className="partner-icon"
      role="img"
      aria-label={speciesName(species)}
      title={speciesName(species)}
      style={{ width: size, height: size, backgroundImage: `url('${pokemonIconUrl(species)}')` }}
    />
  );
}
