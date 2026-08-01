'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Eye, EyeOff, Loader2, type LucideIcon } from 'lucide-react';
import { fieldErrorVariants, springSnappy } from '@/lib/motion';
import { Logo } from './Logo';
import BrandBackdrop from './BrandBackdrop';

/**
 * Shared chrome for every unauthenticated screen: /login, /login/reset,
 * /scanner/login.
 *
 * These graduated out of login/page.tsx for two reasons — a second screen now
 * needs them (§6.4), and Next.js rejects any non-page export from a
 * `page.tsx`, so a route file physically cannot host shared primitives.
 */

/** Official palette (§5.3). Navy is the action colour; gold accents navy. */
export const NAVY = '#062B59';
export const GOLD = '#D4AF37';

export function AuthShell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-10 font-sans antialiased">
      <BrandBackdrop />
      {/* relative + z-10: the backdrop is z-0, so every card must sit above
          it or the washes would render over the form. */}
      <div className="relative z-10 w-full max-w-sm">
        {/* Above the card, on the page background — not inside the navy
            band, which already carries the KCF wordmark and would double up.
            Margin lives on the Logo itself (not this wrapper) so there is
            only one mb-6 in play — stacking one on each would double the gap
            above the card, since margin on a flex item still adds to the
            wrapper's own auto height. */}
        <div className="flex justify-center">
          {/* The MARK, not the full lockup: the navy band directly below
              already spells out "Pravasi Sangama 2026" in type, and the
              lockup would print the same words a second time 40px above it. */}
          <Logo variant="mark" className="mb-6 h-24 w-24" priority />
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
          {/* Gold at 10px on white measures ~2:1 contrast. On navy it is the
              brand's own pairing and fully legible, so the accent lives here. */}
          <div
            className="px-7 pb-6 pt-7 text-center"
            style={{ backgroundColor: NAVY }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.28em]"
              style={{ color: GOLD }}
            >
              Karnataka Cultural Foundation
            </p>
            <h1 className="mt-2 text-[22px] font-extrabold uppercase leading-tight tracking-tight text-white">
              Pravasi Sangama 2026
            </h1>
            <span
              aria-hidden
              className="mx-auto mt-4 block h-px w-14"
              style={{ backgroundColor: GOLD }}
            />
          </div>

          <div className="p-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function AuthHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 pb-1">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${NAVY}12` }}
      >
        <Icon className="h-4 w-4" strokeWidth={2.25} style={{ color: NAVY }} />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-[12px] text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs — the two-layer focus ring is the signature detail (§5.4)     */
/* ------------------------------------------------------------------ */

export const inputClass = (hasError: boolean) =>
  [
    'w-full rounded-xl border bg-white px-4 py-3.5 text-[15px] text-gray-900',
    'placeholder:text-gray-400 transition-all duration-200 focus:outline-none',
    hasError
      ? 'border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10'
      : 'border-gray-200 focus:border-[#062B59]/40 focus:ring-4 focus:ring-[#062B59]/10',
  ].join(' ');

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  /** React 19 passes ref as a plain prop — no forwardRef wrapper needed. */
  ref?: React.Ref<HTMLInputElement>;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'ref'
>;

export function Field({
  label,
  hint,
  error,
  value,
  onChange,
  type = 'text',
  required,
  ref,
  ...rest
}: FieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';

  /* `px-4` sets left AND right padding in one Tailwind utility. Appending
   * `pr-11` alongside it would leave two classes touching the same CSS
   * property — which one wins depends on Tailwind's generated stylesheet
   * order, not on the order they're written here, so it's not safe to rely
   * on. Splitting into explicit pl-4/pr-11 removes the ambiguity outright. */
  const baseClass = inputClass(!!error);
  const fieldClass = isPassword
    ? baseClass.replace('px-4', 'pl-4 pr-11')
    : baseClass;

  return (
    <label className="block">
      <FieldLabel label={label} hint={hint} required={required} />
      <div className="relative">
        <input
          ref={ref}
          type={isPassword ? (showPassword ? 'text' : 'password') : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
          >
            {showPassword ? (
              <Eye className="h-[18px] w-[18px]" strokeWidth={2} />
            ) : (
              <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} />
            )}
          </button>
        )}
      </div>
      <FieldError error={error} />
    </label>
  );
}

export function SelectField({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  fallbackPlaceholder,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** Free-text placeholder used when the option list failed to load. */
  fallbackPlaceholder?: string;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} hint={hint} required />

      {options.length > 0 ? (
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass(!!error)} cursor-pointer appearance-none pr-11`}
          >
            <option value="">{placeholder}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400"
            strokeWidth={2.25}
          />
        </div>
      ) : (
        /* The list is a convenience, not a dependency. If the fetch failed the
           user can still type the code they were given, rather than being
           locked out of the form entirely. */
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder={fallbackPlaceholder}
          autoCapitalize="characters"
          className={inputClass(!!error)}
        />
      )}

      <FieldError error={error} />
    </label>
  );
}

function FieldLabel({
  label,
  hint,
  required,
}: {
  label: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-0.5" style={{ color: NAVY }}>
            *
          </span>
        )}
      </span>
      {hint && <span className="text-[12px] text-gray-400">{hint}</span>}
    </div>
  );
}

/** Height animates so fields below glide down instead of jumping. */
export function FieldError({ error }: { error?: string }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p
          key="err"
          role="alert"
          variants={fieldErrorVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={springSnappy}
          className="overflow-hidden text-[12px] text-red-500"
        >
          <span className="block pt-2">{error}</span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function Submit({
  busy,
  children,
  busyLabel = 'Please wait…',
}: {
  busy: boolean;
  children: React.ReactNode;
  busyLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#062B59]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      style={{ backgroundColor: NAVY }}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {busy ? busyLabel : children}
    </button>
  );
}

/** Quiet tertiary action — "Change unit", "Back to sign in". */
export function SubtleButton({
  icon: Icon,
  children,
  onClick,
  className = '',
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-1.5 text-[12px] font-medium text-gray-400 transition-colors hover:text-gray-600 ${className}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />}
      {children}
    </button>
  );
}

/** Terminal confirmation panel — signup accepted, reset link sent. */
export function AuthOutcome({
  icon: Icon,
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  tone: 'success' | 'info' | 'error';
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const tones = {
    success: 'bg-emerald-50 text-emerald-600',
    info: 'bg-sky-50 text-sky-600',
    error: 'bg-red-50 text-red-600',
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="text-center"
    >
      <span
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tones}`}
      >
        <Icon className="h-6 w-6" strokeWidth={2.25} />
      </span>
      <h2 className="mt-5 text-[17px] font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-500">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-6 w-full rounded-2xl bg-gray-100 px-6 py-3.5 text-[14px] font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.98]"
      >
        {actionLabel}
      </button>
    </motion.div>
  );
}
