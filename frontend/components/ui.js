import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

// Shared UI primitives. Each one bakes in the accessibility wiring
// (labels, ids, live regions, focus) so pages don't have to repeat it.
// Styling lives in styles/globals.css (@layer components).

const cx = (...classes) => classes.filter(Boolean).join(' ');

// ---------------------------------------------------------------- icons ---
// Decorative only: always aria-hidden, the adjacent text carries meaning.
const ICON_PATHS = {
  chevronDown: 'M6 9l6 6 6-6',
  arrowLeft: 'M19 12H5m6-6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4L19 7',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  speaker: 'M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13',
  stop: 'M7 7h10v10H7z',
  x: 'M6 6l12 12M18 6L6 18',
  file: 'M14 3H6v18h12V7l-4-4zM14 3v4h4',
};

export function Icon({ name, className = 'h-4 w-4' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('shrink-0', className)}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cx('animate-spin shrink-0', className)}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// -------------------------------------------------------------- buttons ---
const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

export function Button({
  variant = 'primary',
  size,
  block,
  loading = false,
  loadingText,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('btn', VARIANTS[variant], size === 'sm' && 'btn-sm', block && 'btn-block', className)}
      {...props}
    >
      {loading && <Spinner />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', size, className, children, ...props }) {
  return (
    <Link href={href} className={cx('btn', VARIANTS[variant], size === 'sm' && 'btn-sm', className)} {...props}>
      {children}
    </Link>
  );
}

// --------------------------------------------------------------- fields ---
// Wraps exactly one control and wires label, hint and error to it
// (id / aria-describedby / aria-invalid) so screen readers announce all
// three. `hideLabel` keeps the label for assistive tech only.
export function Field({ label, hint, error, required, hideLabel, className, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = Children.only(children);

  const describedBy = [control.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={control.props.id || id} className={hideLabel ? 'sr-only' : 'label mb-1'}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-rose-600">
              {' '}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      {isValidElement(control) &&
        cloneElement(control, {
          id: control.props.id || id,
          required: required || control.props.required,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : control.props['aria-invalid'],
        })}
      {hint && (
        <p id={hintId} className="hint mt-1">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

// Card-style radio group. Real <input type="radio"> underneath, so arrow
// keys, form semantics and screen-reader "1 of 2" all come for free.
export function ChoiceCards({ legend, hideLegend, name, options, value, onChange, className }) {
  return (
    <fieldset className={className}>
      <legend className={hideLegend ? 'sr-only' : 'label mb-2'}>{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cx(
              'relative flex cursor-pointer gap-3 rounded-lg border bg-white p-4 transition-colors',
              'border-slate-200 hover:border-slate-300',
              'has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50/50 has-[:checked]:ring-1 has-[:checked]:ring-brand-600',
              'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600'
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="mt-0.5 h-4 w-4 focus-visible:outline-none"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">{opt.label}</span>
              {opt.description && <span className="mt-0.5 block text-xs text-slate-600">{opt.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Compact radio group styled as a segmented toggle.
export function SegmentedControl({ legend, name, options, value, onChange }) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-medium">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cx(
              'cursor-pointer rounded px-3 py-1.5 text-slate-600 transition-colors hover:text-slate-900',
              'has-[:checked]:bg-brand-600 has-[:checked]:text-white',
              'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-brand-600'
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------- feedback ---
const ALERT_TONES = {
  error: 'border-rose-200 bg-rose-50 text-rose-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  info: 'border-slate-200 bg-slate-100 text-slate-800',
};

// Errors interrupt (role=alert); everything else is announced politely.
export function Alert({ tone = 'info', title, children, onDismiss, className }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', ALERT_TONES[tone], className)}
    >
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-1' : undefined}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="-m-1 rounded p-1 opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

// Inline error for forms; renders nothing when there's no message.
export function FormError({ children }) {
  if (!children) return null;
  return <Alert tone="error">{children}</Alert>;
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600">
      <Spinner className="h-5 w-5 text-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --------------------------------------------------------------- layout ---
const CARD_TONES = {
  default: 'border-slate-200',
  warning: 'border-amber-300',
  danger: 'border-rose-200',
};

// A titled page section. Uses <section aria-labelledby> so it shows up as a
// named landmark in screen-reader navigation.
export function Card({ title, description, actions, tone = 'default', id, className, bodyClassName, children }) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cx('rounded-lg border bg-white shadow-sm', CARD_TONES[tone], className)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-base font-semibold text-slate-900">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx('p-5', title && 'pt-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, back }) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <Icon name="arrowLeft" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <div className="mt-1 text-slate-600">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- badges ---
const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  muted: 'bg-white text-slate-500 border-slate-200',
  brand: 'bg-brand-50 text-brand-800 border-brand-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-200',
};

export function Badge({ tone = 'neutral', children, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const SESSION_STATUS = {
  INVITED: { label: 'Invited', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
};

export function sessionStatusLabel(status) {
  return (SESSION_STATUS[status] && SESSION_STATUS[status].label) || status;
}

export function StatusBadge({ status }) {
  const s = SESSION_STATUS[status] || { label: status, tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

// ------------------------------------------------------------ utilities ---
// Copies text and announces the result. Falls back to selecting a hidden
// textarea where the async clipboard API is unavailable (non-HTTPS dev).
export function CopyButton({ text, label = 'Copy', className }) {
  const [state, setState] = useState('idle'); // idle | copied | failed
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy failed');
      }
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button type="button" onClick={copy} className={cx('btn btn-secondary btn-sm', className)}>
      <Icon name={state === 'copied' ? 'check' : 'copy'} />
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}</span>
    </button>
  );
}

// A read-only link plus copy button, for invite links admins send out.
export function CopyableLink({ label, url }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="text-sm text-slate-700">{label}</span>}
      <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">
        {url}
      </code>
      <CopyButton text={url} label="Copy link" />
    </div>
  );
}

export function CharacterCount({ value, max }) {
  const remaining = max - value.length;
  return (
    <p className={cx('hint mt-1 text-right', remaining < 100 && 'text-amber-800')}>
      {value.length.toLocaleString('en-IN')} / {max.toLocaleString('en-IN')}
    </p>
  );
}
