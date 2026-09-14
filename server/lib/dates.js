// ═══════════════════════════════════════════════════════════════════════
// Sana yordamchilari — barchasi "YYYY-MM-DD" satr (Postgres `date` bilan
// mos) ustida ishlaydi. Ataylab JS Date obyektini oy-chegaralar aro
// mutatsiya qilishdan qochamiz — bu chegara holatlarida (masalan 31-son)
// va UTC/timezone bilan bog'liq xatolarga olib kelishi mumkin.
// ═══════════════════════════════════════════════════════════════════════

// Hozirgi sana — Toshkent (UTC+5) bo'yicha, "YYYY-MM-DD"
function todayTashkent() {
  const t = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y, m /* 1-12 */) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// dateStr'ga N kalendar kun qo'shadi (manfiy bo'lishi ham mumkin)
function addDays(dateStr, n) {
  const { y, m, d } = parseDate(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// dateStr'ga N oy qo'shadi, kun-clamp bilan (masalan 31-yanvar + 1 oy =
// 28/29-fevral — chunki fevralda 31-kun yo'q). Bu — real dunyoda oylik
// billing tizimlarida (bank kartalari va h.k.) standart va kutilgan
// xulq-atvor; faqat oyning 29/30/31-kunlarida boshlangan loyihalarga
// tegishli chegara holati.
function addMonthsClamped(dateStr, n) {
  const { y, m, d } = parseDate(dateStr);
  const totalMonths = y * 12 + (m - 1) + n;
  const ny = Math.floor(totalMonths / 12);
  const nm0 = ((totalMonths % 12) + 12) % 12; // 0-indexed, manfiy bo'lmasin
  const nm = nm0 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return formatDate(ny, nm, nd);
}

// Berilgan loyiha anchor_date'i va cycle_index (1,2,3,...) asosida
// shu davrning [period_start, period_end] chegaralarini hisoblaydi.
function cycleBounds(anchorDate, cycleIndex) {
  const periodStart = addMonthsClamped(anchorDate, cycleIndex - 1);
  const nextStart = addMonthsClamped(anchorDate, cycleIndex);
  const periodEnd = addDays(nextStart, -1);
  return { periodStart, periodEnd };
}

// b - a, kunlarda (ikkisi ham "YYYY-MM-DD")
function dayDiff(aStr, bStr) {
  const a = Date.parse(aStr + "T00:00:00Z");
  const b = Date.parse(bStr + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

module.exports = {
  todayTashkent,
  parseDate,
  addDays,
  addMonthsClamped,
  cycleBounds,
  dayDiff,
};
