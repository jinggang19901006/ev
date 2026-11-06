const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const NAIVE_DATE_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
const NAIVE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parse(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (!value) return new Date(NaN);
  const text = String(value).trim();
  const match = text.match(NAIVE_DATE_TIME);
  if (match && !EXPLICIT_ZONE.test(text)) {
    return new Date(Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0)
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
  const date = value instanceof Date || typeof value === 'number' ? new Date(value) : parse(value);
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function two(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(value) {
  const item = parts(value);
  if (!Number.isFinite(item.year)) return '';
  return `${item.year}-${two(item.month)}-${two(item.day)} ${two(item.hour)}:${two(item.minute)}`;
}

function formatMonthDayTime(value) {
  const item = parts(value);
  if (!Number.isFinite(item.year)) return '';
  return `${item.month}月${item.day}日 ${two(item.hour)}:${two(item.minute)}`;
}

function formatRelative(value) {
  const date = parse(value);
  if (!Number.isFinite(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff >= 0 && diff < 60000) return '刚刚';
  if (diff >= 0 && diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff >= 0 && diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return formatMonthDayTime(date);
}

function getBeijingHour(value = Date.now()) {
  return parts(value).hour;
}

module.exports = { parse, formatDateTime, formatMonthDayTime, formatRelative, getBeijingHour };
