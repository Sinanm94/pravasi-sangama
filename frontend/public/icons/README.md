# App Icons

**Generated — do not hand-edit.** Rendered from `../Pravasi-sangama-mark.png` (the swoosh alone, cropped
from the full lockup). The lockup is unreadable below ~64px, so it is never
the icon source.

| File                    | Size    | Purpose    | Consumer                        |
| ----------------------- | ------- | ---------- | ------------------------------- |
| `icon-192.png`          | 192×192 | `any`      | Home screen, shortcuts, favicon |
| `icon-512.png`          | 512×512 | `any`      | Splash screen                   |
| `icon-maskable-512.png` | 512×512 | `maskable` | Android adaptive                |
| `apple-touch-icon.png`  | 180×180 | —          | iOS, via `metadata.icons.apple` |

## Maskable safe zone

Android crops maskable icons to a circle, squircle or rounded square depending
on launcher. All meaningful content must sit inside the **centre 80%** (a 409px
circle within the 512px canvas), which is why the maskable variant scales the
mark to 56% where the `any` icons use 76%. The `any` icons are not cropped.

## Background — split by platform, not one rule

Previously everything here was opaque white. That was too broad: it fixed a
real problem (favicon/apple-touch-icon transparency) by applying the fix to
files that never had that problem and looked worse for it — a white square
around the mark on a page that is not white.

**Transparent** — `icon-192.png`, `icon-512.png` (manifest `any`), and
`app/icon.png` / `app/favicon.ico` next to this directory. Nothing platform-
mandated forces these opaque, and rendering on whatever surface is behind
them (a browser tab, a light or dark OS theme) is the whole point of `any`.

Trade-off, measured rather than assumed: the swoosh is dark violet, and on a
dark browser tab (~`#202124`) its brightest pass is only 2.15:1 against the
tab colour — legible (the outer rim reads), but softer than on white. This is
the same contrast problem §5.3 documents for the masthead, applied to a
surface the app cannot control. If it needs to be more legible in dark mode
later, the fix is a subtle light backing plate sized close to the mark, not a
return to a hard white square.

**Opaque, deliberately** — `icon-maskable-512.png`, `apple-touch-icon.png`,
and `app/apple-icon.png` next to this directory. Not a style choice; making
these transparent breaks them:

- **`apple-icon.png`** — iOS/Safari does not composite transparent regions
  when installing a home-screen icon. It fills them **solid black**. A
  transparent apple-icon does not look "clean," it looks like the artwork
  broke.
- **`icon-maskable-512.png`** — the [maskable icon
  spec](https://web.dev/articles/maskable-icon) is explicit that these must
  not rely on transparency: different Android launchers apply different
  masks and fills to the un-cropped square, and the result is inconsistent
  rather than merely styled differently.

White, matching `manifest.json`'s `background_color` (`#f9fafb`).

## Regenerating

Requires ImageMagick. Run from `frontend/public`:

```bash
# Transparent — background stays none straight through.
gen_transparent() {
  inner=$(python3 -c "print(int($1*$2))")
  magick -background none Pravasi-sangama-mark.png -resize ${inner}x${inner} \
    -background none -gravity center -extent ${1}x${1} -strip PNG32:"icons/$3"
}
gen_transparent 192 0.80 icon-192.png
gen_transparent 512 0.80 icon-512.png

# Opaque — flattened onto white on purpose. See "Background" above.
gen_opaque() {
  inner=$(python3 -c "print(int($1*$2))")
  magick -background none Pravasi-sangama-mark.png -resize ${inner}x${inner} \
    -background white -gravity center -extent ${1}x${1} -strip PNG32:"icons/$3"
}
gen_opaque 512 0.56 icon-maskable-512.png
gen_opaque 180 0.76 apple-touch-icon.png

# ../../src/app/{icon.png,apple-icon.png,favicon.ico} follow the same split —
# icon.png and favicon.ico transparent, apple-icon.png opaque. Regenerate
# with the same two functions, output paths adjusted.
```
