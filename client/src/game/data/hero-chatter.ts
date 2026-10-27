import type { AgentActivity } from '../../types/agent';

/**
 * Thought-bubble chatter: the short lines that flash above a trainer's head.
 *
 * The hero labels used to carry the session's live detail (activity, model,
 * file, prompt) stacked under the sprite, which buried the town under four
 * rows of log text per hero. That detail lives in the React panels, so the
 * canvas keeps the name and says what a trainer is *thinking* instead — a
 * bubble every few seconds, drawn from the pool for whatever it is doing.
 *
 * Lines are flavour, never information: nothing here is derived from session
 * state, so a bubble can never go stale or leak a path into a screenshot.
 *
 * Two rules keep them in Cerulean City. They speak in the register of the
 * PLACE the activity sends the trainer to — the Pokémon Center heals, the
 * Gym judges, Nugget Bridge battles — rather than naming the tool that got
 * them there, so no line mentions a grep or a stack trace. And they stay
 * under ~34 characters: the bubble wraps at 168px and a third line covers
 * the trainer underneath it. FireRed's own capitals (POKéMON, POTION) are
 * part of the voice.
 *
 * One thing to watch when adding lines: vary their SHAPE, not just their
 * words. A pool where every entry is an exclamation reads as one voice with
 * a tic, however different the nouns are. Mix questions, fragments, and a
 * couple of lines long enough to need a comma.
 */

/** What a hero is doing, as far as the bubbles are concerned. */
export type ChatterMood = AgentActivity | 'waiting' | 'error';

export const CHATTER_LINES: Record<ChatterMood, readonly string[]> = {
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
    'The couch here is comfy.',
    'Should I deposit a few?',
    'Full HP, all six of them.',
  ],
  // Badge House — the old man who explains what a BADGE is for.
  thinking: [
    'Hmm… what would OAK do?',
    'There’s a time and place…',
    'Let me think this through.',
    'Which one should I choose?',
    'Hmm.',
    'A strategy is forming!',
    'If I lead with a GRASS type…',
    'No, wait…',
    'What does this BADGE do?',
    'Type matchups, type matchups…',
    'Maybe the long way round.',
    'I need a plan for MISTY.',
  ],
  // Trade House.
  reading: [
    'TRAINER TIPS!',
    'Reading the notebook…',
    'So that’s how it works!',
    'Status moves are key.',
    'Page after page…',
    'Did you know…?',
    'I should take notes.',
    'Where was that chapter?',
    'Let me check the POKéDEX.',
    'What’s that one evolve into?',
    'A trade? Let me read the terms.',
    'Huh. Fascinating.',
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
    'A million POKé DOLLARS?!',
    'Swap the seat, keep the frame.',
    'Does this bell work?',
    'Nearly there…',
  ],
  // Nugget Bridge — five trainers in a row, and one more waiting.
  bash: [
    'A wild POKéMON appeared!',
    'Go! Use TACKLE!',
    'It’s super effective!',
    'Come on, one more hit!',
    'It’s not very effective…',
    'Who’s next on the bridge?',
    'Critical hit!',
    'Five in a row!',
    'You want a NUGGET?',
    'I won’t lose this one.',
    'Return! Go, partner!',
    'Our eyes met — battle!',
  ],
  // The flower bed by the Bike Shop.
  git: [
    'Watering the flowers.',
    'Growing nicely!',
    'Plant it, then share it.',
    'A whole bed, in bloom.',
    'The SQUIRTBOTTLE works!',
    'Done here — next flower!',
    'Pretty, aren’t they?',
    'Bloom where you’re planted.',
    'These ones are for everyone.',
    'Careful not to trample them.',
    'A little more water…',
    'Look how they’ve come up!',
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
    'Is it burned? Asleep?',
    'Two PARLYZ HEALS, please.',
    'May I help you?',
    'Out of ESCAPE ROPES again.',
  ],
  // Cerulean Gym.
  reviewing: [
    'Show me your best!',
    'Let’s see your BADGES.',
    'Not bad… not bad at all.',
    'Another challenger?',
    'Send in the next one!',
    'I’ll judge that battle.',
    'You call that training?',
    'The CASCADEBADGE? Earn it.',
    'Hmm, let me look closer.',
    'Your form needs work.',
    'Good. Very good, in fact.',
    'Again, from the top.',
  ],
  waiting: [
    'Waiting for your call!',
    '…',
    'Trainer, what’s next?',
    'Should I keep going?',
    'Hello? Professor?',
    'I’ll wait right here.',
    'Ahem.',
    'Any orders?',
    'Tapping my foot…',
    'Did you forget about me?',
    'Whenever you’re ready!',
    'Just say the word.',
  ],
  error: [
    'It fainted!',
    'Oh no! It missed!',
    'It hurt itself in confusion!',
    'Blacked out…',
    'That didn’t work!',
    'Ugh — back to the CENTER.',
    'It’s stuck! It can’t move!',
    'The attack went wide!',
    'What?! It evolved… no?',
    'That was a mistake.',
    'Oof.',
    'Not like this!',
  ],
};

/** How long a bubble stays on screen once it pops. */
export const CHATTER_HOLD_MS = 3400;

const CHATTER_MIN_GAP_MS = 14000;
const CHATTER_MAX_GAP_MS = 36000;

/**
 * Milliseconds until a hero's next thought. Two things set the range. The
 * spread is wide on purpose — a dozen heroes seeded at the same moment would
 * otherwise pop in unison and read as a UI event rather than as villagers
 * muttering to themselves. And the floor is high enough that a bubble is an
 * occasional aside: at a 25s average a hero is quiet about seven times as
 * long as it speaks, which is the difference between flavour and a feed.
 */
export function nextChatterDelay(random: () => number = Math.random): number {
  return CHATTER_MIN_GAP_MS + random() * (CHATTER_MAX_GAP_MS - CHATTER_MIN_GAP_MS);
}

/**
 * A line for the mood, never the one that was just shown — repeating the same
 * thought back-to-back is the one thing that makes the pool feel small.
 */
export function pickChatterLine(
  mood: ChatterMood,
  previous: string | null = null,
  random: () => number = Math.random,
): string {
  const pool = CHATTER_LINES[mood];
  const choices = pool.length > 1 ? pool.filter((line) => line !== previous) : pool;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  return choices[index]!;
}
