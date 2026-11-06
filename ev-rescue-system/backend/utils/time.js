const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const NAIVE_DATE_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
const NAIVE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function pad(value) {
  return String(value).padStart(2, '0');
}

function parse(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (!value) return new Date(NaN);

  const text = String(value).trim();
  const match = text.match(NAIVE_DATE_TIME);
  if (match && !EXPLICIT_ZONE.test(text)) {
    return new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    ) - BEIJING_OFFSET_MS);
  }
  const dateMatch = text.match(NAIVE_DATE);
  if (dateMatch) {
    return new Date(Date.UTC(
      Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])
    ) - BEIJING_OFFSET_MS);
  }
  return new Date(text);
}

function parts(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

function format(value = Date.now()) {
  const date = value instanceof Date || typeof value === 'number' ? new Date(value) : parse(value);
  if (!Number.isFinite(date.getTime())) return '';
  const item = parts(date);
  return `${item.year}-${pad(item.month)}-${pad(item.day)} ${pad(item.hour)}:${pad(item.minute)}:${pad(item.second)}`;
}

function now() {
  return format(Date.now());
}

function nowISO() {
  return `${now().replace(' ', 'T')}+08:00`;
}

function dateKey(value = Date.now()) {
  return format(value).slice(0, 10);
}

function monthKey(value = Date.now()) {
  return format(value).slice(0, 7);
}

function hour(value = Date.now()) {
  const date = value instanceof Date || typeof value === 'number' ? new Date(value) : parse(value);
  return parts(date).hour;
}

function after(milliseconds, value = Date.now()) {
  const date = value instanceof Date || typeof value === 'number' ? new Date(value) : parse(value);
  return format(date.getTime() + milliseconds);
}

function shiftUtcNaiveToBeijing(value) {
  if (typeof value !== 'string' || !NAIVE_DATE_TIME.test(value) || EXPLICIT_ZONE.test(value)) return value;
  const utc = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isFinite(utc.getTime()) ? format(utc) : value;
}

module.exports = {
  BEIJING_OFFSET_MS,
  parse,
  parts,
  format,
  now,
  nowISO,
  dateKey,
  monthKey,
  hour,
  after,
  shiftUtcNaiveToBeijing
};
