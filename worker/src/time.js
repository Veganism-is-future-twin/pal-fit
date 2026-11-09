// IST (Asia/Kolkata) date helpers.
// India has no daylight saving, so IST is always exactly UTC + 5:30.
// All "which day is it?" decisions are made here on the server — never trust
// the phone's clock.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** 'YYYY-MM-DD' for the IST calendar day containing `date` (default: now). */
export function istDate(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's IST date, 'YYYY-MM-DD'. */
export function todayIST() {
  return istDate();
}

/** Add (or subtract) whole days to a 'YYYY-MM-DD' string. */
export function addDays(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Yesterday's IST date, 'YYYY-MM-DD'. */
export function yesterdayIST() {
  return addDays(todayIST(), -1);
}

/** True if `s` is a real calendar date in 'YYYY-MM-DD' form. */
export function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'); positive if b is later. */
export function daysBetween(a, b) {
  return Math.round(
    (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000
  );
}

/** Age in whole years on IST date `onYmd` for a 'YYYY-MM-DD' birth date. */
export function ageOn(dobYmd, onYmd = todayIST()) {
  if (!isValidYmd(dobYmd)) return null;
  const [by, bm, bd] = dobYmd.split('-').map(Number);
  const [ty, tm, td] = onYmd.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

/** SQLite-style UTC timestamp 'YYYY-MM-DD HH:MM:SS' (matches datetime('now')). */
export function sqlNow(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
