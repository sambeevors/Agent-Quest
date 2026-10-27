import type { ChatterMood } from '../data/hero-chatter';

/**
 * Thought bubbles for the Pokémon theme. Same contract as the defaults in
 * data/hero-chatter.ts — each pool speaks in the register of the building the
 * activity sends a trainer to (the Pokémon Center heals, the Gym judges), no
 * line is derived from session state, and every line stays short enough to
 * fit the bubble in two rows.
 */
export const POKEMON_CHATTER: Record<ChatterMood, readonly string[]> = {
  // Pokémon Center.
  idle: [
    'Your POKéMON are fighting fit!',
    'We hope to see you again!',
    'Ding-ding-di-ding!',
    'Is anyone using the PC?',
    'Just resting my team.',
    'Zzz…',
    'Nurse Joy is so nice.',
    'Where to next?',
    'Ready when you are!',
  ],
  // Oak's Lab.
  thinking: [
    'Hmm… what would OAK do?',
    'There’s a time and place…',
    'Let me think this through.',
    'Which one should I choose?',
    'Hmm.',
    'A strategy is forming!',
    'If I lead with a GRASS type…',
    'No, wait…',
  ],
  // Trainer School.
  reading: [
    'TRAINER TIPS!',
    'Reading the notebook…',
    'So that’s how it works!',
    'Status moves are key.',
    'Page after page…',
    'Did you know…?',
    'I should take notes.',
    'Where was that chapter?',
  ],
  // Bike Shop.
  editing: [
    'Tightening the spokes!',
    'One more adjustment.',
    'Good as new!',
    'A BICYCLE, custom-built.',
    'Hand me that wrench?',
    'Almost rideable!',
    'Measure twice, cut once.',
    'Oil, then the chain.',
  ],
  // Tall grass.
  bash: [
    'A wild POKéMON appeared!',
    'Go! Use TACKLE!',
    'It’s super effective!',
    'Come on, one more hit!',
    'It’s not very effective…',
    'Rustle rustle…',
    'Critical hit!',
    'Got away safely!',
  ],
  // Flower Garden.
  git: [
    'Watering the flowers.',
    'Growing nicely!',
    'Plant it, then share it.',
    'A whole bed, in bloom.',
    'The SQUIRTBOTTLE works!',
    'Done here — next bed!',
  ],
  // Poké Mart.
  debugging: [
    'A POTION should fix it.',
    'Maybe an ANTIDOTE?',
    'FULL HEAL, please!',
    'What went wrong there?',
    'Let me try a REVIVE.',
    'Something’s off…',
    'Restocking the BAG.',
    'Was it paralysed?',
  ],
  // Pokémon Gym.
  reviewing: [
    'Show me your best!',
    'Let’s see your BADGES.',
    'Not bad… not bad at all.',
    'Another challenger?',
    'Send in the next one!',
    'I’ll judge that battle.',
    'You call that training?',
  ],
  waiting: [
    'Waiting for your call!',
    '…',
    'Trainer, what’s next?',
    'Should I keep going?',
    'Hello? Professor?',
  ],
  error: [
    'It fainted!',
    'Oh no! It missed!',
    'It hurt itself in confusion!',
    'Blacked out…',
    'That didn’t work!',
    'Ugh — back to the CENTER.',
  ],
};
