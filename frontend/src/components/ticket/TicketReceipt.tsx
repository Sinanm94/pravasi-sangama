'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Mail,
  Printer,
  Search,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import {
  TICKET_TYPE_LABELS,
  VENUE_INFO_URL,
  isPremiumTier,
  qrCodePlanFor,
  type QrCodeKind,
  type TicketType,
} from '@pravasi/shared';
import { QRCodeSVG } from 'qrcode.react';
import { TICKET_ASSETS, type TicketAssets } from '@/lib/ticketAssets';
import { printTicket } from '@/lib/printTicket';

/* ------------------------------------------------------------------ */
/* Brand tokens — kept literal so the ticket renders identically       */
/* wherever it is mounted (print, PDF, email preview).                 */
/* ------------------------------------------------------------------ */

/**
 * Official brand palette (§5.3), sampled from the event logo.
 *
 * The surface is `#37098C`, NOT the brighter `#5E17EB` the UI uses for
 * buttons. Amber on the bright violet measures 3.81:1 and fails at the 8-10px
 * this pass sets its eyebrows and captions in; on `#37098C` it is 6.74:1,
 * which is where the old gold-on-navy sat (6.67:1). White on it is 13.3:1.
 */
const VIOLET = '#37098C'; // primary surface
const VIOLET_DARK = '#2E0775'; // QR caption block, date box, footer
const AMBER = '#FFA51F'; // borders, diamonds, badge
const AMBER_LIGHT = '#FFD79A'; // highlights

// The ticket is violet + amber only. Navy and gold were the previous scheme
// and must not reappear here.

export interface TicketData {
  requestNumber: string;
  ticketNumber: string;
  ticketType: TicketType;
  purchaserName: string;
  mobile: string;
  email?: string | null;
  /**
   * Free, and OUTSIDE ticket capacity (§4.2) — printed for the gate's
   * headcount, never added to the admitted-guest figure.
   */
  childrenBelow12?: number;
  eventDate: string;
  organization?: string;
  eventName?: string;
}

interface TicketReceiptProps {
  ticket?: TicketData;
  /**
   * Real design assets. Enhancement layer only — every field is optional and
   * anything absent falls back to the CSS-drawn shape. Defaults to the
   * project-wide registry in lib/ticketAssets.
   */
  assets?: TicketAssets;
  /**
   * Real QR payloads from the issuance response.
   *
   * When absent the codes encode `TKT-…-G1` style strings instead. Those are
   * genuine, scannable QR codes — they simply carry a placeholder value the
   * gate will reject as UNKNOWN_CODE. Fine for design review; never a ticket.
   */
  qrPayloads?: Array<{ kind: QrCodeKind; guest_index: number | null; payload: string }>;
  /** Renders the pass alone: no search bar, success line or action bar. */
  embedded?: boolean;
  /** Forwarded to the pass element itself, for image capture. */
  ticketRef?: React.Ref<HTMLElement>;
  onPreview?: () => void;
  onEmail?: () => void;
  onDashboard?: () => void;
  onSearch?: (query: string) => void;
}

const MOCK_TICKET: TicketData = {
  requestNumber: 'REQ-2026-000092',
  ticketNumber: 'TKT-0092',
  ticketType: 'SVIP',
  purchaserName: 'Anand Kumar',
  mobile: '8888999955',
  email: null,
  childrenBelow12: 2,
  eventDate: '15 OCT 2026',
  organization: 'Karnataka Cultural Foundation',
  eventName: 'Pravasi Sangama 2026',
};

/* ------------------------------------------------------------------ */

