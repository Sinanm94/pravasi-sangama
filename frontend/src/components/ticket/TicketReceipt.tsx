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

/* ------------------------------------------------------------------ */
/* Brand tokens — kept literal so the ticket renders identically       */
/* wherever it is mounted (print, PDF, email preview).                 */
/* ------------------------------------------------------------------ */

/** Official brand palette (§5.3). The ticket uses navy + gold only. */
const NAVY = '#062B59'; // primary surface
const NAVY_DARK = '#031F43'; // QR label block, date box, footer
const GOLD = '#D4AF37'; // borders, diamonds, badge
const GOLD_LIGHT = '#F7E7B5'; // highlights
const GREY_LIGHT = '#E6E6E6'; // dividers on white panels

// Maroon is intentionally absent: it has no role in the official ticket
// palette. It survives only in this file's app chrome (search bar, action
// pills) as literal Tailwind classes.

export interface TicketData {
  requestNumber: string;
  ticketNumber: string;
  ticketType: TicketType;
  purchaserName: string;
  mobile: string;
  email?: string | null;
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
            label: 'Location',
            caption: 'Scan for location',
            value:
              payloadFor('LOCATION', null) ?? `${ticket.ticketNumber}-LOC`,
            isLocation: true,
          }
        : {
            key: `g${slot.guestIndex}`,
            // Normal admits exactly one person, so its guest panel is
            // labelled by what it grants rather than by index.
            label: premium ? `Guest ${slot.guestIndex}` : 'One Free Entry',
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
    if (!premium) {
      planned.unshift({
        key: 'venue',
        label: 'Location Info',
        caption: 'Scan for location',
        value: payloadFor('LOCATION', null) ?? VENUE_INFO_URL,
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
            className="shrink-0 rounded-xl bg-[#062B59] px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:bg-[#031F43] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#062B59]/20 active:scale-[0.98]"
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
            onClick={() => window.print()}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#062B59] px-5 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-[#031F43] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#062B59]/20 active:scale-[0.97]"
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
      className="relative flex min-w-[940px] overflow-hidden rounded-2xl text-white shadow-[0_20px_60px_-15px_rgba(6,43,89,0.45)] print:min-w-0 print:shadow-none"
      style={{
        // Navy stays as the base layer. If the background art 404s in
        // production or is stripped by an email client, the pass is still
        // navy and still readable — it just loses its texture.
        backgroundColor: NAVY,
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
        className={`relative z-10 flex w-1/4 shrink-0 items-stretch ${
          hasDividerArt ? '' : 'border-r-2 border-dashed'
        }`}
        style={{
          borderColor: hasDividerArt ? undefined : `${GOLD}80`,
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
        <div className="flex w-9 shrink-0 items-center justify-center border-r border-white/5">
          <span
            className="-rotate-90 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.35em]"
            style={{ color: GOLD }}
          >
            {ticket.ticketNumber}
          </span>
        </div>

        <div className="flex flex-1 flex-col px-5 py-6">
          <span
            className="self-start rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em]"
            style={{ borderColor: GOLD, color: GOLD }}
          >
            Ticket Receipt
          </span>

          <dl className="mt-6 space-y-3.5">
            <StubItem
              label="Request Number"
              value={ticket.requestNumber}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Ticket Number"
              value={ticket.ticketNumber}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Ticket Type"
              value={TICKET_TYPE_LABELS[ticket.ticketType]}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Purchaser"
              value={ticket.purchaserName}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Mobile"
              value={ticket.mobile}
              diamondSrc={ornaments.diamond}
            />
            <StubItem
              label="Event Date"
              value={ticket.eventDate}
              diamondSrc={ornaments.diamond}
            />
          </dl>

          <div className="mt-auto pt-6">
            <div
              className="h-px w-full opacity-30"
              style={{ backgroundColor: GOLD }}
            />
            <p className="mt-3 text-[8px] uppercase tracking-[0.2em] text-white/40">
              Retain this stub
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- Main body ---------------- */}
      <div className="relative z-10 flex w-3/4 flex-col px-8 py-6">
        <header>
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
              style={{ color: GOLD }}
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

        {/* Tier badge — premium only. The Normal pass leads with its date
            block instead, per the official layouts. */}
        {isPremium &&
          (ribbonSrc ? (
            <div className="relative mt-5 flex shrink-0 self-start">
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
                  style={{ color: NAVY }}
                >
                  {TICKET_TYPE_LABELS[ticket.ticketType]} Ticket
                </span>
              )}
            </div>
          ) : (
            <HexBadge
              label={`${TICKET_TYPE_LABELS[ticket.ticketType]} Ticket`}
              className="mt-5 self-start"
            />
          ))}

        {/* ---- QR region ---- */}
        {isPremium ? (
          /* Five panels, separated by small gold diamonds. */
          <div className="mt-6 flex items-stretch justify-between gap-0">
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
          <div className="mt-6 flex items-stretch justify-between gap-0">
            <DateBlock date={ticket.eventDate} />

            <RuleWithDiamond src={ornaments.diamond} />

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

        {/* Footer */}
        <footer className="mt-auto flex items-end justify-between pt-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/40">
            Non-Transferable Ticket
          </p>
          <div className="flex items-center gap-2">
            <Diamond src={ornaments.diamond} />
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.22em]"
              style={{ color: `${GOLD}CC` }}
            >
              {isPremium ? 'Admits 4 Guests' : 'Admits 1 Guest'}
            </p>
            <Diamond src={ornaments.diamond} />
          </div>
        </footer>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function StubItem({
  label,
  value,
  diamondSrc,
}: {
  label: string;
  value: string;
  diamondSrc?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-[5px] shrink-0">
        <Diamond src={diamondSrc} />
      </span>
      <div className="min-w-0">
        <dt className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">
          {label}
        </dt>
        <dd className="mt-0.5 truncate text-[12px] font-semibold text-white">
          {value}
        </dd>
      </div>
    </div>
  );
}

function Diamond({ src, size = 5 }: { src?: string; size?: number }) {
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
      style={{ backgroundColor: GOLD, height: size, width: size }}
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
    <div className={compact ? 'w-[104px]' : 'w-[148px]'}>
      {/* Panel label sits above the card, in gold on the navy surface */}
      <p
        className="mb-2 text-center text-[9px] font-bold uppercase tracking-[0.14em]"
        style={{ color: GOLD }}
      >
        {code.label}
      </p>

      <div
        className="overflow-hidden rounded-[5px] bg-white"
        style={{
          border: `2px solid ${NAVY}`,
          boxShadow: '0 6px 18px rgba(3,31,67,0.35)',
        }}
      >
        <div className={compact ? 'p-1.5' : 'p-2'}>
          <TicketQr
            value={code.value}
            className={compact ? 'h-[88px] w-full' : 'h-[128px] w-full'}
          />
        </div>

        {/* Caption block — #031F43 with white text */}
        <div
          className="px-1 py-[5px] text-center"
          style={{ backgroundColor: NAVY_DARK }}
        >
          <span
            className={`block font-bold uppercase leading-tight text-white ${
              compact
                ? 'text-[6px] tracking-[0.06em]'
                : 'text-[7px] tracking-[0.1em]'
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
          fill={NAVY_DARK}
          stroke={GOLD}
          strokeWidth="2"
        />
        {/* Inner hairline — the doubled edge is what makes it read as a seal */}
        <polygon
          points="19,6 194,6 205,23 194,40 19,40 7,23"
          fill="none"
          stroke={GOLD_LIGHT}
          strokeWidth="0.75"
          opacity="0.55"
        />
      </svg>

      <span
        className="relative z-10 flex w-full items-center justify-center text-[12px] font-extrabold uppercase tracking-[0.2em]"
        style={{ color: GOLD }}
      >
        {label}
      </span>
    </div>
  );
}

/** Dark date box — the Normal pass's left section. */
function DateBlock({ date }: { date: string }) {
  // "15, Oct 2026" → day on its own line, month/year beneath.
  const [day, rest] = date.includes(',')
    ? [date.split(',')[0]!.trim(), date.split(',').slice(1).join(',').trim()]
    : [date, ''];

  return (
    <div
      className="flex w-[148px] flex-col items-center justify-center rounded-[5px] px-3 py-4"
      style={{ backgroundColor: NAVY_DARK, border: `1px solid ${GOLD}55` }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-[0.18em]"
        style={{ color: GOLD }}
      >
        Event Date
      </span>
      <span className="mt-2 text-[40px] font-extrabold leading-none text-white">
        {day}
      </span>
      {rest && (
        <span
          className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: GOLD_LIGHT }}
        >
          {rest}
        </span>
      )}
    </div>
  );
}

/** Thin vertical rule with a gold diamond at its midpoint. */
function RuleWithDiamond({ src }: { src?: string }) {
  return (
    <div className="relative mx-3 flex w-4 shrink-0 items-stretch justify-center">
      <span className="w-px" style={{ backgroundColor: `${GREY_LIGHT}33` }} />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Diamond src={src} size={7} />
      </span>
    </div>
  );
}

/** Bare gold diamond between premium QR panels — no rule. */
function DiamondSpacer({ src }: { src?: string }) {
  return (
    <span className="flex shrink-0 items-center px-1.5">
      <Diamond src={src} size={6} />
    </span>
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
              backgroundImage: `radial-gradient(${GOLD} 1px, transparent 1px)`,
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

function TicketQr({ value, className }: { value: string; className?: string }) {
  return (
    <div className={className} aria-label="Ticket QR code" role="img">
      <QRCodeSVG
        value={value}
        level="Q"
        marginSize={2}
        // Navy on white keeps the ticket's palette without hurting contrast:
        // decode needs luminance separation, not literal black.
        bgColor="#ffffff"
        fgColor={NAVY}
        width="100%"
        height="100%"
        style={{ display: 'block', width: '100%', height: '100%' }}
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
