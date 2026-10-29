"""Level-up evolution chains and species names, from the decomp.

Partners level up as their trainers work (client/src/progress/), and evolve
when they reach the level FireRed evolves them at. Only plain EVO_LEVEL
counts: a partner never meets a stone, a trade or a friendship check, so a
Pikachu stays a Pikachu and a Kadabra stays a Kadabra.
"""
from __future__ import annotations

import re
from pathlib import Path


def evolutions(root: Path, species: dict[str, int]) -> dict[int, dict[str, int]]:
    """dex -> {'level': n, 'into': dex}, for every species with a level-up evolution."""
    text = (root / 'src' / 'data' / 'pokemon' / 'evolution.h').read_text()
    out: dict[int, dict[str, int]] = {}
    for m in re.finditer(r'\[(SPECIES_\w+)\]\s*=\s*\{\{EVO_LEVEL,\s*(\d+),\s*(SPECIES_\w+)\}', text):
        out[species[m[1]]] = {'level': int(m[2]), 'into': species[m[3]]}
    return out


def chain(start: int, evos: dict[int, dict[str, int]]) -> list[int]:
    """`start` and everything it grows into, in order."""
    out = [start]
    while out[-1] in evos:
        out.append(evos[out[-1]]['into'])
    return out


def species_names(root: Path, species: dict[str, int], wanted: set[int]) -> dict[int, str]:
    """dex -> name as the game prints it, title-cased for the panels (PIDGEY → Pidgey)."""
    text = (root / 'src' / 'data' / 'text' / 'species_names.h').read_text()
    out: dict[int, str] = {}
    for m in re.finditer(r'\[(SPECIES_\w+)\]\s*=\s*_\("([^"]*)"\)', text):
        dex = species.get(m[1])
        if dex in wanted:
            out[dex] = _display(m[2])
    return out


def _display(name: str) -> str:
    return ' '.join(w[:1] + w[1:].lower() if w[:1].isalpha() else w for w in name.split(' '))
