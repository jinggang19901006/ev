const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function getBeijingHour(value = Date.now()) {
  return new Date(Number(value) + BEIJING_OFFSET_MS).getUTCHours();
}

module.exports = { getBeijingHour };
