"""The trainers heroes are named after — read from FireRed's own trainer table.

Every hero is one real trainer out of `src/data/trainers.h`: their class, the
name the game gives them, the overworld sprite that class walks around as, the
battle portrait it's shown with, and the Pokémon they send out last (their
ace, from `src/data/trainer_parties.h`), who follows them around town.

Only classes with a four-way walk cycle make the roster: most gym leaders and
a handful of classes (Psychic, Juggler, Super Nerd…) only ever stand still in
the game, so their sheets have nothing to walk with.
"""
from __future__ import annotations

import re
from pathlib import Path

# trainerClass -> (display class, overworld pic). A pic-specific entry
# (class, trainerPic) wins over the class's own, for classes that come in two
# genders. An empty display class means the trainer goes by name alone.
CLASSES: dict[str, tuple[str, str]] = {
    'YOUNGSTER': ('Youngster', 'youngster'),
    'BUG_CATCHER': ('Bug Catcher', 'bug_catcher'),
    'LASS': ('Lass', 'lass'),
    'SAILOR': ('Sailor', 'sailor'),
    'CAMPER': ('Camper', 'camper'),
    'PICNICKER': ('Picnicker', 'picnicker'),
    'POKEMANIAC': ('PokéManiac', 'poke_maniac'),
    'HIKER': ('Hiker', 'hiker'),
    'BIKER': ('Biker', 'biker'),
    'ENGINEER': ('Engineer', 'worker_m'),
    'FISHERMAN': ('Fisherman', 'fisher'),
    'BEAUTY': ('Beauty', 'beauty'),
    'ROCKER': ('Rocker', 'rocker'),
    'BLACK_BELT': ('Black Belt', 'black_belt'),
    'SCIENTIST': ('Scientist', 'scientist'),
    'GENTLEMAN': ('Gentleman', 'gentleman'),
    'CHANNELER': ('Channeler', 'channeler'),
    'CRUSH_GIRL': ('Crush Girl', 'crush_girl'),
    'BOSS': ('', 'giovanni'),
    'PKMN_PROF': ('', 'prof_oak'),
}
BY_PIC: dict[tuple[str, str], tuple[str, str]] = {
    ('COOLTRAINER', 'COOLTRAINER_M'): ('Cooltrainer', 'cooltrainer_m'),
    ('COOLTRAINER', 'COOLTRAINER_F'): ('Cooltrainer', 'cooltrainer_f'),
    ('SWIMMER_M', 'SWIMMER_M'): ('Swimmer', 'swimmer_m_land'),
    ('SWIMMER_F', 'SWIMMER_F'): ('Swimmer', 'swimmer_f_land'),
    ('TUBER', 'TUBER_F'): ('Tuber', 'tuber_f'),
    ('ELITE_FOUR', 'ELITE_FOUR_LORELEI'): ('', 'lorelei'),
    ('PLAYER', 'RED'): ('', 'red_normal'),
    ('PLAYER', 'LEAF'): ('', 'green_normal'),
    ('PLAYER', 'RS_BRENDAN_2'): ('', 'rs_brendan'),
    ('PLAYER', 'RS_MAY_2'): ('', 'rs_may'),
    ('RIVAL_EARLY', 'RIVAL_EARLY'): ('', 'blue'),
}
# The decomp's placeholder for the player-named rival.
RENAME = {'TERRY': 'Blue', 'PROF. OAK': 'Prof. Oak'}
# Trainers the game never battles in Kanto have a dummy party: who walks with
# them instead. Red's Pikachu, Leaf's Bulbasaur, the Hoenn starters, and the
# Nidoran♂ Oak shows off in FireRed's opening.
PARTNERS = {'Red': 25, 'Leaf': 1, 'Brendan': 252, 'May': 255, 'Prof. Oak': 32}
# The named characters' partners are their starters, so they start where a
# starter does.
PARTNER_LEVEL = 5
# Trainer pic constant -> front_pics/<file> where it isn't just lowercased.
PIC_FILES = {
    'COOLTRAINER_M': 'cool_trainer_m', 'COOLTRAINER_F': 'cool_trainer_f',
    'PROFESSOR_OAK': 'professor_oak', 'RS_BRENDAN_2': 'ruby_sapphire_brendan',
    'RS_MAY_2': 'ruby_sapphire_may', 'POKEMANIAC': 'pokemaniac',
}