export default function TicketReceipt({
  ticket = MOCK_TICKET,
  assets = TICKET_ASSETS,
  qrPayloads,
  embedded = false,
  ticketRef,
  onPreview,
  onEmail,
  onDashboard,
  onSearch,
}: TicketReceiptProps) {
  const [query, setQuery] = useState('');

  const isPremium = isPremiumTier(ticket.ticketType);

  // The code set comes from the shared plan — the same function the backend
  // uses to fan out qr_codes rows at issuance.
  const codes = useMemo<CodeSpec[]>(() => {
    // Real payload when the API supplied one, placeholder string otherwise.
    const payloadFor = (kind: QrCodeKind, guestIndex: number | null) =>
      qrPayloads?.find(
        (p) => p.kind === kind && p.guest_index === guestIndex,
      )?.payload;

    const premium = isPremiumTier(ticket.ticketType);

    const planned = qrCodePlanFor(ticket.ticketType).map<CodeSpec>((slot) =>
      slot.kind === 'LOCATION'
        ? {
            key: 'loc',
            label: 'Location QR',
            caption: 'Scan for location',
            /* VENUE_INFO_URL, never the backend's LOCATION payload. That
             * payload is a bare UUID: a guest pointing a camera at it gets
             * nothing, where this opens directions. The UUID's purpose is a
             * gate scan, and the gate does not read it off the print. */
            value: VENUE_INFO_URL,
            isLocation: true,
          }
        : {
            key: `g${slot.guestIndex}`,
            // Normal admits exactly one person, so its guest panel is
            // labelled by what it grants rather than by index.
            label: premium ? `Guest ${slot.guestIndex} QR` : 'One Free Entry',
            caption: 'Scan for admission',
            value:
              payloadFor('GUEST', slot.guestIndex) ??
              `${ticket.ticketNumber}-G${slot.guestIndex}`,
            isLocation: false,
          },
    );

    /* The Normal layout shows a LOCATION INFO panel, but a Normal ticket is
     * issued with one QR code (§4.1) and has no LOCATION row in the database.
     * That panel therefore carries the static venue link — informational, not
     * an admission credential. qrCodePlanFor is untouched, so the backend
     * fan-out and the gate remain exactly as specified. */
    /* A Normal ticket is issued with ONE qr_codes row (§4.1), so the shared
     * plan has no LOCATION slot to map over. The panel is added here so every
     * printed ticket carries directions — 2 panels on Normal, 5 on premium.
     * qrCodePlanFor is untouched: this is print layout, not fan-out. */
    if (!premium) {
      planned.unshift({
        key: 'venue',
        label: 'Location QR',
        caption: 'Scan for location',
        value: VENUE_INFO_URL,
        isLocation: true,
      });
    }

    return planned;
  }, [ticket.ticketType, ticket.ticketNumber, qrPayloads]);

  const hasEmail = Boolean(ticket.email);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch?.(query.trim());
  };

  return (
    <div
      className={
        embedded
          ? 'font-sans antialiased'
          : 'min-h-screen bg-gray-50 px-4 pb-32 pt-8 font-sans antialiased sm:px-6 sm:pt-12 print:bg-white print:pb-0'
      }
    >
      <div className={embedded ? 'w-full' : 'mx-auto w-full max-w-5xl'}>
        {/* Search bar */}
        {!embedded && (
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04] print:hidden"
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400"
              strokeWidth={2.25}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by REQ number, TKT number or mobile"
              className="w-full rounded-xl border border-transparent bg-transparent py-3 pl-11 pr-3 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-gray-200 focus:bg-gray-50 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-[#5E17EB] px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:bg-[#2E0775] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5E17EB]/20 active:scale-[0.98]"
          >
            Search
          </button>
        </form>
        )}

        {/* Success state */}
        {!embedded && (
          <div className="mt-6 flex items-center justify-center gap-2 print:hidden">
            <CheckCircle2
              className="h-[18px] w-[18px] text-emerald-600"
              strokeWidth={2.25}
            />
            <p className="text-[14px] font-medium text-emerald-600">
              Redesigned e-ticket issued successfully.
            </p>
          </div>
        )}

        {/* Ticket — held at physical proportions; scrolls rather than reflows */}
        <div
          className={`overflow-x-auto pb-2 print:overflow-visible ${
            embedded ? '' : 'mt-6'
          }`}
        >
          <Ticket
            ticket={ticket}
            codes={codes}
            isPremium={isPremium}
            assets={assets}
            ticketRef={ticketRef}
          />
        </div>
      </div>

      {/* Floating glass action bar */}
      {!embedded && (
      <div className="fixed inset-x-0 bottom-6 z-20 flex justify-center px-4 print:hidden">
        <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-white/60 bg-white/70 p-2 shadow-[0_12px_40px_rgb(0,0,0,0.10)] backdrop-blur-xl">
          <ActionPill icon={Eye} onClick={onPreview}>
            Preview
          </ActionPill>

          <button
            type="button"
            onClick={() =>
              void printTicket({
                ticketNumber: ticket.ticketNumber,
                purchaserName: ticket.purchaserName,
              })
            }
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#5E17EB] px-5 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-[#2E0775] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5E17EB]/20 active:scale-[0.97]"
          >
            <Printer className="h-4 w-4" strokeWidth={2.25} />
            Print / Save PDF
          </button>

          <ActionPill
            icon={Mail}
            onClick={hasEmail ? onEmail : undefined}
            disabled={!hasEmail}
          >
            {hasEmail ? 'Email Ticket' : 'No Email Available'}
          </ActionPill>

          <ActionPill icon={LayoutDashboard} onClick={onDashboard}>
            Dashboard
          </ActionPill>
        </div>
      </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The pass itself                                                     */
/* ------------------------------------------------------------------ */

interface CodeSpec {
  key: string;
  label: string;
  caption: string;
  value: string;
  isLocation: boolean;
}

function Ticket({
  ticket,
  codes,
  isPremium,
  assets,
  ticketRef,
}: {
  ticket: TicketData;
  codes: CodeSpec[];
  isPremium: boolean;
  assets: TicketAssets;
  ticketRef?: React.Ref<HTMLElement>;
}) {
  const ornaments = assets.ornaments ?? {};
  const brand = assets.brand ?? {};
  const ribbonSrc = assets.ribbon?.[ticket.ticketType];
  const ribbonHasLabel = assets.ribbonHasLabel !== false;
  const hasDividerArt = Boolean(ornaments.divider);

  return (
    <article
      ref={ticketRef}
      /* Hook for the print isolation in globals.css. An attribute rather than
         a class so Tailwind's purge can never strip it. */
      data-print-ticket
      /* FIXED width, not min-w. html2canvas captures at node.scrollWidth,
         so a min-width let the pass grow with its container and the raster
         changed aspect ratio between desktop and phone. 1000px divides
         cleanly into the 250px stub + 750px body below, which keeps the two
         columns on the same horizontal plane with no sub-pixel rounding —
         percentage widths were the alignment drift. print: overrides let
         the browser fit it to paper (§6.2). */
      className="relative flex w-[1000px] shrink-0 overflow-hidden rounded-2xl text-white shadow-[0_20px_60px_-15px_rgba(6,43,89,0.45)] print:shadow-none"
      style={{
        // Navy stays as the base layer. If the background art 404s in
        // production or is stripped by an email client, the pass is still
        // navy and still readable — it just loses its texture.
        backgroundColor: VIOLET,
        backgroundImage: assets.background
          ? `url(${assets.background})`
          : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Grain / texture overlay */}
      {assets.texture && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 opacity-40 mix-blend-overlay"
          style={{
            backgroundImage: `url(${assets.texture})`,
            backgroundSize: 'cover',
          }}
        />
      )}

      {/* Decorative corner dot grids */}
      <DotGrid className="left-24 top-4" src={ornaments.cornerDots} />
      <DotGrid className="bottom-4 right-4" src={ornaments.cornerDots} />

      {/* ---------------- Stub ---------------- */}
      <div
        className={`relative z-10 flex w-[250px] shrink-0 items-stretch ${
          hasDividerArt ? '' : 'border-r-2 border-dashed'
        }`}
        style={{
          borderColor: hasDividerArt ? undefined : `${AMBER}80`,
          backgroundImage: assets.stubBackground
            ? `url(${assets.stubBackground})`
            : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Divider artwork — a small dash tile repeated down the seam */}
        {hasDividerArt && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-[3px]"
            style={{
              backgroundImage: `url(${ornaments.divider})`,
              backgroundRepeat: 'repeat-y',
              backgroundPosition: 'top center',
            }}
          />
        )}

        {/* Rotated ticket number on the outer edge */}
        {/* Crypto-random ticket numbers run to ~14 characters (§4.4). At the
            old 11px/0.35em the rotated string was longer than the stub is
            tall and ran off the top edge. overflow-hidden is the hard stop;
            the smaller type is what keeps it from needing one. */}
        <div className="flex w-9 shrink-0 items-center justify-center overflow-hidden border-r border-white/5">
          <span
            className="-rotate-90 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.2em]"
            style={{ color: AMBER }}
          >
            {ticket.ticketNumber}
          </span>
        </div>

        <div className="flex flex-1 flex-col px-5 py-6">
          {/* inline-flex + items-center, not a bare inline span with py-1.
              html2canvas positions an inline box by its baseline, so vertical
              padding did not centre the glyphs — the text sat low and dropped
              through the gold border in the PDF. A flex container centres on
              the box, and min-h fixes the pill's height independently of how
              the engine measures the 9px text. */}
          {/* Solid gold fill with navy type, per the mockup — not a hollow
              pill. Gold on navy is the brand's own pairing (§5.3) and the
              filled block is what makes it read as a stamp rather than an
              outline. min-h + flex centring keeps it safe for html2canvas,
              which positions inline boxes by baseline. */}
          <span
            className="inline-flex min-h-[34px] shrink-0 items-center justify-center self-start rounded-[6px] px-4 pb-[4px] pt-[3px] text-center text-[11px] font-extrabold uppercase leading-[16px] tracking-[0.14em]"
            style={{ backgroundColor: AMBER, color: VIOLET_DARK }}
          >
            Ticket Receipt
          </span>

          {/* Vertical accent rail down the list, per the mockup. border-l on
              the <dl> rather than an absolutely positioned bar: html2canvas
              rasterises borders reliably, where an absolute element inside a
              transformed ancestor can land at the wrong offset. */}
          <dl
            className="mt-6 border-l pl-3"
            style={{ borderColor: `${AMBER}59` }}
          >
            <StubItem
              label="Request Number"
              shape="square"
              value={ticket.requestNumber}
              diamondSrc={ornaments.diamond}
              variant="code"
            />
            <StubItem
              label="Ticket Number"
              shape="diamond"
              value={ticket.ticketNumber}
              diamondSrc={ornaments.diamond}
              variant="code"
            />
            <StubItem
              label="Ticket Type"
              shape="circle"
              value={TICKET_TYPE_LABELS[ticket.ticketType]}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Purchaser"
              shape="circle"
              value={ticket.purchaserName}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Mobile"
              shape="square"
              value={ticket.mobile}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Children Below 12"
              shape="diamond"
              value={String(ticket.childrenBelow12 ?? 0)}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Event Date"
              shape="circle"
              last
              value={ticket.eventDate}
              diamondSrc={ornaments.diamond}
            />
          </dl>

          <div className="mt-auto pt-6">
            <div
              className="h-px w-full opacity-30"
              style={{ backgroundColor: AMBER }}
            />
            <p className="mt-3 text-[8px] uppercase tracking-[0.2em] text-white/40">
              Retain this stub
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- Main body ---------------- */}
      {/* flex-1 + min-w-0: takes exactly the 750px the stub leaves, and lets
          truncate/ellipsis work on descendants — without min-w-0 a flex item
          refuses to shrink below its content and children overflow instead. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* --- Navy header --- */}
        <header className="relative px-8 pb-5 pt-6">
          <DotGrid className="right-4 top-3" src={ornaments.cornerDots} />
          <GoldSwoosh className="right-0 top-0" />
          <div className="flex items-center gap-2.5">
            {brand.logo && (
              <img
                src={brand.logo}
                alt=""
                aria-hidden
                className="h-5 w-auto shrink-0"
              />
            )}
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.28em]"
              style={{ color: AMBER }}
            >
              {ticket.organization ?? 'Karnataka Cultural Foundation'}
            </p>
          </div>

          {brand.lockup ? (
            <img
              src={brand.lockup}
              alt={ticket.eventName ?? 'Pravasi Sangama 2026'}
              className="mt-2 h-[38px] w-auto"
            />
          ) : (
            <h2 className="mt-1.5 text-[34px] font-bold uppercase leading-none tracking-tight text-white">
              {ticket.eventName ?? 'Pravasi Sangama 2026'}
            </h2>
          )}
        </header>

        {/* --- White central card ---
            The badges and QR panels sit on white, per the original design.
            Everything inside inverts to navy type: gold at this size on white
            measures ~2:1 contrast and is unreadable (§5.3), so nothing gold
            may cross onto this surface as text or a hairline. */}
        <div className="mx-5 rounded-lg bg-white px-5 pb-5 pt-4">
          {/* Header row: tier badge left, date badge right, matched at 46px
              so they read as a balanced pair above the codes.

              EVERY tier gets a badge, including Normal. It was previously
              gated behind isPremium, which left the left half of the card
              empty on a Normal pass and made the date look accidentally
              off-centre rather than deliberately right-aligned. The QR region
              below still branches on isPremium — that is the 2-vs-5 panel
              layout, which is a real difference; the tier label is not. */}
          <div className="flex items-center justify-between gap-4">
            {ribbonSrc ? (
              <div className="relative flex shrink-0">
                <img
                  src={ribbonSrc}
                  alt={
                    ribbonHasLabel
                      ? `${TICKET_TYPE_LABELS[ticket.ticketType]} ticket`
                      : ''
                  }
                  aria-hidden={!ribbonHasLabel}
                  className="block h-11 w-auto"
                />
                {!ribbonHasLabel && (
                  <span
                    className="absolute inset-0 flex items-center justify-center px-6 text-[13px] font-extrabold uppercase tracking-[0.18em]"
                    style={{ color: VIOLET }}
                  >
                    {TICKET_TYPE_LABELS[ticket.ticketType]} Ticket
                  </span>
                )}
              </div>
            ) : (
              <HexBadge
                label={`${TICKET_TYPE_LABELS[ticket.ticketType]} Ticket`}
              />
            )}

            <DateBadge date={ticket.eventDate} />
          </div>

        {/* ---- QR region ---- */}
        {isPremium ? (
          /* Five panels, separated by small gold diamonds. */
          /* Explicit gap, centred — not justify-between with gap-0.
             justify-between distributed leftover space *between* panels, so
             the spacing changed with the tier label above and the panels sat
             hard against the body padding at the ends. Budget at 750px body
             - 64px padding = 686px usable: 5x112 (560) + 4 diamonds (~28)
             + 8 gaps x 8px (64) = 652. It fits with room, deterministically. */
          <div className="mt-5 flex items-stretch justify-center gap-1">
            {codes.map((code, i) => (
              <Fragment key={code.key}>
                {i > 0 && <DiamondSpacer src={ornaments.diamond} />}
                <QrPanel code={code} size="compact" />
              </Fragment>
            ))}
          </div>
        ) : (
          /* Three sections: date box | location info | admission.
             Thin vertical rules with a gold diamond at their midpoint. */
          /* No DateBlock here any more — the date is the badge at the top of
             the card, and printing it twice on one pass reads as an error. */
          <div className="mt-5 flex items-stretch justify-center gap-4">
            {codes
              .filter((c) => c.isLocation)
              .map((code) => (
                <QrPanel key={code.key} code={code} size="regular" />
              ))}

            <RuleWithDiamond src={ornaments.diamond} />

            {codes
              .filter((c) => !c.isLocation)
              .map((code) => (
                <QrPanel key={code.key} code={code} size="regular" />
              ))}
          </div>
        )}
        </div>
        {/* --- /white card --- */}

        {/* Footer */}
        {/* items-center, not items-end. items-end aligned both sides on their
            bottom EDGES, so the diamonds — which are 6px boxes — sat level
            with the text's descender line instead of its optical middle. */}
        <footer className="relative mt-auto flex items-center justify-between px-8 pb-6 pt-5">
          <DotGrid className="bottom-2 right-4" src={ornaments.cornerDots} />
          <p className="text-[9px] font-semibold uppercase leading-[13px] tracking-[0.22em] text-white/40">
            Non-Transferable Ticket
          </p>
          {/* One flex row, items-center, no margins on the children. The
              diamonds previously sat on the text's descender line because the
              <p> carried its own line box height and the row aligned on edges
              rather than centres. */}
          {/* mt-[1px] on the glyphs, not translate-y. html2canvas rasterises
              transforms through its own matrix and small translations drift;
              a margin is plain box layout it cannot get wrong. All-caps text
              has no descenders, so its optical middle sits ~1px below the
              line box's centre — that is what the nudge compensates for. */}
          <div className="flex shrink-0 items-center justify-center gap-2">
            <span className="mt-[1px] flex shrink-0 items-center">
              <Diamond src={ornaments.diamond} />
            </span>
            <p
              className="m-0 text-[9px] font-semibold uppercase leading-[13px] tracking-[0.22em]"
              style={{ color: `${AMBER}CC` }}
            >
              {isPremium ? 'Admits 4 Guests' : 'Admits 1 Guest'}
              {/* Printed even when zero: a gate reading "+0 Children" knows
                  the field was captured, where a missing line is ambiguous.
                  Children are free and never consume a guest QR (§4.2). */}
              {` · +${ticket.childrenBelow12 ?? 0} Children Below 12`}
            </p>
            <span className="mt-[1px] flex shrink-0 items-center">
              <Diamond src={ornaments.diamond} />
            </span>
          </div>
        </footer>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * One labelled row of the stub ledger.
 *
 * `variant` decides what happens when the value is too wide, and the two
 * cases are NOT interchangeable:
 *
 *   'text'  clip with an ellipsis. Correct for a purchaser name — "Anand
 *           Kumar Venkatesh…" is still recognisably the right person.
 *
 *   'code'  wrap, never clip. A request or ticket number is what staff type
 *           to find this booking; an ellipsised REQ-2026-A3F1… is worse than
 *           useless because it looks complete. Smaller, tighter type so the
 *           full ~21-character value fits on one line at 250px, with
 *           break-all as the fallback rather than truncation.
 */
function StubItem({
  label,
  value,
  diamondSrc,
  variant = 'text',
  shape = 'diamond',
  last = false,
}: {
  label: string;
  value: string;
  diamondSrc?: string;
  variant?: 'text' | 'code';
  /** Varies down the list, per the mockup, so rows are distinguishable. */
  shape?: GlyphShape;
  /** Suppresses the divider on the final row. */
  last?: boolean;
}) {
  const isCode = variant === 'code';

  return (
    /* Dashed divider between rows — solid-bottom borders read as a table,
       which the mockup deliberately is not. Padding above and below keeps
       the rule clear of the descenders fixed in the previous pass. */
    <div
      className={`flex items-start gap-2 py-2 ${last ? '' : 'border-b border-dashed'}`}
      style={last ? undefined : { borderColor: `${AMBER}33` }}
    >
      <span className="mt-[5px] shrink-0">
        <Glyph src={diamondSrc} shape={shape} />
      </span>
      {/* min-w-0 is what actually lets the child clip or wrap — a flex item
          defaults to min-width:auto and will overflow its parent instead. */}
      <div className="min-w-0 flex-1">
        <dt className="pb-[2px] text-[8px] font-semibold uppercase leading-[12px] tracking-[0.16em] text-white/40">
          {label}
        </dt>
        {/* EXPLICIT px line-height, never leading-normal.
            html2canvas resolves `line-height: normal` with its own
            approximation rather than the browser's font-metric value, so the
            box it rasterises does not match the one the browser laid out —
            which is why descenders kept getting sliced no matter how the
            padding was tuned. A number is the same in both engines. ~1.5x the
            font size, plus pb for the raster's rounding. overflow-hidden
            stays here: it is what makes the ellipsis work horizontally. */}
        <dd
          className={
            isCode
              ? 'mt-0.5 break-all pb-[3px] text-[10.5px] font-semibold leading-[16px] tracking-[-0.01em] text-white tabular-nums'
              : 'mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap pb-[3px] text-[12px] font-semibold leading-[18px] text-white'
          }
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

export type GlyphShape = 'diamond' | 'square' | 'circle';

/**
 * Stub row marker. Same asset-or-CSS-fallback contract as Diamond (§9), but
 * the CSS fallback varies by shape.
 *
 * Every shape is a plain bordered/filled box — no clip-path, no ::before —
 * because html2canvas implements neither and would flatten them to squares
 * in the PDF. The diamond is a 45deg rotation, which it does rasterise.
 */
function Glyph({
  src,
  shape,
  size = 5,
}: {
  src?: string;
  shape: GlyphShape;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        className="inline-block w-auto"
        style={{ height: size + 1 }}
      />
    );
  }

  if (shape === 'circle') {
    return (
      <span
        className="inline-block rounded-full"
        style={{ backgroundColor: AMBER, height: size, width: size }}
      />
    );
  }

  if (shape === 'square') {
    return (
      <span
        className="inline-block"
        style={{
          border: `1px solid ${AMBER}`,
          height: size + 1,
          width: size + 1,
        }}
      />
    );
  }

  return (
    <span
      className="inline-block rotate-45"
      style={{ backgroundColor: AMBER, height: size, width: size }}
    />
  );
}

function Diamond({
  src,
  size = 5,
  onWhite = false,
}: {
  src?: string;
  size?: number;
  /** Gold is invisible on the white card; navy is the readable counterpart. */
  onWhite?: boolean;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        className="inline-block w-auto"
        style={{ height: size + 1 }}
      />
    );
  }

  return (
    <span
      className="inline-block rotate-45"
      style={{ backgroundColor: AMBER, height: size, width: size }}
    />
  );
}

/**
 * White panel, navy border, QR above a solid navy-dark caption block.
 *
 * The caption block is a filled rectangle rather than tinted text: it survives
 * html2canvas, PDF export and email rendering identically, and it gives the
 * panel a hard bottom edge that reads as a physical label at arm's length.
 */
function QrPanel({
  code,
  size,
}: {
  code: CodeSpec;
  size: 'regular' | 'compact';
}) {
  const compact = size === 'compact';

  return (
    <div className={compact ? 'w-[112px] shrink-0' : 'w-[148px] shrink-0'}>
      {/* Panel label sits above the card, in gold on the navy surface.
          nowrap + ellipsis: "Location" and "Guest 1" fit, but the label is
          the one string here that could be re-worded later, and a wrapped
          label would push every panel to a different height. */}
      {/* Explicit leading-[13px] on 8.5px text, padded top and bottom, and
          no overflow-hidden. These labels are fixed strings that always fit
          at 112px, so nothing here needs clipping — the ellipsis was
          insurance against a problem this panel does not have, and it cost
          the tops of the uppercase ascenders. */}
      <p
        className="mb-2 whitespace-nowrap pb-[2px] pt-1 text-center text-[8.5px] font-extrabold uppercase leading-[13px] tracking-[0.1em]"
        style={{ color: VIOLET_DARK }}
      >
        {code.label}
      </p>

      <div
        className="overflow-hidden rounded-[5px] bg-white"
        style={{
          border: `2.5px solid ${VIOLET}`,
          boxShadow: '0 2px 8px rgba(3,31,67,0.14)',
        }}
      >
        <div className={compact ? 'p-2' : 'p-2.5'}>
          {/* 88 + p-2 (16) + border (4) = 108 inside a 112px panel: 4px of
              slack. At 92 it summed to exactly 112 and any sub-pixel rounding
              in the raster would clip the code's quiet zone — the part a
              scanner needs most. */}
          <TicketQr value={code.value} size={compact ? 88 : 120} />
        </div>

        {/* Caption block — #2E0775 with white text.
            The old box was px-1 py-[5px] with leading-tight, so "SCAN FOR
            ADMISSION" sat against both edges and its descenders touched the
            bottom. Now: real horizontal padding, a minimum height so every
            panel's block is the same depth regardless of caption length, and
            nowrap+ellipsis as the hard stop rather than a silent overflow. */}
        <div
          className="flex min-h-[24px] items-center justify-center px-2 pb-[5px] pt-[3px] text-center"
          style={{ backgroundColor: VIOLET_DARK }}
        >
          <span
            className={`block w-full whitespace-nowrap font-bold uppercase text-white ${
              compact
                ? 'text-[5.5px] leading-[10px] tracking-[0.04em]'
                : 'text-[7px] leading-[12px] tracking-[0.08em]'
            }`}
          >
            {code.caption}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Gold hexagonal tier badge.
 *
 * Drawn as inline SVG rather than a CSS `clip-path` polygon on purpose:
 * html2canvas does not implement clip-path, so a CSS hexagon would flatten to
 * a rectangle in every shared image and PDF. SVG rasterises correctly.
 */
function HexBadge({
  label,
  className = '',
}: {
  label: string;
  className?: string;
}) {
  return (
    <div className={`relative inline-flex h-[46px] w-[212px] ${className}`}>
      <svg
        viewBox="0 0 212 46"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <polygon
          points="14,1 198,1 211,23 198,45 14,45 1,23"
          fill={VIOLET_DARK}
          stroke={AMBER}
          strokeWidth="3"
        />
        {/* Inner hairline — the doubled edge is what makes it read as a seal */}
        <polygon
          points="19,6 194,6 205,23 194,40 19,40 7,23"
          fill="none"
          stroke={AMBER_LIGHT}
          strokeWidth="0.75"
          opacity="0.55"
        />
      </svg>

      {/* Stars flank the label, per the mockup. Rendered as text glyphs
          rather than SVG so they inherit the gold colour and sit on the same
          baseline as the label — a separate <svg> would need its own vertical
          centring and html2canvas would measure it independently. */}
      <span
        className="relative z-10 flex w-full items-center justify-center gap-2 pb-[3px] text-[12px] font-extrabold uppercase leading-[17px] tracking-[0.2em]"
        style={{ color: AMBER }}
      >
        <span aria-hidden className="text-[9px] leading-none">
          ★
        </span>
        {label}
        <span aria-hidden className="text-[9px] leading-none">
          ★
        </span>
      </span>
    </div>
  );
}

function RuleWithDiamond({ src }: { src?: string }) {
  return (
    <div className="relative mx-3 flex w-4 shrink-0 items-stretch justify-center">
      <span className="w-px" style={{ backgroundColor: `${VIOLET}1f` }} />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Diamond src={src} size={7} />
      </span>
    </div>
  );
}

/** Bare gold diamond between premium QR panels — no rule. */
/**
 * Column separator for the QR rail: a hairline rule broken by a diamond.
 *
 * Built as a flex column (rule / diamond / rule) rather than an absolutely
 * positioned diamond over a full-height line. html2canvas resolves absolute
 * offsets against the nearest positioned ancestor, and inside a transformed
 * or scaled capture that lands in the wrong place — a flex column has no
 * such dependency.
 */
function DiamondSpacer({ src }: { src?: string }) {
  return (
    <span className="flex w-4 shrink-0 flex-col items-center justify-center gap-1 self-stretch">
      <span
        className="w-px flex-1"
        style={{ backgroundColor: `${VIOLET}26` }}
      />
      <Diamond src={src} size={6} onWhite />
      <span
        className="w-px flex-1"
        style={{ backgroundColor: `${VIOLET}26` }}
      />
    </span>
  );
}

/**
 * Event-date badge — the right-hand counterpart to the tier badge.
 *
 * A navy cap holding a small gold square, then a light body carrying the
 * date in navy. Deliberately the tier badge's inverse: dark-shape-with-gold
 * type beside light-shape-with-navy type reads as a pair rather than two of
 * the same thing.
 */
function DateBadge({
  date,
  className = '',
}: {
  date: string;
  className?: string;
}) {
  return (
    <div
      className={`flex h-[46px] shrink-0 items-stretch overflow-hidden rounded-[4px] ${className}`}
      style={{ border: `2px solid ${AMBER}` }}
    >
      <span
        className="flex w-[26px] shrink-0 items-center justify-center"
        style={{ backgroundColor: VIOLET_DARK }}
      >
        <span
          className="block h-[9px] w-[9px]"
          style={{ backgroundColor: AMBER }}
        />
      </span>

      <span
        className="flex items-center px-4 text-[13px] font-extrabold uppercase leading-[17px] tracking-[0.12em]"
        style={{ backgroundColor: AMBER_LIGHT, color: VIOLET_DARK }}
      >
        {date}
      </span>
    </div>
  );
}

/**
 * Gold curved accent for the navy areas.
 *
 * Inline SVG rather than a CSS border-radius trick: a quarter-ring drawn with
 * `border-radius` + transparent borders renders inconsistently once the page
 * is scaled by a print engine, where a stroked path is resolution-independent
 * and prints as true vector.
 */
function GoldSwoosh({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 120"
      className={`pointer-events-none absolute h-[120px] w-[120px] ${className}`}
    >
      <path
        d="M120 0 A120 120 0 0 1 0 120"
        fill="none"
        stroke={AMBER}
        strokeWidth="2"
        opacity="0.28"
      />
      <path
        d="M120 22 A98 98 0 0 1 22 120"
        fill="none"
        stroke={AMBER}
        strokeWidth="1"
        opacity="0.18"
      />
    </svg>
  );
}

function DotGrid({ className = '', src }: { className?: string; src?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute h-16 w-16 ${
        src ? 'opacity-70' : 'opacity-[0.18]'
      } ${className}`}
      style={
        src
          ? {
              backgroundImage: `url(${src})`,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
            }
          : {
              backgroundImage: `radial-gradient(${AMBER} 1px, transparent 1px)`,
              backgroundSize: '8px 8px',
            }
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Real QR encoding                                                    */
/*                                                                     */
/* SVG, not canvas: it stays sharp at any print DPI, survives           */
/* html2canvas capture, and embeds cleanly in the PDF.                 */
/*                                                                     */
/* Level Q (25% recovery) rather than the M default — these codes are  */
/* photographed off creased paper and off other people's phone screens */
/* at a gate. The payload is a 36-char UUID, so the extra redundancy    */
/* costs one QR version and no legibility.                             */
/*                                                                     */
/* marginSize is the quiet zone. Without it, scanners fail against the */
/* white card edge; 2 modules is the practical floor, 4 is the spec.   */
/* ------------------------------------------------------------------ */

/**
 * An EXPLICIT pixel size, never width/height="100%".
 *
 * html2canvas serialises an SVG and rasterises it separately from the DOM
 * box, and a percentage-sized SVG has no intrinsic dimensions for it to
 * resolve against — so it rendered the code larger than its 92px slot. The
 * overflow painted over the caption block and the card's overflow-hidden
 * sliced "SCAN FOR ADMISSION" in half. A number is unambiguous to both the
 * browser and the raster.
 */
function TicketQr({ value, size }: { value: string; size: number }) {
  return (
    <div
      aria-label="Ticket QR code"
      role="img"
      style={{ width: size, height: size, margin: '0 auto' }}
    >
      <QRCodeSVG
        value={value}
        level="Q"
        marginSize={2}
        // Navy on white keeps the ticket's palette without hurting contrast:
        // decode needs luminance separation, not literal black.
        bgColor="#ffffff"
        fgColor={VIOLET}
        size={size}
        style={{ display: 'block' }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ActionPill({
  icon: Icon,
  children,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gray-100/80 px-5 py-2.5 text-[13px] font-medium text-gray-700 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-gray-900/10 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-gray-100/60 disabled:text-gray-400 disabled:hover:bg-gray-100/60 disabled:active:scale-100"
    >
      <Icon className="h-4 w-4" strokeWidth={2.25} />
      {children}
    </button>
  );
}
