"""Draw PokéAgent's logo, desktop icon and README banner.

Everything is pixel art built from what the app already ships: the wordmark is
set in RuneScape at its native 16px (the panels' face), coloured like a
Pokémon title — yellow fill, blue outline — and Pikachu is the bake's own Gen
III party icon. Each image is drawn at 1x and scaled up nearest-neighbour.

    python3 scripts/brand.py

Writes client/public/assets/logo.png, desktop/build-resources/icon.png and
docs/banner.jpg. Run it again after changing anything here; the outputs are
committed.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'client/public/assets/fonts/runescape.ttf'
PIKACHU = ROOT / 'client/public/assets/pokemon/pokemon/25.png'
GROUND = ROOT / 'client/public/assets/pokemon/town/ground.png'
OVERHEAD = ROOT / 'client/public/assets/pokemon/town/overhead.png'

NAME = 'PokéAgent'
FILL = (255, 203, 5, 255)       # title yellow
SHADE = (199, 160, 8, 255)      # lower half of each letter
OUTLINE = (42, 117, 187, 255)   # title blue
DEEP = (24, 52, 110, 255)       # drop shadow
PANEL = (26, 26, 46, 255)       # the app's background, index.html


def wordmark() -> Image.Image:
    """The name, 1x: a 1px blue outline, a darker drop shadow, two-tone fill."""
    font = ImageFont.truetype(str(FONT), 16)
    left, top, right, bottom = font.getbbox(NAME)
    w, h = right - left, bottom - top
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.fontmode = '1'
    d.text((-left, -top), NAME, font=font, fill=255)

    pad = 2
    out = Image.new('RGBA', (w + pad * 2, h + pad * 2 + 1), (0, 0, 0, 0))
    solid = lambda c: Image.new('RGBA', mask.size, c)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1, 2):
            colour = DEEP if dy == 2 else OUTLINE
            out.paste(solid(colour), (pad + dx, pad + dy), mask)
    out.paste(solid(FILL), (pad, pad), mask)
    lower = mask.crop((0, h // 2, w, h))
    out.paste(Image.new('RGBA', lower.size, SHADE), (pad, pad + h // 2), lower)
    return out


def pikachu() -> Image.Image:
    """First frame of the party icon, trimmed to the sprite."""
    icon = Image.open(PIKACHU).convert('RGBA').crop((0, 0, 32, 32))
    return icon.crop(icon.getbbox())


def logo() -> Image.Image:
    """Pikachu standing on the wordmark, 1x."""
    word, mon = wordmark(), pikachu()
    w = max(word.width, mon.width)
    out = Image.new('RGBA', (w, mon.height + word.height - 2), (0, 0, 0, 0))
    out.alpha_composite(mon, ((w - mon.width) // 2, 0))
    out.alpha_composite(word, ((w - word.width) // 2, mon.height - 2))
    return out


def scale(img: Image.Image, k: int) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def icon() -> Image.Image:
    """macOS app icon: Pikachu on the app's own navy, in the standard squircle inset."""
    size, inset, radius = 1024, 100, 185
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(out).rounded_rectangle(
        (inset, inset, size - inset, size - inset), radius, fill=PANEL, outline=OUTLINE, width=16)
    mon = scale(pikachu(), 22)
    out.alpha_composite(mon, ((size - mon.width) // 2, (size - mon.height) // 2))
    return out


def banner() -> Image.Image:
    """README banner: the logo over a darkened slice of Cerulean City."""
    w, h = 1280, 698
    town = Image.alpha_composite(
        Image.open(GROUND).convert('RGBA'), Image.open(OVERHEAD).convert('RGBA'))
    cx, cy = town.width // 2, town.height // 2
    bg = town.crop((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2))
    bg = Image.alpha_composite(bg, Image.new('RGBA', bg.size, (*PANEL[:3], 170)))
    mark = scale(logo(), 7)
    bg.alpha_composite(mark, ((w - mark.width) // 2, (h - mark.height) // 2))
    return bg.convert('RGB')


if __name__ == '__main__':
    scale(logo(), 12).save(ROOT / 'client/public/assets/logo.png')
    icon().save(ROOT / 'desktop/build-resources/icon.png')
    banner().save(ROOT / 'docs/banner.jpg', quality=92)
