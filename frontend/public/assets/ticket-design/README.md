# Ticket Design Assets

Paste the exported design files here, then uncomment the matching line in
`frontend/src/lib/ticketAssets.ts`. Nothing is auto-discovered — an entry stays
`undefined` until you enable it, and `TicketReceipt` renders its CSS fallback.

```
ticket-design/
├── backgrounds/
│   ├── ticket-bg.png          # full-bleed navy surface (main body)
│   ├── stub-bg.png            # stub panel, if separately designed
│   └── texture-overlay.png    # paper grain — MUST have an alpha channel
├── ribbons/
│   ├── ribbon-normal.svg      # fixed-width, tier name baked in
│   ├── ribbon-vip.svg
│   ├── ribbon-vvip.svg
│   └── ribbon-svip.svg
├── ornaments/
│   ├── corner-dots.svg
│   ├── divider-dashed.svg     # small vertical tile, repeated down the seam
│   └── diamond.svg
└── brand/
    ├── kcf-logo.svg
    ├── event-lockup.svg
    └── seal.svg
```

## Export rules

- **SVG** for anything flat-color or line-work (ribbons, ornaments, logos). Stays
  crisp at print DPI.
- **PNG** only for raster texture and photographic backgrounds. Export at **3×**
  the rendered size — the ticket body renders ~675px wide, so ship ~2025px — or
  print output looks soft.
- **Ribbons** render at `h-9` (36px) with width auto. Keep all four exports at the
  same height so tiers don't jump. The tier label is assumed baked in; if your
  plates are blank, set `ribbonHasLabel: false` and the component overlays it.
- **Divider** should be one short dash tile (e.g. 3×12px), not a full-height
  strip — it repeats vertically.
- **Texture** renders at `opacity-40` with `mix-blend-overlay`, so export it
  neutral-grey and let the blend do the tinting.
