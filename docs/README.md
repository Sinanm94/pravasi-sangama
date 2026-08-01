# docs

`USER-MANUAL.html` is the source. `USER-MANUAL.pdf` is generated from it and
committed so the manual can be handed over without a toolchain.

## Regenerating the PDF

```bash
soffice --headless --convert-to pdf docs/USER-MANUAL.html --outdir docs
```

## Regenerating the closing panel

`assets/managed-by.png` is the rounded "Handled and managed by Global Tech
Solutions" block. It is an **image, not CSS**, because LibreOffice's HTML
filter ignores `border-radius` outright — a styled `<td>` prints as a hard
rectangle.

```bash
cd docs && magick -size 2160x520 xc:none \
  -fill '#062B59' -draw 'roundrectangle 0,0 2159,519 44,44' \
  -font Liberation-Sans-Bold -pointsize 46 -fill '#D4AF37' -kerning 11 \
  -gravity north -annotate +0+96 'HANDLED AND MANAGED BY' \
  -font Liberation-Sans-Bold -pointsize 96 -fill '#FFFFFF' -kerning 7 \
  -gravity north -annotate +0+168 'GLOBAL TECH SOLUTIONS' \
  -font Liberation-Sans -pointsize 38 -fill '#C9D4E2' -kerning 0 \
  -gravity north -annotate +0+310 'Pravasi Sangama 2026 — E-Ticketing & Gate Management System' \
  -gravity north -annotate +0+364 'Designed, deployed and maintained for the Karnataka Cultural Foundation' \
  -background none PNG32:assets/managed-by.png
```

## Editing the HTML — what LibreOffice will and will not do

Its HTML import is not a browser. These were all found by rendering the PDF
back to images and looking at it, and they will bite again:

| Do not | Because | Do instead |
| --- | --- | --- |
| `border-radius` | Silently ignored | Generate an image |
| `background-color` on an inline `<span>` | Dropped — the gate section's colour codes printed as plain words | Put the background on a `<td>` |
| `background-color`/`padding` on a `<div>` | Painted per **line**, so a callout looks like highlighted text, not a panel | Single-cell `<table>` |
| `border-left` on a `<div>` | Also painted per line — one stubby bar per line | Drop it, or use a `<td>` |
| Empty `<div>` with only `border-top` | Rule disappears and the next block is indented | `<hr>` |
| `margin` shorthand on `h1`–`h3` | Its own Heading style indent survives, so headings sit at a different left edge from body text | Longhand `margin-left: 0` + `padding-left: 0` |
| Descendant selectors (`.a .b`) | Not resolved | Inline styles |
| Tables without `cellspacing="0"` | White gutters between cells; a dark header row breaks into segments | Always set it |
| Flexbox / grid | Not supported | Tables |

Also: set `page-break-inside: avoid` on tables. Without it a header row can
land on one page and its rows on the next.

## If you want the full CSS aesthetic

The HTML is written so a browser renders it properly too. Opening
`USER-MANUAL.html` in Chrome and printing to PDF gives real rounded corners,
shadows and flex layout — everything LibreOffice drops. The committed PDF is
the toolchain-free version; the browser is the higher-fidelity one.