# Codex sessions are Team Rocket. FireRed's grunts are all just "GRUNT", so
# these are the organisation's named members from across the series, each
# with their signature Pokémon.
ROCKETS = [
    ('Jessie', 'rocket_f', 'rocket_grunt_f', 24),    # Arbok
    ('James', 'rocket_m', 'rocket_grunt_m', 110),    # Weezing
    ('Cassidy', 'rocket_f', 'rocket_grunt_f', 20),   # Raticate
    ('Butch', 'rocket_m', 'rocket_grunt_m', 107),    # Hitmonchan
    ('Ariana', 'rocket_f', 'rocket_grunt_f', 24),    # Arbok
    ('Archer', 'rocket_m', 'rocket_grunt_m', 229),   # Houndoom
    ('Proton', 'rocket_m', 'rocket_grunt_m', 42),    # Golbat
    ('Petrel', 'rocket_m', 'rocket_grunt_m', 110),   # Weezing
]
# Their Pokémon are fully evolved already; this is roughly where FireRed's
# Rocket Hideout executives field them.
ROCKET_LEVEL = 25


def _title(name: str) -> str:
    if name in RENAME:
        return RENAME[name]
    return ' '.join(w.capitalize() for w in name.split(' '))


def _species(root: Path) -> dict[str, int]:
    text = (root / 'include' / 'constants' / 'species.h').read_text()
    return {m[1]: int(m[2]) for m in re.finditer(r'#define (SPECIES_\w+) (\d+)\b', text)}


def _parties(root: Path, species: dict[str, int]) -> dict[str, list[tuple[int, int]]]:
    """Each party as (species, level) pairs, in order."""
    text = (root / 'src' / 'data' / 'trainer_parties.h').read_text()
    out: dict[str, list[tuple[int, int]]] = {}
    for m in re.finditer(r'(sParty_\w+)\[\] = \{(.*?)\};', text, re.S):
        mons = re.findall(r'\.lvl = (\d+),\s*\.species = (SPECIES_\w+)', m[2])
        out[m[1]] = [(species[s], int(lvl)) for lvl, s in mons]
    return out


def roster(root: Path) -> list[dict]:
    """One entry per distinct (display class, name), in table order. A trainer
    fought more than once keeps the party from their first battle."""
    species = _species(root)
    parties = _parties(root, species)
    text = (root / 'src' / 'data' / 'trainers.h').read_text()
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for block in re.findall(r'\[TRAINER_\w+\] = \{(.*?)\n    \},', text, re.S):
        fields = {k: v for k, v in re.findall(r'\.(trainerClass|trainerPic) = TRAINER_(?:CLASS|PIC)_(\w+)', block)}
        name_m = re.search(r'\.trainerName = _\("([^"]*)"\)', block)
        party_m = re.search(r'\.party = \w+\((sParty_\w+)\)', block)
        if 'trainerClass' not in fields or 'trainerPic' not in fields or name_m is None or party_m is None:
            continue
        cls, pic, name, party = fields['trainerClass'], fields['trainerPic'], name_m[1], party_m[1]
        if not name or '&' in name or cls.startswith('RS_'):
            continue
        spec = BY_PIC.get((cls, pic)) or CLASSES.get(cls)
        if spec is None:
            continue
        mons = [(d, lvl) for d, lvl in parties.get(party, []) if 0 < d <= 386]
        if _title(name) in PARTNERS:
            mons = [(PARTNERS[_title(name)], PARTNER_LEVEL)]
        if not mons:
            continue
        display, sprite = spec
        key = (display, _title(name))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            'title': display,
            'name': _title(name),
            'sprite': sprite,
            'portrait': PIC_FILES.get(pic, pic.lower()),
            'partner': mons[-1][0],
            'partnerLevel': mons[-1][1],
        })
    return out


def rockets() -> list[dict]:
    return [
        {'title': 'Rocket', 'name': n, 'sprite': s, 'portrait': p, 'partner': d, 'partnerLevel': ROCKET_LEVEL}
        for n, s, p, d in ROCKETS
    ]
