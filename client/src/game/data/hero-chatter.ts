import type { AgentActivity } from '../../types/agent';

/**
 * Thought-bubble chatter: the short lines that flash above a hero's head.
 *
 * The hero labels used to carry the session's live detail (activity, model,
 * file, prompt) stacked under the sprite, which buried the village under four
 * rows of log text per hero. That detail lives in the React panels, so the
 * canvas keeps the name and says what a hero is *thinking* instead — a bubble
 * every few seconds, drawn from the pool for whatever it is currently doing.
 *
 * Lines are flavour, never information: nothing here is derived from session
 * state, so a bubble can never go stale or leak a path into a screenshot.
 *
 * Two rules keep them in the village. They speak in the register of the
 * BUILDING the activity sends the hero to — the Forge hammers, the Alchemist
 * brews — rather than naming the tool that got them there, so no line
 * mentions a grep or a stack trace. And they stay under ~34 characters: the
 * bubble wraps at 168px and a third line covers the hero underneath it.
 *
 * One thing to watch when adding lines: vary their SHAPE, not just their
 * words. A pool where every entry runs 'Statement. Qualifier.' — 'Victory.
 * Barely.', 'Hmm. Unforeseen.' — reads as one voice with a tic, however
 * different the nouns are. Mix questions, fragments, and a couple of lines
 * long enough to need a comma.
 */

/** What a hero is doing, as far as the bubbles are concerned. */
export type ChatterMood = AgentActivity | 'waiting' | 'error';

export const CHATTER_LINES: Record<ChatterMood, readonly string[]> = {
  // Tavern.
  idle: [
    'Anything else?',
    'Taking a breather.',
    'Quiet round here.',
    'Fine weather for it.',
    'Sharpening my blade.',
    'Zzz…',
    'I could go again.',
    'No quests today?',
    'To the tavern, then.',
    'Idle hands…',
    'Ready when you are.',
    'My feet have gone to sleep.',
  ],
  // Castle — a council of one.
  thinking: [
    'Give me a moment…',
    'There must be a wiser road.',
    'Two paths. Both cursed.',
    'What if…',
    'On second thoughts…',
    'The plan is nearly whole.',
    'Nay, not that one.',
    'Would that serve?',
    'Let me draw the map.',
    'A council of one.',
    'I turn it over and over.',
    'Hmm.',
  ],
  // Library — tomes, scrolls and dust.
  reading: [
    'Hmm, curious…',
    'These scrolls run deep.',
    'There it is, at last.',
    'Who penned this?',
    'One more tome…',
    'Dust and riddles.',
    'Someone underlined this bit.',
    'The margins hold secrets.',
    'A map, of sorts.',
    'Read it twice, they say.',
    'Ten thousand pages of this?',
    'Aha!',
  ],
  // Forge — hammer, anvil, sparks.
  editing: [
    'Back to the anvil.',
    'A few strikes more.',
    'Reforging this.',
    'The steel folds nicely.',
    'Melt it down and start over.',
    'One tap, I promise.',
    'Sparks everywhere!',
    'Careful now…',
    'That has a better edge.',
    'A little polish.',
    'The forge wants more coal.',
    'Right. Where were we?',
  ],
  // Arena — every command is a bout.
  bash: [
    'Into the ring.',
    'Stand well back.',
    'Fingers crossed.',
    'A clean strike!',
    'Come on, come on…',
    'That was quick work.',
    'Still swinging…',
    'One more bout.',
    'The dust settles.',
    'I won, but only just.',
    'The crowd stirs.',
    'Again, from the top.',
  ],
  // Chapel — the hero has published something.
  git: [
    'Let it be written.',
    'Carve it in stone.',
    'Sending it forth.',
    'The ink is dry.',
    'A blessing on this work.',
    'The scribes are ready.',
    'Signed, sealed…',
    'Off it goes.',
    'One for the chronicles!',
    'The wax is still warm.',
    'Ring the bells!',
    'May the omens be kind.',
  ],
  // Alchemist — a bad brew, hunted down.
  debugging: [
    'The recipe lies.',
    'Curious.',
    'It brewed fine yesterday.',
    'Where are you hiding?',
    'One drop too many, always.',
    'Another candle, more light…',
    'Caught it in the flask!',
    'The vial is empty again.',
    'Not the beast I expected.',
    'Right, from the first page.',
    'Blame the moon.',
    'Gotcha, little gremlin.',
  ],
  // Watchtower — walls, gaps and the horizon.
  reviewing: [
    'Nearly, but not quite.',
    'The walls look sound.',
    'One small nick, sorry.',
    'Has this been proven?',
    'I will check the far side.',
    'Send it onward.',
    'A gap in the wall, there.',
    'Neat handiwork, that.',
    'Mark this on the map.',
    'No arrows from me.',
    'Scanning the horizon…',
    'And if the gate fails?',
  ],
  waiting: [
    'Your word, my liege.',
    'Awaiting orders.',
    'Still here…',
    'A yea or a nay?',
    'Anyone there?',
    'The gate stays shut.',
    'I shall wait.',
    'Leave to proceed?',
    'Any moment now…',
    'Hello?',
    'My horse is getting cold.',
    'I have counted the stones.',
  ],
  error: [
    'That did not work…',
    'That went up in flames.',
    'It bites!',
    'Not again!',
    'Ow.',
    'The potion turned black.',
    'Down I go.',
    'I did not foresee that.',
    'Back to the map table.',
    'A curse upon it.',
    'Something broke, loudly.',
    'Let me try another way.',
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
