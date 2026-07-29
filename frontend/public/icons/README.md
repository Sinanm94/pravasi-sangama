# App Icons

Placeholder entries only — `manifest.json` references these paths, and the
service worker precaches the first two. **Until real files exist here, install
prompts will not appear and `[sw] precache miss` will log on every install.**

| File                    | Size    | Purpose   | Notes                                    |
| ----------------------- | ------- | --------- | ---------------------------------------- |
| `icon-192.png`          | 192×192 | `any`     | Home screen, shortcuts                   |
| `icon-512.png`          | 512×512 | `any`     | Splash screen                            |
| `icon-maskable-512.png` | 512×512 | `maskable`| Android adaptive — see safe zone below   |

## Maskable safe zone

Android crops maskable icons to a circle, squircle or rounded square depending
on launcher. Keep all meaningful content inside the **centre 80%** (a 409px
circle within the 512px canvas). Artwork that fills the full square will have
its corners cut off.

The `any` icons are *not* cropped, so they can use the full canvas.

## Suggested treatment

Deep maroon `#062B59` field, gold `#d4af37` mark, no transparency — a
transparent PNG renders as a black square on some Android launchers.
