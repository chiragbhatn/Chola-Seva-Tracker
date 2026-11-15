/* Hanuman-day logic, shared by the website (public/app.js) and the Worker (src/worker.js).
   Pure functions only: dates are 'YYYY-MM-DD' strings in India's calendar. */

export const DEFAULT_TARGET = 6;
export const MILESTONES = [11, 21, 51, 108];
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD_HI = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const MON_HI = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const parse = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const dow = (s) => parse(s).getDay();
export const isHD = (s) => { const w = dow(s); return w === 2 || w === 6; };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const nextHD = (s) => { let d = addDays(s, 1); while (!isHD(d)) d = addDays(d, 1); return d; };
export const lastHDOnOrBefore = (s) => { let d = s; while (!isHD(d)) d = addDays(d, -1); return d; };
export const nthHDAfter = (s, n) => { let d = s; for (let i = 0; i < n; i++) d = nextHD(d); return d; };
// Tuesdays and Saturdays d with a <= d < b
export const countHD = (a, b) => { let c = 0; let d = isHD(a) ? a : nextHD(a); while (d < b) { c++; d = nextHD(d); } return c; };
export const clampTarget = (t) => { const n = Math.round(Number(t)); return Number.isFinite(n) && n >= 1 ? Math.min(52, n) : DEFAULT_TARGET; };
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
export const fmtDate = (s, withYear, thisYear) => {
  const d = parse(s);
  let t = WD[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
  if (withYear || d.getFullYear() !== thisYear) t += ' ' + d.getFullYear();
  return t;
};
export const shiftMonth = (ym, n) => { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };

export function normalizeData(d) {
  d = d && typeof d === 'object' ? d : {};
  const locations = [];
  const ids = new Set();
  (Array.isArray(d.locations) ? d.locations : []).forEach((l, i) => {
    if (!l || typeof l.id !== 'string' || !l.id || ids.has(l.id)) return;
    ids.add(l.id);
    locations.push({
      id: l.id,
      name: String(l.name || '').trim().slice(0, 60) || l.id,
      target: clampTarget(l.target),
      sortOrder: Number.isFinite(Number(l.sortOrder)) ? Number(l.sortOrder) : i,
      active: l.active !== false && l.active !== 0,
    });
  });
  locations.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const entries = [];
  const dates = new Set();
  (Array.isArray(d.entries) ? d.entries : []).forEach((e) => {
    if (!e || !isYmd(e.date) || typeof e.loc !== 'string' || dates.has(e.date)) return;
    dates.add(e.date);
    entries.push({
      id: String(e.id),
      loc: e.loc,
      date: e.date,
      note: String(e.note || '').slice(0, 200),
      special: String(e.special || '').slice(0, 60),
      createdAt: String(e.createdAt || ''),
    });
  });
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { locations, entries };
}

export function statusFor(loc, lastDate, today, order) {
  const yr = Number(today.slice(0, 4));
  const r = { id: loc.id, name: loc.name, target: loc.target, order, lastDate: lastDate || null };
  if (!lastDate) { r.kind = 'none'; r.group = 0; r.label = 'No visit logged'; r.short = 'no visit logged yet'; return r; }
  r.daysSince = daysBetween(lastDate, today);
  r.due = nthHDAfter(lastDate, loc.target);
  r.hdSince = countHD(nextHD(lastDate), addDays(today, 1));
  if (r.due < today) {
    r.kind = 'over'; r.group = 1; r.overBy = countHD(r.due, today);
    r.label = 'Overdue by ' + plural(r.overBy, 'Hanuman day');
    r.short = 'overdue by ' + plural(r.overBy, 'Hanuman day');
  } else if (r.due === today) {
    r.kind = 'today'; r.group = 2; r.label = 'Due today'; r.short = 'due today';
  } else if (r.due === nextHD(today)) {
    r.kind = 'soon'; r.group = 3; r.label = 'Due ' + fmtDate(r.due, false, yr); r.short = 'due ' + fmtDate(r.due, false, yr);
  } else {
    r.kind = 'ok'; r.group = 4; r.label = 'Fresh'; r.short = 'fresh, due ' + fmtDate(r.due, false, yr);
  }
  return r;
}

export function cmpStatus(a, b) {
  if (a.group !== b.group) return a.group - b.group;
  if (a.group === 0) return a.order - b.order;
  if (a.group === 1 && a.overBy !== b.overBy) return b.overBy - a.overBy;
  if (a.group > 1 && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if (a.daysSince !== b.daysSince) return b.daysSince - a.daysSince;
  return a.order - b.order;
}

export function lastDates(d, today) {
  const m = new Map();
  d.entries.forEach((e) => { if (e.date <= today && !m.has(e.loc)) m.set(e.loc, e.date); });
  return m;
}

export const rankAt = (d, lastMap, day) =>
  d.locations.filter((l) => l.active).map((l, i) => statusFor(l, lastMap.get(l.id), day, i)).sort(cmpStatus);

export function onTimeStreak(entsDesc, target) {
  const asc = entsDesc.slice().reverse();
  let s = 0;
  for (let i = asc.length - 1; i >= 0; i--) {
    const ok = i === 0 || asc[i].date <= nthHDAfter(asc[i - 1].date, target);
    if (!ok) break;
    s++;
  }
  return s;
}

export function buildModel(d, today) {
  const rows = rankAt(d, lastDates(d, today), today);
  rows.forEach((r) => {
    const ents = d.entries.filter((e) => e.loc === r.id && e.date <= today);
    r.count = ents.length;
    r.recent = ents.slice(0, 5);
    r.onTime = r.kind === 'over' || r.kind === 'none' ? 0 : onTimeStreak(ents, r.target);
  });
  return { today, rows };
}

// One location per Hanuman day: assign the most urgent location to each of the next n days.
export function buildPlan(d, today, n) {
  const lastMap = lastDates(d, today);
  const loggedToday = d.entries.some((e) => e.date === today);
  let day = isHD(today) && !loggedToday ? today : nextHD(today);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ranked = rankAt(d, lastMap, day);
    if (!ranked.length) break;
    out.push({ date: day, id: ranked[0].id, name: ranked[0].name });
    lastMap.set(ranked[0].id, day);
    day = nextHD(day);
  }
  return out;
}

// Consecutive Tuesdays and Saturdays with an entry. Today never breaks it while it is still going.
export function sevaStreak(d, today) {
  const days = new Set(d.entries.filter((e) => e.date <= today && isHD(e.date)).map((e) => e.date));
  const todayPending = isHD(today) && !days.has(today);
  if (!days.size) return { current: 0, best: 0, todayPending };
  let day = Array.from(days).sort()[0];
  let run = 0, best = 0;
  while (day <= today) {
    if (days.has(day)) { run++; if (run > best) best = run; }
    else if (day !== today) run = 0;
    day = nextHD(day);
  }
  return { current: run, best, todayPending };
}

// Weeks of a month as rows of { tue, sat }; null where that day falls outside the month.
export function monthHD(ym) {
  const p = ym.split('-').map(Number);
  const first = ymd(new Date(p[0], p[1] - 1, 1));
  const weeks = [];
  const byWeek = new Map();
  let day = isHD(first) ? first : nextHD(first);
  while (day.slice(0, 7) === ym) {
    const key = addDays(day, -dow(day));
    if (!byWeek.has(key)) { const w = { tue: null, sat: null }; byWeek.set(key, w); weeks.push(w); }
    byWeek.get(key)[dow(day) === 2 ? 'tue' : 'sat'] = day;
    day = nextHD(day);
  }
  return weeks;
}

/* ------------------------------------------------------------------
   The WhatsApp reminder: the next Hanuman day's location and the one after.
   ------------------------------------------------------------------ */
function longDate(s, lang) {
  const d = parse(s);
  return lang === 'hi'
    ? WD_HI[d.getDay()] + ' ' + d.getDate() + ' ' + MON_HI[d.getMonth()]
    : WD_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
}

function relDay(s, today, lang) {
  if (s === today) return lang === 'hi' ? 'आज' : 'Today';
  if (s === addDays(today, 1)) return lang === 'hi' ? 'कल' : 'Tomorrow';
  return '';
}

// Returns { date, id, name, title, body, text } or null when there is nothing to plan.
export function reminderText(d, today, opts) {
  const lang = opts && opts.lang === 'hi' ? 'hi' : 'en';
  const url = (opts && opts.url) || '';
  const plan = buildPlan(d, today, 2);
  if (!plan.length) return null;
  const first = plan[0];
  const second = plan[1] || null;
  const last = lastDates(d, today).get(first.id) || null;
  const rel = relDay(first.date, today, lang);
  const when = (rel ? rel + ', ' : '') + longDate(first.date, lang);
  const ago = last ? daysBetween(last, today) : 0;
  const lines = [];
  if (lang === 'hi') {
    lines.push('जय हनुमान 🙏');
    lines.push(when + ': चोला सेवा ' + first.name + ' पर।');
    lines.push('वहाँ पिछला चोला: ' + (last ? longDate(last, 'hi') + (ago === 0 ? ', आज' : ', ' + ago + ' दिन पहले') : 'अभी तक कोई एंट्री नहीं') + '।');
    if (second) lines.push('उसके बाद: ' + longDate(second.date, 'hi') + ', ' + second.name + '।');
    if (url) lines.push('ट्रैकर: ' + url);
  } else {
    lines.push('Jai Hanuman 🙏');
    lines.push(when + ': chola seva at ' + first.name + '.');
    lines.push('Last chola there: ' + (last ? longDate(last, 'en') + (ago === 0 ? ', today' : ', ' + plural(ago, 'day') + ' ago') : 'no visit logged yet') + '.');
    if (second) lines.push('After that: ' + longDate(second.date, 'en') + ' at ' + second.name + '.');
    if (url) lines.push('Tracker: ' + url);
  }
  const relEn = relDay(first.date, today, 'en');
  return {
    date: first.date,
    id: first.id,
    name: first.name,
    title: (relEn || longDate(first.date, 'en')) + ': ' + first.name,
    body: 'Chola seva on ' + longDate(first.date, 'en') + '. Tap to share the plan on WhatsApp.',
    text: lines.join('\n'),
  };
}
