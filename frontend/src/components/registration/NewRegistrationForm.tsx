'use client';

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronDown, Loader2 } from 'lucide-react';
import BrandBackdrop from '@/components/ui/BrandBackdrop';
import {
  SEATS_PER_TIER,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  isPremiumTier,
  qrCodeCountFor,
  type IssueTicketInput,
  type TicketType,
} from '@pravasi/shared';
import { fieldErrorVariants, springSnappy } from '@/lib/motion';

export interface AgentContext {
  name: string;
  mobile: string;
  sector: string;
  unit: string;
}

/**
 * The wire contract, not the form state. `counted_persons` is deliberately
 * absent — the server derives capacity from the tier and would reject it.
 */
export type RegistrationPayload = IssueTicketInput;

interface NewRegistrationFormProps {
  agent: AgentContext;
  onBack?: () => void;
  onSubmit?: (payload: RegistrationPayload) => Promise<void> | void;
}

type FieldErrors = Partial<Record<'purchaserName' | 'mobile' | 'email', string>>;

export default function NewRegistrationForm({
  agent,
  onBack,
  onSubmit,
}: NewRegistrationFormProps) {
  const [purchaserName, setPurchaserName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [ticketType, setTicketType] = useState<TicketType>('NORMAL');
  const [childrenBelow12, setChildrenBelow12] = useState('0');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fieldRefs = useRef<
    Partial<Record<keyof FieldErrors, HTMLInputElement | null>>
  >({});

  // Counted persons is never user-editable — it is a pure function of the tier.
  const countedPersons = useMemo(() => SEATS_PER_TIER[ticketType], [ticketType]);

  const clearError = (field: keyof FieldErrors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};

    if (!purchaserName.trim()) {
      next.purchaserName = 'Purchaser name is required.';
    }

    if (!mobile) {
      next.mobile = 'Mobile number is required.';
    } else if (mobile.length !== 10) {
      next.mobile = 'Enter a valid 10-digit mobile number.';
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      next.email = 'Enter a valid email address.';
    }

    return next;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validate();
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      /* Put the cursor in the first bad field. On a phone the offending
       * input is often off-screen, and an agent tapping Save repeatedly with
       * no visible response is the worst version of this interaction. */
      const first = (['purchaserName', 'mobile', 'email'] as const).find(
        (field) => nextErrors[field],
      );
      if (first) {
        const el = fieldRefs.current[first];
        el?.focus();
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // camelCase form state maps to the snake_case wire contract here, in one
    // place, rather than the API accepting two spellings of everything.
    const payload: RegistrationPayload = {
      purchaser_name: purchaserName.trim(),
      mobile_number: mobile,
      email: email.trim() || undefined,
      ticket_type: ticketType,
      children_below_12: Number(childrenBelow12) || 0,
    };

    try {
      setIsSubmitting(true);
      await onSubmit?.(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gray-50 px-4 py-10 font-sans antialiased sm:px-6 sm:py-14">
      <BrandBackdrop />
      <div className="relative z-10 mx-auto w-full max-w-xl">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-3xl bg-white p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04] sm:p-10"
        >
          {/* Header */}
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-gray-900">
                New Registration
              </h1>
              <p className="mt-1.5 text-[13px] text-gray-500">
                Issue a ticket for Pravasi Sangama 2026.
              </p>
            </div>

            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-gray-900/10 active:scale-[0.97]"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
              Back
            </button>
          </header>

          {/* Agent context */}
          <section className="mt-7 rounded-2xl border-l-4 border-[#5E17EB] bg-[#5E17EB]/5 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5E17EB]/70">
              Issuing Agent
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <ContextItem label="Agent" value={agent.name} />
              <ContextItem label="Mobile" value={agent.mobile} />
              <ContextItem label="Sector" value={agent.sector} />
              <ContextItem label="Unit" value={agent.unit} />
            </dl>
          </section>

          {/* Fields */}
          <div className="mt-7 space-y-5">
            <Field label="Purchaser Name" required error={errors.purchaserName}>
              <input
                ref={(el) => {
                  fieldRefs.current.purchaserName = el;
                }}
                type="text"
                value={purchaserName}
                onChange={(e) => {
                  setPurchaserName(e.target.value);
                  clearError('purchaserName');
                }}
                placeholder="Full name as per ID"
                autoComplete="name"
                className={inputClass(!!errors.purchaserName)}
              />
            </Field>

            <Field label="Mobile Number" required error={errors.mobile}>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-gray-400">
                  +91
                </span>
                <input
                  ref={(el) => {
                    fieldRefs.current.mobile = el;
                  }}
                  type="tel"
                  inputMode="numeric"
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                    clearError('mobile');
                  }}
                  placeholder="98765 43210"
                  autoComplete="tel"
                  className={`${inputClass(!!errors.mobile)} pl-14`}
                />
              </div>
            </Field>

            <Field label="Email Address" hint="Optional" error={errors.email}>
              <input
                ref={(el) => {
                  fieldRefs.current.email = el;
                }}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError('email');
                }}
                placeholder="name@example.com"
                autoComplete="email"
                className={inputClass(!!errors.email)}
              />
            </Field>

            <Field label="Ticket Type" required>
              <div className="relative">
                <select
                  value={ticketType}
                  onChange={(e) => setTicketType(e.target.value as TicketType)}
                  className={`${inputClass(false)} cursor-pointer appearance-none pr-11`}
                >
                  {TICKET_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TICKET_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400"
                  strokeWidth={2.25}
                />
              </div>
            </Field>

            <Field
              label="Counted Persons"
              required
              hint={`${qrCodeCountFor(ticketType)} QR ${
                qrCodeCountFor(ticketType) === 1 ? 'code' : 'codes'
              }`}
            >
              <input
                type="text"
                value={countedPersons}
                readOnly
                aria-readonly="true"
                tabIndex={-1}
                className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-[15px] font-medium text-gray-500 focus:outline-none"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
                {isPremiumTier(ticketType)
                  ? `${TICKET_TYPE_LABELS[ticketType]} tickets admit 4 guests, plus 1 location pass.`
                  : 'Normal tickets admit 1 person.'}
              </p>
            </Field>

            <Field label="Children Below 12">
              <input
                type="number"
                min={0}
                max={20}
                value={childrenBelow12}
                onChange={(e) =>
                  setChildrenBelow12(e.target.value.replace(/\D/g, ''))
                }
                onBlur={() => {
                  if (childrenBelow12 === '') setChildrenBelow12('0');
                }}
                className={inputClass(false)}
              />
              <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
                Free and excluded from ticket capacity.
              </p>
            </Field>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-9 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5E17EB] px-6 py-4 text-[14px] font-semibold uppercase tracking-[0.06em] text-white shadow-sm transition-all duration-200 hover:bg-[#2E0775] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5E17EB]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Saving…' : 'Save Registration'}
          </button>
        </form>

        <p className="mt-6 text-center text-[12px] text-gray-400">
          Registrations are logged against your unit and cannot be edited after
          submission.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Local primitives — promote to components/ui when a second screen  */
/* needs them.                                                       */
/* ---------------------------------------------------------------- */

const inputClass = (hasError: boolean) =>
  [
    'w-full rounded-xl border bg-white px-4 py-3.5 text-[15px] text-gray-900',
    'placeholder:text-gray-400 transition-all duration-200 focus:outline-none',
    hasError
      ? 'border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10'
      : 'border-gray-200 focus:border-[#5E17EB]/40 focus:ring-4 focus:ring-[#5E17EB]/10',
  ].join(' ');

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-[#5E17EB]">*</span>}
        </span>
        {hint && (
          <span className="text-[12px] font-normal text-gray-400">{hint}</span>
        )}
      </div>
      {children}

      {/* Height animates so the fields below glide down instead of jumping. */}
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key="error"
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
    </label>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[14px] font-medium text-gray-900">
        {value}
      </dd>
    </div>
  );
}
