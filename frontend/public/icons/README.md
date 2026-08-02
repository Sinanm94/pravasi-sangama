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

## Background

White, matching `manifest.json`'s `background_color` (`#f9fafb`).

Deliberately **not** navy, despite navy being `theme_color`: the mark contains
a near-white counter (`#F7F8FB`) drawn to blend into a light background. On
navy that counter reads as an unintended white blob in the middle of the
flame. Fully opaque either way — a transparent PNG renders as a black square
on some Android launchers.

## Regenerating

Requires ImageMagick. Run from `frontend/public`:

```bash
gen() {
  inner=$(python3 -c "print(int($1*$2))")
  magick -background none Pravasi-sangama-mark.png -resize ${inner}x${inner} \
    -background white -gravity center -extent ${1}x${1} -strip PNG32:"icons/$3"
}
gen 192 0.76 icon-192.png
gen 512 0.76 icon-512.png
gen 512 0.56 icon-maskable-512.png
gen 180 0.76 apple-touch-icon.png
```
