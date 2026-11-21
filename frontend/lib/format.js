// One place for date/number formatting. India-only pilot, so en-IN
// (day-month order) rather than whatever the browser defaults to.
const LOCALE = 'en-IN';

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function formatDateTime(value) {
  const d = toDate(value);
  return d
    ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
}

export function formatTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';
}

export function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
