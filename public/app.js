/* Chola Seva Tracker, front end.
   Reads /api/data (Cloudflare Worker over D1). Everyone sees a read-only view;
   the owner unlocks logging on their phone with the ADMIN_KEY secret. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Hanuman-day logic. Pure functions: dates are 'YYYY-MM-DD' strings
     in the phone's local time.
     ------------------------------------------------------------------ */
  const DEFAULT_TARGET = 6;
  const MILESTONES = [11, 21, 51, 108];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dow = (s) => parse(s).getDay();
  const isHD = (s) => { const w = dow(s); return w === 2 || w === 6; };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const nextHD = (s) => { let d = addDays(s, 1); while (!isHD(d)) d = addDays(d, 1); return d; };
  const lastHDOnOrBefore = (s) => { let d = s; while (!isHD(d)) d = addDays(d, -1); return d; };
  const nthHDAfter = (s, n) => { let d = s; for (let i = 0; i < n; i++) d = nextHD(d); return d; };
  // Tuesdays and Saturdays d with a <= d < b
  const countHD = (a, b) => { let c = 0; let d = isHD(a) ? a : nextHD(a); while (d < b) { c++; d = nextHD(d); } return c; };
  const clampTarget = (t) => { const n = Math.round(Number(t)); return Number.isFinite(n) && n >= 1 ? Math.min(52, n) : DEFAULT_TARGET; };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const fmtDate = (s, withYear, thisYear) => {
    const d = parse(s);
    let t = WD[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
    if (withYear || d.getFullYear() !== thisYear) t += ' ' + d.getFullYear();
    return t;
  };
  const shiftMonth = (ym, n) => { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };

  function normalizeData(d) {
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

  function statusFor(loc, lastDate, today, order) {
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

  function cmpStatus(a, b) {
    if (a.group !== b.group) return a.group - b.group;
    if (a.group === 0) return a.order - b.order;
    if (a.group === 1 && a.overBy !== b.overBy) return b.overBy - a.overBy;
    if (a.group > 1 && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.daysSince !== b.daysSince) return b.daysSince - a.daysSince;
    return a.order - b.order;
  }

  function lastDates(d, today) {
    const m = new Map();
    d.entries.forEach((e) => { if (e.date <= today && !m.has(e.loc)) m.set(e.loc, e.date); });
    return m;
  }

  const rankAt = (d, lastMap, day) =>
    d.locations.filter((l) => l.active).map((l, i) => statusFor(l, lastMap.get(l.id), day, i)).sort(cmpStatus);

  function onTimeStreak(entsDesc, target) {
    const asc = entsDesc.slice().reverse();
    let s = 0;
    for (let i = asc.length - 1; i >= 0; i--) {
      const ok = i === 0 || asc[i].date <= nthHDAfter(asc[i - 1].date, target);
      if (!ok) break;
      s++;
    }
    return s;
  }

  function buildModel(d, today) {
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
  function buildPlan(d, today, n) {
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
  function sevaStreak(d, today) {
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
  function monthHD(ym) {
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
     State, storage and the API
     ------------------------------------------------------------------ */
  const KEY_STORE = 'chola-owner-key';
  const CACHE_STORE = 'chola-data-v1';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const todayStr = () => ymd(new Date());
  const fmt = (s, withYear) => fmtDate(s, !!withYear, new Date().getFullYear());

  let data = null;            // { locations, entries }
  let loadState = 'loading';  // loading | ok | stale | error
  let syncedAt = 0;
  let ownerKey = store.get(KEY_STORE) || '';
  let owner = !!ownerKey;

  const ui = {
    diaryMonth: todayStr().slice(0, 7),
    logLimit: 20,
    open: new Set(),
    settings: null,
    sheet: null,
    lastFocus: null,
    toastFn: null,
    animated: false,
  };

  const locName = (id) => { const l = data && data.locations.find((x) => x.id === id); return l ? l.name : 'Removed location'; };

  async function api(method, path, body, key) {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    const k = key || (method !== 'GET' ? ownerKey : '');
    if (k) headers['x-admin-key'] = k;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (e) {
      const err = new Error('No connection. Check the internet and try again.');
      err.code = 'offline';
      throw err;
    }
    let out = null;
    try { out = await res.json(); } catch (e) { out = null; }
    if (!res.ok) {
      const err = new Error((out && out.error && out.error.message) || 'The server answered with an error (' + res.status + ').');
      err.code = (out && out.error && out.error.code) || 'http_' + res.status;
      err.status = res.status;
      throw err;
    }
    return out;
  }

  function saveCache() { if (data) store.set(CACHE_STORE, JSON.stringify({ at: syncedAt, data })); }

  async function load(quiet) {
    try {
      const d = await api('GET', '/api/data');
      data = normalizeData(d);
      loadState = 'ok';
      syncedAt = Date.now();
      saveCache();
    } catch (e) {
      if (!data) {
        let c = null;
        try { c = JSON.parse(store.get(CACHE_STORE) || 'null'); } catch (x) { c = null; }
        if (c && c.data) { data = normalizeData(c.data); syncedAt = c.at || 0; loadState = 'stale'; }
        else loadState = 'error';
      } else if (!quiet) loadState = 'stale';
    }
    renderAll();
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */
  function renderAll() {
    renderHeader();
    if (!data) {
      renderLoading();
      return;
    }
    const t = todayStr();
    const m = buildModel(data, t);
    const plan = buildPlan(data, t, 6);
    renderNext(m, plan);
    renderSummary(m, sevaStreak(data, t));
    renderLocs(m);
    renderPlan(plan);
    renderDiary();
    renderLog();
    renderSettings();
    renderFoot();
    renderFab();
    if (ui.sheet) renderSheet();
  }

  function renderHeader() {
    const t = todayStr();
    const d = parse(t);
    $('#today').innerHTML = esc(WD_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MON_FULL[d.getMonth()]) +
      (isHD(t) ? '<span class="hd-tag">Hanuman day</span>' : '');
  }

  function renderLoading() {
    if (loadState === 'error') {
      $('#next').innerHTML =
        '<p class="next-when">The diary did not load</p>' +
        '<p class="next-name next-name-sm">No connection</p>' +
        '<p class="next-why">Check the internet connection, then try again.</p>' +
        '<div class="next-actions"><button type="button" class="btn on-sindoor" data-act="retry">Try again</button></div>';
    }
    renderFoot();
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const listJoin = (parts) => (parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);

  // The sindoor field: "Tuesday 17 Nov, go to" + the location name.
  function renderNext(m, plan) {
    const t = m.today;
    const todayEntry = data.entries.find((e) => e.date === t);
    let h = todayEntry ? '<p class="next-done">Today’s chola is done at ' + esc(locName(todayEntry.loc)) + '.</p>' : '';
    if (!data.entries.length || !plan.length) {
      h +=
        '<p class="next-when">Start the round</p>' +
        '<h2 class="next-name next-name-sm">Log the first chola</h2>' +
        '<p class="next-why">After the first entry, this shows where to go each Tuesday and Saturday.</p>' +
        (owner ? '<div class="next-actions"><button type="button" class="btn on-sindoor" data-act="log">Log chola</button></div>' : '');
    } else {
      const p = plan[0];
      const row = m.rows.find((r) => r.id === p.id);
      const isToday = p.date === t;
      const d = parse(p.date);
      const when = (isToday ? 'Today' : WD_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]) + ', go to';
      let why = 'No visit logged here yet.';
      if (row && row.lastDate) {
        why = 'Last chola ' + fmt(row.lastDate) + (row.daysSince === 0 ? ', today. ' : ', ' + plural(row.daysSince, 'day') + ' ago. ') + cap(row.short) + '.';
      }
      h +=
        '<p class="next-when">' + esc(when) + '</p>' +
        '<h2 class="next-name">' + esc(p.name) + '</h2>' +
        '<p class="next-why">' + esc(why) + '</p>';
      if (owner && isToday) {
        h += '<div class="next-actions"><button type="button" class="btn on-sindoor" data-act="log" data-loc="' + esc(p.id) + '" data-date="' + p.date + '">Log today’s chola</button></div>';
      }
    }
    $('#next').innerHTML = h;
  }

  // One sentence for the state of all locations, then the seva streak.
  function renderSummary(m, streak) {
    const t = m.today;
    const c = { over: 0, soon: 0, none: 0, ok: 0 };
    m.rows.forEach((r) => {
      if (r.kind === 'over') c.over++;
      else if (r.kind === 'today' || r.kind === 'soon') c.soon++;
      else if (r.kind === 'ok') c.ok++;
      else c.none++;
    });
    const n = m.rows.length;
    const v = (k, one, many) => k + ' ' + (k === 1 ? one : many);
    const parts = [];
    if (c.over) parts.push(v(c.over, 'is overdue', 'are overdue'));
    if (c.soon) parts.push(v(c.soon, 'is due soon', 'are due soon'));
    if (c.none) parts.push(v(c.none, 'has no visit logged yet', 'have no visit logged yet'));
    if (c.ok) parts.push(v(c.ok, 'is fresh', 'are fresh'));
    let tally = '';
    if (n && c.ok === n) tally = 'All ' + n + ' locations are fresh.';
    else if (n) tally = 'Of the ' + n + ' locations, ' + listJoin(parts) + '.';

    const wd = WD_FULL[dow(t)];
    let note;
    if (streak.todayPending) note = streak.current > 0 ? 'Today is ' + wd + ': log today’s chola to keep it going.' : 'Today is ' + wd + ', a Hanuman day.';
    else note = 'A skipped Tuesday or Saturday resets it.';
    const reached = MILESTONES.filter((x) => streak.best >= x);
    const nextMs = MILESTONES.find((x) => x > streak.current);
    const ms = nextMs
      ? '<div class="ms"><div class="ms-track" role="img" aria-label="' + streak.current + ' of ' + nextMs + ' Hanuman days toward the next milestone">' +
        '<span style="width:' + Math.round((streak.current / nextMs) * 100) + '%"></span></div>' +
        '<p class="ms-text">' + (nextMs - streak.current) + ' more for the ' + nextMs + '-day milestone.' +
        (reached.length ? ' Reached so far: ' + reached.join(', ') + '.' : '') + '</p></div>'
      : '<p class="ms-text">Every milestone reached: ' + MILESTONES.join(', ') + '.</p>';
    $('#summary').innerHTML =
      (tally ? '<p class="tally">' + esc(tally) + '</p>' : '') +
      '<div class="streak"><p class="streak-num">' + streak.current + '</p><div>' +
      '<p class="streak-label">' + (streak.current === 1 ? 'Hanuman day' : 'Hanuman days') + ' in a row</p>' +
      '<p class="streak-sub">Best streak ' + streak.best + '. ' + esc(note) + '</p></div></div>' + ms;
  }

  // One row per location. The gauge is how much of the chola's round is left:
  // full right after a visit, empty (ash crosshatch) once overdue.
  function renderLocs(m) {
    const el = $('#locs');
    if (!m.rows.length) {
      el.innerHTML = '<li class="empty">No locations yet.' + (owner ? ' Add one under Settings.' : '') + '</li>';
      return;
    }
    const firstTime = !ui.animated;
    ui.animated = true;
    el.classList.toggle('fill-in', firstTime);
    el.innerHTML = m.rows.map((r) => {
      const open = ui.open.has(r.id);
      const fresh = r.kind === 'none' ? 0 : Math.max(0, Math.min(1, (r.target - r.hdSince) / r.target));
      const status = r.kind === 'none' ? 'Not logged yet' : r.kind === 'ok' ? 'Due ' + fmt(r.due) : r.label;
      const meta = r.kind === 'none'
        ? 'Its next visit puts it into the round.'
        : 'Last chola ' + fmt(r.lastDate) + (r.daysSince === 0 ? ', today' : ', ' + plural(r.daysSince, 'day') + ' ago');
      let detail = '';
      if (open) {
        detail =
          '<div class="row-detail">' +
          (r.kind !== 'none'
            ? '<dl class="facts">' +
              '<div><dt>Due</dt><dd>' + esc(fmt(r.due)) + '</dd></div>' +
              '<div><dt>Hanuman days since</dt><dd>' + r.hdSince + ' of ' + r.target + '</dd></div>' +
              '<div><dt>On-time streak</dt><dd>' + plural(r.onTime, 'visit') + '</dd></div>' +
              '<div><dt>Visits logged</dt><dd>' + r.count + '</dd></div>' +
              '</dl>'
            : '') +
          (r.recent.length
            ? '<div><p class="label">Recent visits</p><ul class="hist">' + r.recent.map((e) =>
                '<li><span class="hist-date">' + esc(fmt(e.date)) + '</span>' + (e.note ? '<span class="hist-note">' + esc(e.note) + '</span>' : '') + '</li>'
              ).join('') + '</ul></div>'
            : '') +
          (owner ? '<button type="button" class="btn" data-act="log" data-loc="' + esc(r.id) + '">Log chola at ' + esc(r.name) + '</button>' : '') +
          '</div>';
      }
      return (
        '<li class="row k-' + r.kind + (open ? ' open' : '') + '">' +
        '<button type="button" class="row-main" data-act="row" data-loc="' + esc(r.id) + '" aria-expanded="' + open + '">' +
        '<span class="row-name">' + esc(r.name) + '</span>' +
        '<span class="row-status">' + esc(status) + '</span>' +
        '<span class="gauge" aria-hidden="true"><span style="width:' + Math.round(fresh * 100) + '%"></span></span>' +
        '<span class="row-foot"><span class="row-meta">' + esc(meta) + '</span><span class="chev" aria-hidden="true"></span></span>' +
        '</button>' + detail + '</li>'
      );
    }).join('');
    if (firstTime) setTimeout(() => el.classList.remove('fill-in'), 900);
  }

  function renderPlan(plan) {
    const sec = $('#plan-sec');
    if (!data.entries.length || !plan.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const t = todayStr();
    $('#plan').innerHTML = plan.map((p, i) =>
      '<li class="plan-item' + (i === 0 ? ' first' : '') + '"><span class="plan-date">' + esc(p.date === t ? 'Today' : fmt(p.date)) + '</span>' +
      '<span class="plan-loc">' + esc(p.name) + '</span></li>'
    ).join('');
  }

  const firstEntryDate = () => (data.entries.length ? data.entries[data.entries.length - 1].date : null);

  function calGrid(ym, opts) {
    const byDate = new Map(data.entries.map((e) => [e.date, e]));
    const first = firstEntryDate();
    const cell = (d) => {
      if (!d) return '<div class="cal-cell empty" aria-hidden="true"></div>';
      const e = byDate.get(d);
      const future = d > opts.today;
      let cls = 'cal-cell';
      let inner = '<span class="d">' + Number(d.slice(8)) + '</span>';
      let label = fmt(d);
      if (future) { cls += ' future'; label += ', not yet'; }
      else if (e) { cls += ' done'; inner += '<span class="l">' + esc(locName(e.loc)) + '</span>'; label += ': ' + locName(e.loc); }
      else if (d === opts.today) { inner += '<span class="m">Not logged yet</span>'; label += ': not logged yet'; }
      else if (first && d > first) { cls += ' missed'; inner += '<span class="m">Missed</span>'; label += ': missed'; }
      else { label += ': before the diary starts'; }
      if (d === opts.today) cls += ' is-today';
      if (d === opts.selected) cls += ' selected';
      if (opts.clickable && !future) {
        return '<button type="button" class="' + cls + '" data-act="' + opts.act + '" data-date="' + d + '" aria-label="' + esc(label) + '"' +
          (d === opts.selected ? ' aria-pressed="true"' : '') + '>' + inner + '</button>';
      }
      return '<div class="' + cls + '">' + inner + '</div>';
    };
    let h = '<div class="cal-grid"><div class="cal-col">Tuesday</div><div class="cal-col">Saturday</div>';
    monthHD(ym).forEach((w) => { h += cell(w.tue) + cell(w.sat); });
    return h + '</div>';
  }

  function calHead(ym, prevAct, nextAct) {
    const p = ym.split('-').map(Number);
    const atEnd = ym >= todayStr().slice(0, 7);
    return '<div class="cal-head">' +
      '<button type="button" class="icon-btn" data-act="' + prevAct + '" aria-label="Previous month">‹</button>' +
      '<p class="cal-title">' + MON_FULL[p[1] - 1] + ' ' + p[0] + '</p>' +
      '<button type="button" class="icon-btn" data-act="' + nextAct + '" aria-label="Next month"' + (atEnd ? ' disabled' : '') + '>›</button>' +
      '</div>';
  }

  function renderDiary() {
    const t = todayStr();
    const ym = ui.diaryMonth;
    const first = firstEntryDate();
    const monthEntries = data.entries.filter((e) => e.date.slice(0, 7) === ym);
    const specials = monthEntries.filter((e) => !isHD(e.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const days = [];
    monthHD(ym).forEach((w) => { if (w.tue) days.push(w.tue); if (w.sat) days.push(w.sat); });
    const logged = new Set(monthEntries.map((e) => e.date));
    const counted = days.filter((d) => first && d >= first && (d < t || (d === t && logged.has(d))));
    const done = counted.filter((d) => logged.has(d)).length;
    $('#diary').innerHTML =
      calHead(ym, 'diary-prev', 'diary-next') +
      calGrid(ym, { today: t, selected: null, clickable: owner, act: 'diary-day' }) +
      (counted.length ? '<p class="cal-sum">' + done + ' of ' + counted.length + ' Hanuman days logged this month</p>' : '') +
      (specials.length
        ? '<div class="specials"><p class="label">Special days</p><ul>' +
          specials.map((e) => '<li><b>' + esc(locName(e.loc)) + '</b> on ' + esc(fmt(e.date)) + ', ' + esc(e.special || 'a special day') + '</li>').join('') +
          '</ul></div>'
        : '');
  }

  function renderLog() {
    const list = data.entries;
    $('#log-count').textContent = list.length ? plural(list.length, 'entry', 'entries') : '';
    if (!list.length) {
      $('#log').innerHTML = '<p class="empty">No chola logged yet.</p>';
      return;
    }
    const shown = list.slice(0, ui.logLimit);
    $('#log').innerHTML =
      '<ol class="log">' + shown.map((e) =>
        '<li><span class="when">' + esc(fmt(e.date)) + '</span>' +
        '<div class="entry-text"><span class="what">' + esc(locName(e.loc)) + (e.special ? '<span class="tag">' + esc(e.special) + '</span>' : '') + '</span>' +
        (e.note ? '<span class="note">' + esc(e.note) + '</span>' : '') + '</div>' +
        (owner ? '<button type="button" class="btn quiet sm" data-act="edit" data-id="' + esc(e.id) + '" aria-label="Edit entry for ' + esc(fmt(e.date)) + '">Edit</button>' : '<span></span>') +
        '</li>'
      ).join('') + '</ol>' +
      (list.length > shown.length ? '<button type="button" class="btn more" data-act="log-more">Show older entries</button>' : '');
  }

  function settingsDirty() {
    return !!ui.settings && JSON.stringify(ui.settings) !== JSON.stringify(data.locations);
  }

  function renderSettings() {
    const el = $('#settings');
    if (!owner) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const locs = ui.settings || data.locations;
    const dirty = settingsDirty();
    el.innerHTML =
      '<div class="sec-head"><h2 class="sec" id="h-settings">Settings</h2><p class="hint">Visible only on unlocked phones</p></div>' +
      '<div class="settings">' +
      '<p class="label">Locations and targets</p>' +
      '<p class="hint">Target is the number of Hanuman days before a location is due again. With 6 locations, 6 is one full round.</p>' +
      locs.map((l, i) =>
        '<div class="set-row' + (l.active ? '' : ' removed') + '">' +
        '<div class="field"><label class="label" for="set-name-' + i + '">Name</label><input type="text" id="set-name-' + i + '" data-set="name" data-i="' + i + '" value="' + esc(l.name) + '" maxlength="60"' + (l.active ? '' : ' disabled') + '></div>' +
        '<div class="field"><label class="label" for="set-target-' + i + '">Target</label><input type="number" inputmode="numeric" min="1" max="52" id="set-target-' + i + '" data-set="target" data-i="' + i + '" value="' + esc(l.target) + '"' + (l.active ? '' : ' disabled') + '></div>' +
        '<button type="button" class="btn ' + (l.active ? 'quiet' : '') + ' sm" data-act="set-toggle" data-i="' + i + '">' + (l.active ? 'Hide location' : 'Show again') + '</button>' +
        '</div>'
      ).join('') +
      '<div class="set-add"><div class="field"><label class="label" for="set-new">Add a location</label><input type="text" id="set-new" maxlength="60" placeholder="Location name"></div>' +
      '<button type="button" class="btn" data-act="set-add">Add</button></div>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" data-act="set-save"' + (dirty ? '' : ' disabled') + '>Save settings</button>' +
      '<button type="button" class="btn" data-act="set-discard"' + (dirty ? '' : ' disabled') + '>Discard changes</button></div>' +
      '<hr class="rule">' +
      '<p class="label">Backup</p><p class="hint">Copies every entry as text to keep in a note or an email.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-act="backup">Copy backup</button>' +
      '<button type="button" class="btn quiet" data-act="lock">Lock logging on this phone</button></div>' +
      '<textarea id="backup-text" class="backup" readonly hidden></textarea>' +
      '</div>';
  }

  function renderFoot() {
    let sync = '';
    if (loadState === 'stale') {
      sync = 'Offline. Showing the copy saved on this phone' +
        (syncedAt ? ' at ' + new Date(syncedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '') + '.';
    } else if (syncedAt) {
      sync = 'Up to date as of ' + new Date(syncedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + '.';
    }
    $('#foot').innerHTML =
      '<p>Chola is offered on Tuesdays and Saturdays, at one location each day.</p>' +
      (sync ? '<p>' + esc(sync) + '</p>' : '') +
      (owner ? '<p>Logging is unlocked on this phone.</p>' : '<button type="button" class="link-btn" data-act="unlock">Owner? Unlock logging</button>');
  }

  function renderFab() {
    $('#fab-root').innerHTML = owner && data && !ui.sheet ? '<button type="button" class="fab" data-act="log">+ Log chola</button>' : '';
  }

  /* ------------------------------------------------------------------
     Bottom sheets: log an entry, unlock logging
     ------------------------------------------------------------------ */
  // Today on a Tuesday or Saturday; otherwise the last one, unless it is already logged.
  const defaultSheetDate = () => {
    const t = todayStr();
    if (isHD(t)) return t;
    const last = lastHDOnOrBefore(t);
    return data.entries.some((e) => e.date === last) ? '' : last;
  };

  const newEntrySheet = (date, loc) => ({
    kind: 'entry', mode: 'new', intent: 'new', entryId: null, orig: null,
    date: date || '', spDate: '', special: false, occasion: 'Hanuman Jayanti',
    loc: loc || '', note: '', month: (date || todayStr()).slice(0, 7),
    err: '', notice: '', confirmDelete: false, busy: false,
  });

  // intent 'edit' = opened from an entry's Edit button (picking an empty date moves the entry);
  // intent 'new' = opened to log (picking an empty date starts a fresh entry).
  function sheetFromEntry(e, intent) {
    const special = !isHD(e.date);
    return {
      kind: 'entry', mode: 'edit', intent: intent || 'edit', entryId: e.id, orig: clone(e),
      date: special ? '' : e.date, spDate: special ? e.date : '', special,
      occasion: e.special || 'Hanuman Jayanti', loc: e.loc, note: e.note,
      month: e.date.slice(0, 7), err: '', notice: '', confirmDelete: false, busy: false,
    };
  }

  function openSheet(s) {
    ui.lastFocus = document.activeElement;
    ui.sheet = s;
    document.body.classList.add('locked');
    renderSheet();
    renderFab();
    const f = $('#sheet-root [data-autofocus]') || $('#sheet-root .sheet-head .icon-btn');
    if (f) f.focus({ preventScroll: true });
  }

  function openEntrySheet(opts) {
    if (!data) return;
    opts = opts || {};
    if (opts.entryId) {
      const e = data.entries.find((x) => x.id === opts.entryId);
      if (e) openSheet(sheetFromEntry(e));
      return;
    }
    const date = opts.date || defaultSheetDate();
    const existing = date && data.entries.find((x) => x.date === date);
    if (existing) {
      const s = sheetFromEntry(existing, 'new');
      s.notice = fmt(date) + ' already has ' + locName(existing.loc) + '. You are editing that entry; pick another date to log a new one.';
      openSheet(s);
      return;
    }
    openSheet(newEntrySheet(date, opts.loc));
  }

  function closeSheet() {
    ui.sheet = null;
    $('#sheet-root').innerHTML = '';
    document.body.classList.remove('locked');
    renderFab();
    if (ui.lastFocus && document.contains(ui.lastFocus)) { try { ui.lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function renderSheet() {
    const s = ui.sheet;
    const root = $('#sheet-root');
    if (!s) { root.innerHTML = ''; return; }
    const active = document.activeElement;
    const focusId = active && active.id;
    const focusAct = active && active.dataset ? (active.dataset.act || '') + '|' + (active.dataset.date || '') : '';
    root.innerHTML = s.kind === 'unlock' ? unlockSheetHtml(s) : entrySheetHtml(s);
    if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus({ preventScroll: true });
    else if (focusAct && focusAct !== '|') {
      const parts = focusAct.split('|');
      const b = root.querySelector('[data-act="' + parts[0] + '"]' + (parts[1] ? '[data-date="' + parts[1] + '"]' : ''));
      if (b) b.focus({ preventScroll: true });
    }
  }

  function entrySheetHtml(s) {
    const t = todayStr();
    const m = buildModel(data, t);
    const finalDate = s.special ? s.spDate : s.date;
    const rows = m.rows.slice();
    if (s.loc && !rows.some((r) => r.id === s.loc)) {
      const l = data.locations.find((x) => x.id === s.loc);
      if (l) rows.push({ id: l.id, name: l.name + ' (hidden)', lastDate: null });
    }
    const radios = rows.map((r) =>
      '<label class="radio"><input type="radio" name="sh-loc" value="' + esc(r.id) + '"' + (s.loc === r.id ? ' checked' : '') + '>' +
      '<span class="rtext"><span class="rname">' + esc(r.name) + '</span><span class="rmeta">' + esc(r.lastDate ? 'last ' + fmt(r.lastDate) : 'no visit yet') + '</span></span></label>'
    ).join('');
    const cal = s.special ? '' : calHead(s.month, 'sheet-prev', 'sheet-next') + calGrid(s.month, { today: t, selected: s.date, clickable: true, act: 'sheet-day' });
    const sp = s.special
      ? '<div class="sp-fields">' +
        '<div class="field"><label class="label" for="sh-spdate">Date</label><input type="date" id="sh-spdate" max="' + t + '" value="' + esc(s.spDate) + '"></div>' +
        '<div class="field"><label class="label" for="sh-occ">Occasion</label><input type="text" id="sh-occ" maxlength="60" value="' + esc(s.occasion) + '"></div>' +
        '</div>'
      : '';
    let actions =
      '<button type="button" class="btn primary" data-act="sheet-save"' + (s.busy ? ' disabled' : '') + '>' +
      (s.busy ? '<span class="spinner" aria-hidden="true"></span> Saving' : s.mode === 'edit' ? 'Save changes' : 'Save entry') + '</button>' +
      '<button type="button" class="btn" data-act="sheet-close">Cancel</button>';
    if (s.mode === 'edit') {
      actions += s.confirmDelete
        ? '<span class="confirm">Delete this entry?</span><button type="button" class="btn danger" data-act="sheet-delete-yes">Yes, delete</button><button type="button" class="btn quiet" data-act="sheet-delete-no">Keep it</button>'
        : '<button type="button" class="btn quiet danger-text" data-act="sheet-delete">Delete</button>';
    }
    return (
      '<div class="scrim" data-act="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-head"><h2 id="sheet-title">' + (s.mode === 'edit' ? 'Edit entry' : 'Log chola') + '</h2>' +
      '<button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">×</button></div>' +
      '<p class="sheet-date">' + (finalDate ? esc(fmt(finalDate, true)) + (s.special && s.occasion ? ', ' + esc(s.occasion) : '') : 'Pick a date') + '</p>' +
      (s.notice ? '<p class="notice">' + esc(s.notice) + '</p>' : '') +
      cal +
      '<label class="switch"><input type="checkbox" id="sh-special"' + (s.special ? ' checked' : '') + '><span>Special day outside Tuesday and Saturday</span></label>' +
      sp +
      '<fieldset class="field"><legend class="label">Location (one per day)</legend><div class="radios">' + radios + '</div></fieldset>' +
      '<div class="field"><label class="label" for="sh-note">Note (optional)</label>' +
      '<input type="text" id="sh-note" maxlength="200" placeholder="e.g. chameli oil, new silver varak" value="' + esc(s.note) + '"></div>' +
      (s.err ? '<p class="err" role="alert">' + esc(s.err) + '</p>' : '') +
      '<div class="sheet-actions">' + actions + '</div>' +
      '</div></div>'
    );
  }

  function unlockSheetHtml(s) {
    return (
      '<div class="scrim" data-act="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-head"><h2 id="sheet-title">Unlock logging</h2>' +
      '<button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">×</button></div>' +
      '<p class="hint">Enter the logging key set in Cloudflare. This phone remembers it until you lock logging again.</p>' +
      '<div class="field"><label class="label" for="unlock-key">Logging key</label>' +
      '<input type="password" id="unlock-key" autocomplete="current-password" value="' + esc(s.key) + '" data-autofocus></div>' +
      (s.err ? '<p class="err" role="alert">' + esc(s.err) + '</p>' : '') +
      '<div class="sheet-actions"><button type="button" class="btn primary" data-act="unlock-go"' + (s.busy ? ' disabled' : '') + '>' +
      (s.busy ? '<span class="spinner" aria-hidden="true"></span> Checking' : 'Unlock') + '</button>' +
      '<button type="button" class="btn" data-act="sheet-close">Cancel</button></div>' +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------------
     Writes
     ------------------------------------------------------------------ */
  function upsertLocal(entry, replaceId) {
    data.entries = data.entries.filter((e) => e.id !== (replaceId || entry.id) && e.id !== entry.id);
    data.entries.push(entry);
    data = normalizeData(data);
    saveCache();
  }

  function removeLocal(id) {
    data.entries = data.entries.filter((e) => e.id !== id);
    saveCache();
  }

  function lockOwner(message) {
    owner = false;
    ownerKey = '';
    store.del(KEY_STORE);
    ui.settings = null;
    if (message) toast(message);
    renderAll();
  }

  function writeError(e) {
    if (e.code === 'wrong_key') { lockOwner(); return 'Your logging key was not accepted, so this phone is locked again. Unlock logging and try again.'; }
    if (e.code === 'no_key_set') return 'Logging is not set up yet: add the ADMIN_KEY secret in Cloudflare.';
    return e.message || 'Something went wrong. Try again.';
  }

  async function submitEntry() {
    const s = ui.sheet;
    if (!s || s.busy) return;
    const t = todayStr();
    const date = s.special ? s.spDate : s.date;
    let err = '';
    if (!date || !isYmd(date)) err = s.special ? 'Pick the date of the special day.' : 'Pick a Tuesday or Saturday in the calendar.';
    else if (date > t) err = 'That date is in the future. Pick today or an earlier date.';
    else if (!s.special && !isHD(date)) err = 'Pick a Tuesday or Saturday.';
    else if (s.special && isHD(date)) err = 'That date is a ' + WD_FULL[dow(date)] + '. Turn off Special day and pick it in the calendar.';
    else if (s.special && !s.occasion.trim()) err = 'Name the occasion, such as Hanuman Jayanti.';
    else if (!s.loc) err = 'Pick the location.';
    else {
      const clash = data.entries.find((e) => e.date === date && e.id !== s.entryId);
      if (clash) err = fmt(date) + ' already has ' + locName(clash.loc) + '. Each date holds one location.';
    }
    if (err) { s.err = err; renderSheet(); return; }
    const body = { loc: s.loc, date, note: s.note.trim(), special: s.special ? s.occasion.trim() : '' };
    s.busy = true; s.err = ''; renderSheet();
    try {
      const res = s.mode === 'edit'
        ? await api('PUT', '/api/entries/' + encodeURIComponent(s.entryId), body)
        : await api('POST', '/api/entries', body);
      const saved = normalizeData({ locations: [], entries: [res.entry] }).entries[0];
      const mode = s.mode;
      const prev = s.orig;
      upsertLocal(saved, s.entryId);
      closeSheet();
      renderAll();
      toast('Saved: ' + locName(saved.loc) + ' on ' + fmt(saved.date) + '.', {
        label: 'Undo',
        fn: () => (mode === 'edit' ? undoEdit(saved, prev) : undoAdd(saved)),
      });
    } catch (e) {
      if (!ui.sheet) return;
      ui.sheet.busy = false;
      ui.sheet.err = writeError(e);
      renderSheet();
    }
  }

  async function deleteEntry() {
    const s = ui.sheet;
    if (!s || s.busy || !s.entryId) return;
    s.busy = true; renderSheet();
    try {
      await api('DELETE', '/api/entries/' + encodeURIComponent(s.entryId));
      const prev = s.orig;
      removeLocal(s.entryId);
      closeSheet();
      renderAll();
      toast('Deleted the entry for ' + fmt(prev.date) + '.', { label: 'Undo', fn: () => undoDelete(prev) });
    } catch (e) {
      if (!ui.sheet) return;
      ui.sheet.busy = false;
      ui.sheet.confirmDelete = false;
      ui.sheet.err = writeError(e);
      renderSheet();
    }
  }

  async function undoAdd(saved) {
    try { await api('DELETE', '/api/entries/' + encodeURIComponent(saved.id)); removeLocal(saved.id); renderAll(); toast('Undone.'); }
    catch (e) { toast(writeError(e)); }
  }

  async function undoEdit(saved, prev) {
    try {
      const res = await api('PUT', '/api/entries/' + encodeURIComponent(saved.id), { loc: prev.loc, date: prev.date, note: prev.note, special: prev.special });
      upsertLocal(normalizeData({ locations: [], entries: [res.entry] }).entries[0], saved.id);
      renderAll();
      toast('Undone.');
    } catch (e) { toast(writeError(e)); }
  }

  async function undoDelete(prev) {
    try {
      const res = await api('POST', '/api/entries', { loc: prev.loc, date: prev.date, note: prev.note, special: prev.special });
      upsertLocal(normalizeData({ locations: [], entries: [res.entry] }).entries[0]);
      renderAll();
      toast('Entry restored.');
    } catch (e) { toast(writeError(e)); }
  }

  async function submitUnlock() {
    const s = ui.sheet;
    if (!s || s.busy) return;
    const key = s.key.trim();
    if (!key) { s.err = 'Enter the logging key.'; renderSheet(); return; }
    s.busy = true; s.err = ''; renderSheet();
    try {
      await api('GET', '/api/check', null, key);
      ownerKey = key;
      owner = true;
      store.set(KEY_STORE, key);
      closeSheet();
      renderAll();
      toast('Logging unlocked on this phone.');
    } catch (e) {
      if (!ui.sheet) return;
      ui.sheet.busy = false;
      ui.sheet.err = e.code === 'wrong_key' ? 'That key does not match. Check it and try again.' : writeError(e);
      renderSheet();
    }
  }

  async function saveSettings() {
    if (!settingsDirty()) return;
    const draft = ui.settings;
    for (const l of draft) {
      if (l.active && !String(l.name).trim()) { toast('Every location needs a name.'); return; }
      const t = Number(l.target);
      if (!Number.isInteger(t) || t < 1 || t > 52) { toast('Targets must be whole numbers from 1 to 52.'); return; }
    }
    const btn = $('[data-act="set-save"]');
    if (btn) btn.disabled = true;
    try {
      for (const l of draft) {
        const before = data.locations.find((x) => x.id === l.id);
        if (!before) {
          await api('POST', '/api/locations', { name: l.name.trim(), target: Number(l.target) });
        } else if (before.name !== l.name || before.target !== Number(l.target) || before.active !== l.active) {
          await api('PUT', '/api/locations/' + encodeURIComponent(l.id), { name: l.name.trim(), target: Number(l.target), active: l.active });
        }
      }
      ui.settings = null;
      await load(true);
      toast('Settings saved.');
    } catch (e) {
      toast(writeError(e));
      await load(true);
    }
  }

  async function copyBackup() {
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('Backup copied. Paste it into a note or an email to keep it.');
    } catch (e) {
      const ta = $('#backup-text');
      if (ta) { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); }
      toast('Select the text below and copy it.');
    }
  }

  /* ------------------------------------------------------------------
     Toast
     ------------------------------------------------------------------ */
  let toastTimer = null;
  function toast(message, action) {
    clearTimeout(toastTimer);
    ui.toastFn = action ? action.fn : null;
    $('#toast-root').innerHTML =
      '<div class="toast"><span>' + esc(message) + '</span>' +
      (action ? '<button type="button" data-act="toast-action">' + esc(action.label) + '</button>' : '') +
      '<button type="button" class="toast-x" data-act="toast-close" aria-label="Dismiss">×</button></div>';
    toastTimer = setTimeout(() => { $('#toast-root').innerHTML = ''; ui.toastFn = null; }, action ? 10000 : 6000);
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'sheet-backdrop') { if (ev.target === b && !(ui.sheet && ui.sheet.busy)) closeSheet(); return; }
    const s = ui.sheet;
    switch (act) {
      case 'retry': loadState = 'loading'; load(); break;
      case 'log': openEntrySheet({ loc: b.dataset.loc, date: b.dataset.date || undefined }); break;
      case 'edit': openEntrySheet({ entryId: b.dataset.id }); break;
      case 'diary-day': openEntrySheet({ date: b.dataset.date }); break;
      case 'row': {
        const id = b.dataset.loc;
        if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
        renderLocs(buildModel(data, todayStr()));
        const again = document.querySelector('[data-act="row"][data-loc="' + CSS.escape(id) + '"]');
        if (again) again.focus({ preventScroll: true });
        break;
      }
      case 'diary-prev': ui.diaryMonth = shiftMonth(ui.diaryMonth, -1); renderDiary(); $('[data-act="diary-prev"]').focus({ preventScroll: true }); break;
      case 'diary-next': if (ui.diaryMonth < todayStr().slice(0, 7)) { ui.diaryMonth = shiftMonth(ui.diaryMonth, 1); renderDiary(); $('[data-act="diary-next"]').focus({ preventScroll: true }); } break;
      case 'log-more': ui.logLimit += 20; renderLog(); break;
      case 'unlock': openSheet({ kind: 'unlock', key: '', err: '', busy: false }); break;
      case 'unlock-go': submitUnlock(); break;
      case 'lock': lockOwner('Logging locked on this phone.'); break;
      case 'sheet-close': if (!(s && s.busy)) closeSheet(); break;
      case 'sheet-prev': if (s) { s.month = shiftMonth(s.month, -1); renderSheet(); } break;
      case 'sheet-next': if (s && s.month < todayStr().slice(0, 7)) { s.month = shiftMonth(s.month, 1); renderSheet(); } break;
      case 'sheet-day': {
        if (!s) break;
        const d = b.dataset.date;
        const e = data.entries.find((x) => x.date === d);
        if (e && e.id !== s.entryId) {
          if (s.intent === 'new') {
            ui.sheet = sheetFromEntry(e, 'new');
            ui.sheet.notice = fmt(d) + ' already has ' + locName(e.loc) + '. You are editing that entry; pick another date to log a new one.';
          } else {
            s.err = fmt(d) + ' already has ' + locName(e.loc) + '. Pick another date.';
          }
        } else if (!e && s.intent === 'new' && s.mode === 'edit') {
          ui.sheet = newEntrySheet(d, '');
          ui.sheet.month = s.month;
        } else {
          s.date = d; s.err = ''; s.notice = '';
        }
        renderSheet();
        break;
      }
      case 'sheet-save': submitEntry(); break;
      case 'sheet-delete': if (s) { s.confirmDelete = true; renderSheet(); } break;
      case 'sheet-delete-no': if (s) { s.confirmDelete = false; renderSheet(); } break;
      case 'sheet-delete-yes': deleteEntry(); break;
      case 'toast-action': { const fn = ui.toastFn; $('#toast-root').innerHTML = ''; ui.toastFn = null; if (fn) fn(); break; }
      case 'toast-close': $('#toast-root').innerHTML = ''; ui.toastFn = null; break;
      case 'set-toggle': {
        if (!ui.settings) ui.settings = clone(data.locations);
        const l = ui.settings[Number(b.dataset.i)];
        if (l) l.active = !l.active;
        renderSettings();
        break;
      }
      case 'set-add': {
        const input = $('#set-new');
        const name = input ? input.value.trim() : '';
        if (!name) { toast('Type the location name first.'); break; }
        if (!ui.settings) ui.settings = clone(data.locations);
        ui.settings.push({ id: 'new-' + Date.now(), name, target: DEFAULT_TARGET, sortOrder: ui.settings.length + 1, active: true });
        renderSettings();
        break;
      }
      case 'set-discard': ui.settings = null; renderSettings(); break;
      case 'set-save': saveSettings(); break;
      case 'backup': copyBackup(); break;
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    const s = ui.sheet;
    if (s && el.id === 'sh-note') { s.note = el.value; return; }
    if (s && el.id === 'sh-occ') { s.occasion = el.value; return; }
    if (s && el.id === 'unlock-key') { s.key = el.value; return; }
    if (el.dataset && el.dataset.set) {
      if (!ui.settings) ui.settings = clone(data.locations);
      const l = ui.settings[Number(el.dataset.i)];
      if (!l) return;
      if (el.dataset.set === 'name') l.name = el.value;
      else l.target = el.value === '' ? '' : Number(el.value);
      const dirty = settingsDirty();
      const save = $('[data-act="set-save"]');
      const discard = $('[data-act="set-discard"]');
      if (save) save.disabled = !dirty;
      if (discard) discard.disabled = !dirty;
    }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    const s = ui.sheet;
    if (!s) return;
    if (el.name === 'sh-loc') { s.loc = el.value; s.err = ''; return; }
    if (el.id === 'sh-special') { s.special = el.checked; s.err = ''; s.notice = ''; renderSheet(); return; }
    if (el.id === 'sh-spdate') { s.spDate = el.value; s.err = ''; renderSheet(); }
  });

  document.addEventListener('keydown', (ev) => {
    if (!ui.sheet) return;
    if (ev.key === 'Escape' && !ui.sheet.busy) { closeSheet(); return; }
    if (ev.key === 'Enter' && ui.sheet.kind === 'unlock' && ev.target.id === 'unlock-key') { ev.preventDefault(); submitUnlock(); }
  });

  // Refresh when the phone comes back to the page, at most once a minute.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - syncedAt > 60000 && !ui.sheet) load(true);
  });

  // Re-render at midnight so "today" moves on.
  let shownDay = todayStr();
  setInterval(() => {
    const t = todayStr();
    if (t !== shownDay && !ui.sheet) { shownDay = t; renderAll(); }
  }, 60000);

  // Expose the pure logic for tests (no effect on the page).
  window.CholaLogic = { normalizeData, buildModel, buildPlan, sevaStreak, monthHD, statusFor, nthHDAfter, countHD, isHD };

  renderHeader();
  load();
  if (owner) {
    // Make sure the remembered key still works.
    api('GET', '/api/check', null, ownerKey).catch((e) => { if (e.code === 'wrong_key' || e.code === 'no_key_set') lockOwner('Logging was locked: the saved key no longer matches.'); });
  }
})();
