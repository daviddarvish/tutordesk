/* TutorDesk — אפליקציה לניהול שיעורים פרטיים (מק + אייפון)
 * הנתונים נמשכים בזמן אמת מהגיליון דרך Apps Script. שום נתון לא נשמר בשרת של האתר. */
'use strict';

const APP_VERSION = '1.0.0';
const LS = { cfg: 'td.cfg', state: 'td.state', sent: 'td.sent' };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};

const app = {
  data: null, demo: false, view: 'today', selected: null,
  filter: 'הכל', q: '', monthKey: null, loading: false, lastFetch: 0, error: '',
  fresh: null, showAllAlerts: false,
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (v) => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const money = (n) => '₪' + nf.format(Math.round(Number(n) || 0));
const plural = (n, one, many) => (n === 1 ? one : nf.format(n) + ' ' + many);

/* ---------------- dates ---------------- */
const dObj = (ymd) => new Date(ymd + 'T12:00:00');
const fmt = (ymd, opts) => (ymd ? new Intl.DateTimeFormat('he-IL', opts).format(dObj(ymd)) : '');
const weekday = (ymd) => fmt(ymd, { weekday: 'long' });
const dayMonth = (ymd) => fmt(ymd, { day: 'numeric', month: 'long' });
const shortDate = (ymd) => (ymd ? ymd.slice(8, 10) + '.' + ymd.slice(5, 7) : '');
const monthLabel = (key) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(key + '-15T12:00:00'));
const monthShort = (key) => new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(key + '-15T12:00:00'));
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d) + n * 864e5);
  return x.toISOString().slice(0, 10);
}
function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function relDay(ymd) {
  if (!ymd || !app.data) return '';
  const d = diffDays(ymd, app.data.today);
  if (d === 0) return 'היום';
  if (d === 1) return 'אתמול';
  if (d === -1) return 'מחר';
  if (d > 1) return 'לפני ' + d + ' ימים';
  return 'בעוד ' + (-d) + ' ימים';
}

/* ---------------- icons ---------------- */
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 18.5l1.3-3.6A7.8 7.8 0 1112 20a8 8 0 01-3.7-.9z"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a10 10 0 005.9 5.9l1.5-2 4 1.5v3a2 2 0 01-2.2 2A16.5 16.5 0 014.5 5.7a2 2 0 012-2.2z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5zM4 20.5A2.5 2.5 0 006.5 23H20v-5"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.5 5.8 4.3 0 1.3-1.2 2.1-3 2.1-1.4 0-2.5-.6-3-1.6M12 6v1.8M12 16.3V18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8.5 9h7M8.5 12.5h4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
};

/* ---------------- config & API ---------------- */
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}
function parseSetup(text) {
  const m = String(text || '').match(/setup=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const c = JSON.parse(b64urlDecode(m[1]));
    if (c && c.u && c.k) return { u: c.u, k: c.k, t: c.t || '' };
  } catch (e) { /* invalid */ }
  return null;
}
const cfg = () => store.get(LS.cfg);

async function api(action, payload) {
  const c = cfg();
  if (!c) throw new Error('האפליקציה לא מחוברת לגיליון');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  let res;
  try {
    res = await fetch(c.u, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ key: c.k, action }, payload || {})),
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'הגיליון לא ענה בזמן. נסה שוב.' : 'אין חיבור לגיליון. בדוק אינטרנט.');
  } finally { clearTimeout(timer); }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('תשובה לא תקינה מהגיליון. ודא שהפריסה היא Web App עם גישה ל-Anyone.'); }
  if (!data.ok) throw new Error(data.error || 'שגיאה לא ידועה');
  return data;
}

async function loadDemo() {
  const r = await fetch('demo.json', { cache: 'no-cache' });
  app.data = await r.json();
  app.demo = true;
}

async function refresh(opts) {
  opts = opts || {};
  if (app.loading) return;
  if (!cfg()) {
    if (!app.data) await loadDemo();
    render();
    return;
  }
  app.loading = true;
  setSyncing(true);
  try {
    const d = await api('state');
    app.data = d; app.demo = false; app.error = '';
    app.lastFetch = Date.now();
    store.set(LS.state, d);
  } catch (e) {
    app.error = e.message;
    if (!opts.silent) toast(e.message);
  } finally {
    app.loading = false;
    setSyncing(false);
    render();
  }
}

async function mutate(action, payload, opts) {
  opts = opts || {};
  if (app.demo) {
    toast('מצב דמו: הפעולה לא נשמרת. חבר את הגיליון בהגדרות.');
    return null;
  }
  const before = app.data;
  setSyncing(true);
  try {
    const d = await api(action, payload);
    app.data = d; app.error = ''; app.lastFetch = Date.now();
    store.set(LS.state, d);
    if (opts.after) opts.after(d, before);
    render();
    if (opts.ok) toast(typeof opts.ok === 'function' ? opts.ok(d, before) : opts.ok, opts.undo ? opts.undo(d, before) : null);
    return d;
  } catch (e) {
    toast(e.message);
    return null;
  } finally { setSyncing(false); }
}

function setSyncing(on) {
  const b = $('#refreshBtn');
  if (b) b.classList.toggle('spin', !!on);
  const t = $('#syncText');
  if (t && app.data) t.textContent = on ? 'מעדכן…' : (app.demo ? 'דמו' : 'עודכן ' + (app.data.generatedAt || '').slice(11));
}

/* ---------------- helpers on data ---------------- */
const D = () => app.data;
const studentBy = (code) => (D().students || []).find((s) => s.code === String(code));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const telHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
function waHref(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('972') !== 0) d = '972' + d.replace(/^0/, '');
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}
function sentSet() {
  const s = store.get(LS.sent) || {};
  return s[D().tomorrow] || [];
}
function markSent(code) {
  const s = store.get(LS.sent) || {};
  const key = D().tomorrow;
  const next = {}; next[key] = Array.from(new Set((s[key] || []).concat([String(code)])));
  store.set(LS.sent, next);
}

/* ---------------- render ---------------- */
const TITLES = { today: 'היום', students: 'תלמידים', money: 'כסף', settings: 'הגדרות' };

function render() {
  if (!app.data) {
    $('#view').innerHTML = '<div class="empty">טוען נתונים מהגיליון…</div>';
    return;
  }
  $$('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === app.view ? 'page' : 'false'));
  $('#title').textContent = TITLES[app.view];
  document.title = TITLES[app.view] + ' · שיעורים';
  setSyncing(app.loading);
  renderBanner();
  const v = $('#view');
  if (app.view === 'today') v.innerHTML = viewToday();
  else if (app.view === 'students') v.innerHTML = viewStudents();
  else if (app.view === 'money') { v.innerHTML = viewMoney(); bindChart(); }
  else v.innerHTML = viewSettings();
  if (sheets.length) drawSheets();
}

function renderBanner() {
  const b = $('#banner');
  if (app.demo) {
    b.innerHTML = '<div class="banner"><span>מצב דמו: נתונים לדוגמה בלבד.</span><a class="btn btn-sm btn-soft" href="#settings">חיבור הגיליון</a></div>';
  } else if (app.error) {
    b.innerHTML = '<div class="banner err"><span>' + esc(app.error) + ' מוצגים הנתונים מ-' + esc(D().generatedAt.slice(11)) + '.</span>' +
      '<button class="btn btn-sm btn-ghost" data-act="refresh">נסה שוב</button></div>';
  } else b.innerHTML = '';
}

/* ---------- today ---------- */
function viewToday() {
  const d = D();
  const ag = d.agenda;
  const alerts = d.alerts || [];
  const actionable = alerts.length;
  const done = ag.today.filter((a) => a.logged).length;

  let h = '<section class="notebook" aria-label="סיכום היום">' +
    '<div class="nb-day">' + esc(weekday(d.today)) + '</div>' +
    '<div class="nb-date">' + esc(dayMonth(d.today)) + '</div><div class="nb-stats">' +
    '<span class="pill ink"><b>' + (ag.today.length ? plural(ag.today.length, 'שיעור אחד', 'שיעורים') : 'אין שיעורים') + '</b>' +
    (ag.today.length ? ' היום' + (done ? ', ' + done + ' סומנו' : '') : ' קבועים היום') + '</span>' +
    (actionable ? '<a class="pill" href="#alerts" data-act="scroll" data-to="alerts"><b>' + actionable + '</b> לטיפול</a>' : '') +
    (d.kpi.outstanding > 0 ? '<a class="pill red" href="#money"><b>' + money(d.kpi.outstanding) + '</b> פתוח</a>' : '') +
    '</div></section>';

  // today
  h += '<section class="section"><div class="section-head"><h2>שיעורים היום</h2>' +
    '<button class="btn btn-sm btn-ghost" data-act="extraLesson">' + ICON.plus + 'שיעור נוסף</button></div><div class="list">';
  if (!ag.today.length && !ag.extraToday.length) {
    h += '<div class="empty">אין שיעורים קבועים היום. שיעור חד-פעמי נרשם דרך <b>שיעור נוסף</b>.</div>';
  }
  ag.today.forEach((a) => {
    const fresh = app.fresh === a.code;
    const cancelled = a.logged && a.lessonStatus !== 'בוצע';
    h += '<div class="row' + (a.logged ? ' is-done' : '') + '">' +
      '<div class="time' + (a.time ? '' : ' none') + '">' + esc(a.time || 'ללא שעה') + '</div>' +
      '<button class="who" data-act="open" data-code="' + esc(a.code) + '"><b>' + esc(a.name) + '</b><span>' + esc(a.subject || '') + '</span></button>' +
      '<div class="acts">' + (a.logged
        ? '<span class="done-mark' + (cancelled ? ' cancel' : '') + (fresh ? ' fresh' : '') + '">' + (cancelled ? '' : ICON.check) + esc(cancelled ? a.lessonStatus : 'בוצע') + '</span>' +
          '<button class="link-btn" data-act="unlog" data-id="' + esc(a.lessonId) + '" data-name="' + esc(a.name) + '">ביטול רישום</button>'
        : '<button class="btn btn-sm btn-primary" data-act="logDone" data-code="' + esc(a.code) + '">' + ICON.check + 'בוצע</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="cancelMenu" data-code="' + esc(a.code) + '">בוטל</button>') +
      '</div></div>';
  });
  ag.extraToday.forEach((l) => {
    h += '<div class="row is-done"><div class="time none">נוסף</div>' +
      '<button class="who" data-act="open" data-code="' + esc(l.code) + '"><b>' + esc(l.name) + '</b><span>' + esc(l.minutes) + ' דק׳, ' + money(l.price) + '</span></button>' +
      '<div class="acts"><span class="done-mark' + (l.status !== 'בוצע' ? ' cancel' : '') + '">' + (l.status === 'בוצע' ? ICON.check : '') + esc(l.status) + '</span>' +
      '<button class="link-btn" data-act="unlog" data-id="' + esc(l.id) + '" data-name="' + esc(l.name) + '">ביטול רישום</button></div></div>';
  });
  h += '</div></section>';

  // tomorrow
  const sent = sentSet();
  h += '<section class="section" id="tomorrow"><div class="section-head"><h2>מחר, ' + esc(weekday(d.tomorrow)) + '</h2>' +
    (ag.tomorrow.length ? '<span class="aside">תזכורות בוואטסאפ</span>' : '') + '</div><div class="list">';
  if (!ag.tomorrow.length) h += '<div class="empty">אין שיעורים קבועים מחר.</div>';
  ag.tomorrow.forEach((a) => {
    const isSent = sent.indexOf(a.code) >= 0;
    h += '<div class="row"><div class="time' + (a.time ? '' : ' none') + '">' + esc(a.time || 'ללא שעה') + '</div>' +
      '<button class="who" data-act="open" data-code="' + esc(a.code) + '"><b>' + esc(a.name) + '</b><span>' + esc(a.subject || '') + '</span></button><div class="acts">' +
      (a.wa
        ? (isSent ? '<span class="done-mark">' + ICON.check + 'נשלחה</span><a class="link-btn" href="' + esc(a.wa) + '" target="_blank" rel="noopener">שוב</a>'
          : '<a class="btn btn-sm btn-soft" href="' + esc(a.wa) + '" target="_blank" rel="noopener" data-act="sent" data-code="' + esc(a.code) + '">' + ICON.chat + 'תזכורת ל' + esc(a.waTo) + '</a>')
        : '<span class="muted" style="font-size:13px">אין טלפון</span>') +
      '</div></div>';
  });
  h += '</div></section>';

  // alerts
  h += '<section class="section" id="alerts"><div class="section-head"><h2>לטיפול</h2>' +
    '</div><div class="list">';
  if (!alerts.length) h += '<div class="empty">אין פולו-אפים, חובות או תלמידים שנעלמו.</div>';
  const shown = app.showAllAlerts ? alerts : alerts.slice(0, 7);
  shown.forEach((a) => {
    let acts = '';
    if (a.type === 'followup') {
      acts = (a.wa ? '<a class="btn btn-sm btn-soft" href="' + esc(a.wa) + '" target="_blank" rel="noopener">' + ICON.chat + 'הודעה</a>' : '') +
        '<button class="btn btn-sm btn-ghost" data-act="contact" data-code="' + esc(a.code) + '">תיעוד</button>';
    } else if (a.type === 'debt') {
      acts = (a.wa ? '<a class="btn btn-sm btn-red" href="' + esc(a.wa) + '" target="_blank" rel="noopener">' + ICON.chat + 'תזכורת</a>' : '') +
        '<button class="btn btn-sm btn-ghost" data-act="pay" data-code="' + esc(a.code) + '">תשלום</button>';
    } else if (a.type === 'inactive') {
      acts = (a.wa ? '<a class="btn btn-sm btn-ghost" href="' + esc(a.wa) + '" target="_blank" rel="noopener">' + ICON.chat + 'הודעה</a>' : '') +
        '<button class="btn btn-sm btn-ghost" data-act="contact" data-code="' + esc(a.code) + '">תיעוד</button>';
    } else {
      acts = '<button class="btn btn-sm btn-ghost" data-act="edit" data-code="' + esc(a.code) + '">קבע יום</button>';
    }
    h += '<div class="row"><span class="dot ' + esc(a.type) + '" aria-hidden="true"></span>' +
      '<button class="who" data-act="open" data-code="' + esc(a.code) + '"><b>' + esc(a.name) + '</b><span class="alert-text ' + esc(a.type) + '">' + esc(a.text) + '</span></button>' +
      '<div class="acts">' + acts + '</div></div>';
  });
  if (alerts.length > 7 && !app.showAllAlerts) {
    h += '<div class="row" style="min-height:48px;justify-content:center"><button class="link-btn" data-act="allAlerts">הצג את כל ' + alerts.length + '</button></div>';
  }
  h += '</div></section>';
  return h;
}

/* ---------- students ---------- */
const FILTERS = [
  ['הכל', () => true],
  ['קבוע', (s) => s.status === 'קבוע'],
  ['מזדמן', (s) => s.status === 'מזדמן'],
  ['פולו-אפ', (s) => /פולו/.test(s.status)],
  ['ליד', (s) => s.status === 'ליד'],
  ['חובות', (s) => s.balance < 0],
  ['לא פעיל', (s) => s.status === 'לא פעיל'],
];
const STATUS_ORDER = ['קבוע', 'מזדמן', 'פולו-אפ קרוב', 'ליד', 'פולו-אפ רחוק', 'לא פעיל'];

function filteredStudents() {
  const f = (FILTERS.find((x) => x[0] === app.filter) || FILTERS[0])[1];
  const q = app.q.trim().toLowerCase();
  return D().students.filter((s) => (app.filter === 'הכל' ? s.status !== 'לא פעיל' : f(s)))
    .filter((s) => !q || [s.name, s.subject, s.city, s.parent, s.phoneStudent, s.phoneParent, s.code].join(' ').toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => {
      if (app.filter === 'חובות') return a.balance - b.balance;
      const oa = STATUS_ORDER.indexOf(a.status), ob = STATUS_ORDER.indexOf(b.status);
      return (oa - ob) || a.name.localeCompare(b.name, 'he');
    });
}

function balHtml(s) {
  if (s.balance < 0) return '<span class="bal debt">חוב ' + money(-s.balance) + '</span>';
  if (s.balance > 0) return '<span class="bal credit">זכות ' + money(s.balance) + '</span>';
  return '';
}

function studentListHtml(list, wide) {
  if (!list.length) return '<div class="empty">' + (app.q ? 'לא נמצאו תלמידים לחיפוש הזה.' : 'אין תלמידים בקטגוריה הזו.') + '</div>';
  return list.map((s) => {
    const sub = [s.subject, s.city].filter(Boolean).join(', ') || (s.followup ? 'פולו-אפ ' + shortDate(s.followup) : '');
    return '<div class="row' + (wide && app.selected === s.code ? ' selected' : '') + '">' +
      '<button class="who" data-act="open" data-code="' + esc(s.code) + '"><b>' + esc(s.name) + '</b><span>' + esc(sub) + '</span></button>' +
      '<div class="stu-meta"><span class="tag s-' + esc(s.status) + '">' + esc(s.status) + '</span>' + balHtml(s) + '</div></div>';
  }).join('');
}

function viewStudents() {
  const all = D().students;
  const list = filteredStudents();
  const wide = isWide();
  let h = '<div class="split"><div>' +
    '<div class="toolbar"><input class="search" type="search" placeholder="חיפוש שם, מקצוע, עיר או טלפון" value="' + esc(app.q) + '" data-input="q" aria-label="חיפוש">' +
    '<button class="btn btn-primary" data-act="newStudent">' + ICON.plus + 'חדש</button></div><div class="chips" role="group" aria-label="סינון">';
  FILTERS.forEach(([name, fn]) => {
    const n = name === 'הכל' ? all.filter((s) => s.status !== 'לא פעיל').length : all.filter(fn).length;
    if (!n && name !== 'הכל' && name !== app.filter) return;
    h += '<button class="chip" aria-pressed="' + (app.filter === name) + '" data-act="filter" data-f="' + esc(name) + '">' + esc(name) + ' <span class="n">' + n + '</span></button>';
  });
  h += '</div><div class="list" id="stuList">' + studentListHtml(list, wide) + '</div></div>';
  if (wide) {
    const s = app.selected && studentBy(app.selected);
    h += '<aside class="pane" aria-label="פרטי תלמיד">' + (s ? detailHtml(s, false) : '<div class="pane-empty">בחר תלמיד מהרשימה</div>') + '</aside>';
  }
  return h + '</div>';
}

function detailHtml(s, inSheet) {
  const d = D();
  const bal = s.balance;
  const balCls = bal < 0 ? 'debt' : bal > 0 ? 'credit' : '';
  const sched = (s.daysArr || []).map((i) => d.dayNames[i]).join(', ');
  let h = '<div class="d-head"><div><h3 class="d-name">' + esc(s.name) + '</h3><div class="d-sub">' +
    '<span class="tag s-' + esc(s.status) + '">' + esc(s.status) + '</span><span>קוד ' + esc(s.code) + '</span>' +
    (s.lessonCount ? '<span>' + plural(s.lessonCount, 'שיעור אחד', 'שיעורים') + '</span>' : '') + '</div></div>' +
    (inSheet ? '<button class="icon-btn" data-act="closeSheet" aria-label="סגירה">' + ICON.close + '</button>' : '') + '</div>';

  h += '<div class="balance-box ' + balCls + '"><div><div class="amt">' +
    (bal < 0 ? 'חוב ' + money(-bal) : bal > 0 ? 'זכות ' + money(bal) : 'מאוזן') + '</div>' +
    '<small>' + (s.lastPayment ? 'תשלום אחרון ' + shortDate(s.lastPayment) : 'אין תשלומים רשומים') +
    (s.lastLesson ? ', שיעור אחרון ' + relDay(s.lastLesson) : '') + '</small></div>' +
    (bal < 0 && s.waPay ? '<a class="btn btn-sm btn-red" href="' + esc(s.waPay) + '" target="_blank" rel="noopener">' + ICON.chat + 'תזכורת תשלום</a>' : '') + '</div>';

  const hasWa = s.phoneParent || s.phoneStudent;
  h += '<div class="qa">' +
    '<button class="btn btn-soft" data-act="lesson" data-code="' + esc(s.code) + '">' + ICON.book + 'רישום שיעור</button>' +
    '<button class="btn btn-soft" data-act="pay" data-code="' + esc(s.code) + '">' + ICON.coin + 'רישום תשלום</button>' +
    '<button class="btn btn-soft" data-act="reach" data-how="wa" data-code="' + esc(s.code) + '"' + (hasWa ? '' : ' disabled') + '>' + ICON.chat + 'וואטסאפ</button>' +
    '<button class="btn btn-soft" data-act="reach" data-how="tel" data-code="' + esc(s.code) + '"' + (hasWa ? '' : ' disabled') + '>' + ICON.phone + 'שיחה</button></div>';

  h += '<div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="edit" data-code="' + esc(s.code) + '">' + ICON.edit + 'עריכה</button>' +
    '<button class="btn btn-ghost btn-sm" data-act="contact" data-code="' + esc(s.code) + '">' + ICON.note + 'תיעוד קשר ופולו-אפ</button></div>';

  const facts = [
    ['מקצוע', esc(s.subject)],
    ['לוח קבוע', esc([sched, s.time].filter(Boolean).join(', '))],
    ['מחיר', s.price ? money(s.price) + ' לשיעור' : ''],
    ['הורה', esc(s.parent) + (s.phoneParent ? ' <a href="' + telHref(s.phoneParent) + '" dir="ltr">' + esc(s.phoneParent) + '</a>' : '')],
    ['תלמיד', s.phoneStudent ? '<a href="' + telHref(s.phoneStudent) + '" dir="ltr">' + esc(s.phoneStudent) + '</a>' : ''],
    ['מיקום', esc([s.city, s.location].filter(Boolean).join(', '))],
    ['תשלום', esc(s.payMethod)],
    ['פולו-אפ', s.followup ? esc(shortDate(s.followup) + ' (' + relDay(s.followup) + ')') : ''],
    ['קשר אחרון', s.lastContact ? esc(relDay(s.lastContact)) : ''],
  ].filter((f) => f[1] && String(f[1]).trim());
  if (facts.length) h += '<dl class="facts">' + facts.map((f) => '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>').join('') + '</dl>';
  if (s.notes) h += '<div class="notes">' + esc(s.notes) + '</div>';

  const hist = d.lessons.filter((l) => l.code === s.code).map((l) => ({ t: 'l', x: l }))
    .concat(d.payments.filter((p) => p.code === s.code).map((p) => ({ t: 'p', x: p })))
    .sort((a, b) => (a.x.date < b.x.date ? 1 : a.x.date > b.x.date ? -1 : 0)).slice(0, 40);
  h += '<div class="section-head" style="margin-top:6px"><h2>היסטוריה</h2></div>';
  if (!hist.length) h += '<div class="list"><div class="empty">עוד אין שיעורים או תשלומים רשומים.</div></div>';
  else {
    h += '<div class="list hist">' + hist.map((e) => {
      const x = e.x;
      if (e.t === 'l') {
        return '<div class="row"><span class="h-date">' + shortDate(x.date) + '</span><span class="h-what">שיעור' +
          (x.status !== 'בוצע' ? ' <span class="muted">(' + esc(x.status) + ')</span>' : '') +
          (x.note ? ' <span class="muted">' + esc(x.note) + '</span>' : '') + '</span>' +
          '<span class="h-amt">' + (x.price ? money(x.price) : '') + '</span>' +
          '<button class="icon-btn" data-act="delLesson" data-id="' + esc(x.id) + '" aria-label="מחיקת שיעור">' + ICON.trash + '</button></div>';
      }
      return '<div class="row"><span class="h-date">' + shortDate(x.date) + '</span><span class="h-what">תשלום <span class="muted">' + esc(x.method) + '</span></span>' +
        '<span class="h-amt pay">+' + money(x.amount) + '</span>' +
        '<button class="icon-btn" data-act="delPayment" data-id="' + esc(x.id) + '" aria-label="מחיקת תשלום">' + ICON.trash + '</button></div>';
    }).join('') + '</div>';
  }
  return h;
}

/* ---------- money ---------- */
function viewMoney() {
  const d = D();
  const months = d.months;
  if (!app.monthKey || !months.some((m) => m.key === app.monthKey)) app.monthKey = months[months.length - 1].key;
  const idx = months.findIndex((m) => m.key === app.monthKey);
  const m = months[idx];
  const hours = m.minutes / 60;
  const debtors = d.students.filter((s) => s.balance < 0).sort((a, b) => a.balance - b.balance);
  const k = d.kpi;

  let h = '<div class="month-nav">' +
    '<button class="icon-btn" data-act="month" data-dir="-1" aria-label="חודש קודם"' + (idx === 0 ? ' disabled' : '') + '>' + ICON.prev + '</button>' +
    '<strong>' + esc(monthLabel(m.key)) + '</strong>' +
    '<button class="icon-btn" data-act="month" data-dir="1" aria-label="חודש הבא"' + (idx === months.length - 1 ? ' disabled' : '') + '>' + ICON.next + '</button></div>';

  h += '<div class="stats">' +
    stat('הכנסה שחויבה', money(m.billed), 'שיעורים שבוצעו וביטולים מחויבים') +
    stat('נגבה בפועל', money(m.collected), m.billed ? Math.round(m.collected / m.billed * 100) + '% מהחיוב' : '') +
    stat('שיעורים', nf.format(m.lessons), nf.format(Math.round(hours * 10) / 10) + ' שעות הוראה') +
    stat('לשעת הוראה', hours ? money(m.billed / hours) : '—', 'חיוב חלקי שעות') + '</div>';

  h += '<section class="section"><div class="section-head"><h2>12 חודשים אחרונים</h2></div><div class="chart-card">' +
    '<div class="legend"><span><i style="background:var(--chart-a)"></i>חויב</span><span><i style="background:var(--chart-b)"></i>נגבה</span></div>' +
    '<div class="chart" id="chart">' + chartSvg(months) + '</div><div class="tip" id="tip"></div>' +
    '<details class="table-view"><summary>הצג כטבלה</summary><table><thead><tr><th>חודש</th><th>שיעורים</th><th>חויב</th><th>נגבה</th></tr></thead><tbody>' +
    months.slice().reverse().map((x) => '<tr><td>' + esc(monthLabel(x.key)) + '</td><td>' + x.lessons + '</td><td>' + money(x.billed) + '</td><td>' + money(x.collected) + '</td></tr>').join('') +
    '</tbody></table></details></div></section>';

  const pct = k.target ? Math.min(100, Math.round(k.regulars / k.target * 100)) : 0;
  h += '<section class="section"><div class="card" style="margin:0"><h2>תלמידים קבועים מול היעד</h2>' +
    '<div class="progress" role="progressbar" aria-valuenow="' + k.regulars + '" aria-valuemin="0" aria-valuemax="' + k.target + '"><span style="width:' + pct + '%"></span></div>' +
    '<p style="margin:0">' + k.regulars + ' מתוך ' + k.target + '. היעד נקבע בלשונית ההגדרות בגיליון.</p></div></section>';

  h += '<section class="section"><div class="section-head"><h2>יתרות פתוחות</h2><span class="aside">' + money(k.outstanding) + ' אצל ' + plural(k.debtors, 'תלמיד אחד', 'תלמידים') + '</span></div><div class="list">';
  if (!debtors.length) h += '<div class="empty">אין חובות פתוחים.</div>';
  debtors.forEach((s) => {
    h += '<div class="row"><button class="who" data-act="open" data-code="' + esc(s.code) + '"><b>' + esc(s.name) + '</b><span>' +
      (s.lastPayment ? 'שילם לאחרונה ' + esc(relDay(s.lastPayment)) : 'אין תשלומים רשומים') + '</span></button>' +
      '<span class="bal debt">' + money(-s.balance) + '</span><div class="acts">' +
      (s.waPay ? '<a class="btn btn-sm btn-ghost" href="' + esc(s.waPay) + '" target="_blank" rel="noopener" aria-label="תזכורת בוואטסאפ ל' + esc(s.name) + '">' + ICON.chat + '</a>' : '') +
      '<button class="btn btn-sm btn-soft" data-act="pay" data-code="' + esc(s.code) + '">תשלום</button></div></div>';
  });
  return h + '</div></section>';
}

function stat(label, value, sub) {
  return '<div class="stat"><div class="l">' + esc(label) + '</div><div class="v">' + esc(value) + '</div>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
}

function kfmt(v) {
  if (v < 1000) return nf.format(v);
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(v / 1000) + 'K';
}

function niceMax(v) {
  if (v <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function chartSvg(months, width) {
  const W = Math.max(300, Math.round(width || 720)), H = 230, top = 12, bottom = 26, left = 4, right = 44;
  const max = niceMax(Math.max.apply(null, months.map((m) => Math.max(m.billed, m.collected))));
  const plotW = W - left - right, plotH = H - top - bottom;
  const gw = plotW / months.length;
  const bw = Math.min(18, (gw - 10) / 2);
  const y = (v) => top + plotH - (v / max) * plotH;
  const bar = (x, v, cls) => {
    const h = Math.max(0, (v / max) * plotH);
    if (h < 1) return '';
    const r = Math.min(4, h, bw / 2);
    const y0 = top + plotH;
    return '<path class="' + cls + '" d="M' + x + ',' + y0 + 'V' + (y0 - h + r) + 'Q' + x + ',' + (y0 - h) + ' ' + (x + r) + ',' + (y0 - h) +
      'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + (y0 - h) + ' ' + (x + bw) + ',' + (y0 - h + r) + 'V' + y0 + 'Z"/>';
  };
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="הכנסה שחויבה ונגבתה ב-12 החודשים האחרונים">';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    s += '<line class="gridline" x1="' + left + '" x2="' + (W - right) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
      '<text class="axis" x="' + (W - right + 8) + '" y="' + (y(v) + 4) + '" text-anchor="start">' + kfmt(v) + '</text>';
  }
  // oldest on the right (RTL reading order)
  months.forEach((m, i) => {
    const gx = W - right - (i + 1) * gw;
    const cx = gx + gw / 2;
    s += bar(cx + 1, m.billed, 'bar-a') + bar(cx - 1 - bw, m.collected, 'bar-b');
    if (gw >= 34 || (months.length - 1 - i) % 2 === 0) s += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(monthShort(m.key)) + '</text>';
    s += '<rect class="hit" data-i="' + i + '" x="' + gx + '" y="' + top + '" width="' + gw + '" height="' + plotH + '" rx="6"/>';
  });
  return s + '</svg>';
}

function bindChart() {
  const box = $('#chart');
  const tip = $('#tip');
  if (!box || !tip) return;
  const months = D().months;
  box.innerHTML = chartSvg(months, box.clientWidth);
  const svg = $('svg', box);
  const show = (rect) => {
    $$('.hit', svg).forEach((r) => r.classList.toggle('on', r === rect));
    const m = months[Number(rect.dataset.i)];
    tip.innerHTML = '<b>' + esc(monthLabel(m.key)) + '</b><br>חויב ' + money(m.billed) + '<br>נגבה ' + money(m.collected) + '<br>' + m.lessons + ' שיעורים';
    const card = tip.parentElement.getBoundingClientRect();
    const rr = rect.getBoundingClientRect();
    let x = card.right - (rr.left + rr.width / 2);
    x = Math.max(70, Math.min(card.width - 70, x));
    tip.style.right = x + 'px';
    tip.style.left = 'auto';
    tip.style.top = (rr.top - card.top + 8) + 'px';
    tip.style.transform = 'translate(50%, -100%)';
    tip.classList.add('on');
  };
  $$('.hit', svg).forEach((r) => {
    r.addEventListener('mouseenter', () => show(r));
    r.addEventListener('click', () => show(r));
  });
  svg.addEventListener('mouseleave', () => { tip.classList.remove('on'); $$('.hit', svg).forEach((r) => r.classList.remove('on')); });
}

/* ---------- settings ---------- */
function isStandalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }

function viewSettings() {
  const c = cfg();
  const d = D();
  let h = '';
  if (c) {
    let host = '';
    try { host = new URL(c.u).host; } catch (e) { host = c.u; }
    h += '<div class="card"><h2>מחובר לגיליון</h2><p>הנתונים נמשכים ישירות מהגיליון שלך דרך ' + esc(host) + '. עדכון אחרון: ' + esc(d.generatedAt || '') + '.</p>' +
      '<div class="row-actions" style="margin:0">' + (d.sheetUrl ? '<a class="btn btn-soft btn-sm" href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">פתיחת הגיליון</a>' : '') +
      '<button class="btn btn-ghost btn-sm" data-act="disconnect">ניתוק מהמכשיר</button></div></div>';
  } else {
    h += '<div class="card"><h2>חיבור הגיליון</h2><p>בגיליון: תפריט TutorDesk ← חיבור האפליקציה. באייפון סורקים את ה-QR, במק מעתיקים את הקישור. אפשר גם להדביק אותו כאן.</p>' +
      '<form data-form="connect"><div class="field"><input name="link" type="url" placeholder="https://…#setup=…" aria-label="קישור הגדרה" required></div>' +
      '<div class="form-actions" style="margin:0"><button class="btn btn-primary" type="submit">חיבור</button>' +
      (navigator.clipboard && navigator.clipboard.readText ? '<button class="btn btn-ghost" type="button" data-act="pasteLink">הדבקה מהלוח</button>' : '') + '</div></form></div>';
  }

  const topic = (c && c.t) || (d.settings && d.settings.topic) || '';
  h += '<div class="card"><h2>התראות לטלפון</h2><p>סיכום בוקר, תזכורת בערב לסמן שיעורים ולשלוח תזכורות למחר, וסיכום שבועי. נשלחות לאפליקציית ntfy.</p>' +
    (topic ? '<ol class="steps"><li>התקן את <b>ntfy</b> מה-App Store.</li><li>לחץ <b>+</b> והירשם לנושא:</li></ol><div class="code-line" style="margin:8px 0">' + esc(topic) + '</div>' +
      '<div class="row-actions" style="margin:0"><button class="btn btn-ghost btn-sm" data-act="copyTopic" data-topic="' + esc(topic) + '">העתקת הנושא</button>' +
      '<button class="btn btn-soft btn-sm" data-act="testNotify">שליחת התראת בדיקה</button></div>'
      : '<p>הנושא יופיע כאן אחרי החיבור לגיליון.</p>') + '</div>';

  if (!isStandalone()) {
    h += '<div class="card"><h2>התקנה כאפליקציה</h2><ol class="steps">' +
      '<li><b>אייפון:</b> ב-Safari לחץ שיתוף ← הוסף למסך הבית.</li>' +
      '<li><b>מק:</b> ב-Safari תפריט קובץ ← הוסף ל-Dock. ב-Chrome: סמל ההתקנה בשורת הכתובת.</li>' +
      '<li>אם האפליקציה המותקנת מבקשת חיבור שוב, הדבק את קישור ההגדרה פעם אחת.</li></ol></div>';
  }
  h += '<p class="muted" style="font-size:12.5px;text-align:center">TutorDesk ' + APP_VERSION + (d.version ? ', מנוע ' + esc(d.version) : '') + '</p>';
  return h;
}

/* ---------------- sheets (modals) ---------------- */
const sheets = [];
function openSheet(spec) { sheets.push(spec); drawSheets(true); }
function closeSheet() { sheets.pop(); drawSheets(true); }
function closeAllSheets() { sheets.length = 0; drawSheets(); }
function drawSheets(focus) {
  const root = $('#sheetRoot');
  if (!sheets.length) { root.innerHTML = ''; document.body.style.overflow = ''; return; }
  const top = sheets[sheets.length - 1];
  const html = top.render();
  if (html === null) { sheets.pop(); return drawSheets(focus); }
  root.innerHTML = '<div class="sheet-backdrop" data-act="backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(top.label || '') + '">' +
    '<div class="grabber"></div>' + html + '</div></div>';
  document.body.style.overflow = 'hidden';
  if (top.mount) top.mount($('.sheet', root));
  if (focus) {
    const f = $('.sheet [autofocus]', root) || $('.sheet', root);
    if (f) setTimeout(() => f.focus && f.focus({ preventScroll: true }), 30);
  }
}

function sheetHead(title) {
  return '<div class="sheet-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-act="closeSheet" type="button" aria-label="סגירה">' + ICON.close + '</button></div>';
}
function seg(name, options, value, multi) {
  const vals = multi ? (value || []).map(String) : [String(value)];
  return '<div class="seg' + (multi === 'days' ? ' days' : '') + '" data-seg="' + esc(name) + '"' + (multi ? ' data-multi="1"' : '') + '>' +
    options.map((o) => {
      const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<button type="button" data-v="' + esc(v) + '" aria-pressed="' + (vals.indexOf(String(v)) >= 0) + '">' + esc(l) + '</button>';
    }).join('') + '<input type="hidden" name="' + esc(name) + '" value="' + esc(multi ? vals.join(',') : value) + '"></div>';
}
function field(label, inner, extra) { return '<label class="field"' + (extra || '') + '><span>' + esc(label) + '</span>' + inner + '</label>'; }

function openStudent(code) {
  const s = studentBy(code);
  if (!s) return;
  app.selected = s.code;
  if (app.view === 'students' && isWide()) { render(); return; }
  openSheet({ label: s.name, render: () => { const x = studentBy(code); return x ? detailHtml(x, true) : null; } });
}

function lessonSheet(code, preset) {
  const s = studentBy(code);
  const d = D();
  openSheet({
    label: 'רישום שיעור',
    render: () => sheetHead('רישום שיעור — ' + s.name) +
      '<form data-form="lesson">' +
      field('סטטוס', seg('status', d.lessonStatuses, (preset && preset.status) || 'בוצע')) +
      '<div class="grid2">' + field('תאריך', '<input type="date" name="date" value="' + esc(d.today) + '" required>') +
      field('דקות', '<input type="number" name="minutes" inputmode="numeric" min="0" value="' + esc(d.settings.lessonMinutes) + '">') + '</div>' +
      field('מחיר (₪)', '<input type="number" name="price" inputmode="decimal" min="0" value="' + esc(s.price) + '">') +
      field('הערה', '<input type="text" name="note" placeholder="אופציונלי">') +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">שמירת שיעור</button></div></form>',
    submit: (f) => mutate('logLesson', {
      code: s.code, date: f.date, status: f.status, minutes: Number(f.minutes), price: f.status === 'בוטל' ? 0 : Number(f.price), note: f.note,
    }, { ok: 'השיעור נשמר', after: () => closeSheet() }),
  });
}

function paySheet(code) {
  const s = studentBy(code);
  const d = D();
  const def = s.balance < 0 ? -s.balance : s.price;
  openSheet({
    label: 'רישום תשלום',
    render: () => sheetHead('רישום תשלום — ' + s.name) + '<form data-form="pay">' +
      field('סכום (₪)', '<input type="number" name="amount" inputmode="decimal" min="1" value="' + esc(def) + '" required autofocus>') +
      (s.balance < 0 ? '<p class="hint">היתרה הפתוחה: ' + money(-s.balance) + '</p>' : '') +
      field('אמצעי', seg('method', d.payMethods, s.payMethod && d.payMethods.indexOf(s.payMethod) >= 0 ? s.payMethod : 'ביט')) +
      '<div class="grid2">' + field('תאריך', '<input type="date" name="date" value="' + esc(d.today) + '" required>') +
      field('הערה', '<input type="text" name="note" placeholder="אופציונלי">') + '</div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">שמירת תשלום</button></div></form>',
    submit: (f) => mutate('logPayment', { code: s.code, amount: Number(f.amount), method: f.method, date: f.date, note: f.note },
      { ok: () => 'נשמר תשלום של ' + money(f.amount), after: () => closeSheet() }),
  });
}

function contactSheet(code) {
  const s = studentBy(code);
  const d = D();
  const quick = [['', 'ללא'], ['1', 'מחר'], ['3', '3 ימים'], ['7', 'שבוע'], ['14', 'שבועיים'], ['30', 'חודש']];
  openSheet({
    label: 'תיעוד קשר',
    render: () => sheetHead('תיעוד קשר — ' + s.name) + '<form data-form="contact">' +
      field('איך', seg('kind', ['וואטסאפ', 'שיחה', 'פגישה'], 'וואטסאפ')) +
      field('מה סוכם', '<textarea name="note" placeholder="לדוגמה: ביקש לחזור אחרי המבחן" autofocus></textarea>') +
      field('פולו-אפ הבא', seg('fuQuick', quick, s.followup ? 'custom' : '7')) +
      field('או תאריך', '<input type="date" name="followup" value="' + esc(s.followup || addDays(d.today, 7)) + '">') +
      field('סטטוס', '<select name="status">' + d.statuses.map((x) => '<option' + (x === s.status ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>') +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">שמירה</button></div></form>',
    mount: (el) => {
      const q = $('[data-seg="fuQuick"]', el);
      const date = $('input[name="followup"]', el);
      q.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        date.value = b.dataset.v ? addDays(d.today, Number(b.dataset.v)) : '';
      });
      date.addEventListener('input', () => $$('button', q).forEach((b) => b.setAttribute('aria-pressed', 'false')));
    },
    submit: (f) => mutate('logContact', { code: s.code, kind: f.kind, note: f.note, followup: f.followup || '', status: f.status },
      { ok: f.followup ? 'נשמר. פולו-אפ ב-' + shortDate(f.followup) : 'נשמר', after: () => closeSheet() }),
  });
}

function studentSheet(code) {
  const d = D();
  const s = code ? studentBy(code) : null;
  const v = (k) => (s ? s[k] : '');
  openSheet({
    label: s ? 'עריכת תלמיד' : 'תלמיד חדש',
    render: () => sheetHead(s ? 'עריכה — ' + s.name : 'תלמיד או ליד חדש') + '<form data-form="student">' +
      '<div class="grid2">' + field('שם פרטי', '<input name="first" value="' + esc(v('first')) + '" required autofocus autocomplete="off">') +
      field('שם משפחה', '<input name="last" value="' + esc(v('last')) + '" autocomplete="off">') + '</div>' +
      '<div class="grid2">' + field('סטטוס', '<select name="status">' + d.statuses.map((x) => '<option' + (x === (s ? s.status : 'ליד') ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>') +
      field('מקצוע / רמה', '<input name="subject" value="' + esc(v('subject')) + '">') + '</div>' +
      field('ימים קבועים', seg('days', d.dayNames.map((n, i) => [String(i), n.slice(0, 1) + '׳']), s ? s.daysArr : [], 'days')) +
      '<div class="grid2">' + field('שעה', '<input type="time" name="time" value="' + esc(/^\d\d:\d\d$/.test(v('time')) ? v('time') : '') + '">') +
      field('מחיר לשיעור (₪)', '<input type="number" name="price" inputmode="decimal" min="0" value="' + esc(s ? s.price : d.settings.defaultPrice) + '">') + '</div>' +
      field('שם הורה', '<input name="parent" value="' + esc(v('parent')) + '">') +
      '<div class="grid2">' + field('טלפון הורה', '<input type="tel" name="phoneParent" value="' + esc(v('phoneParent')) + '">') +
      field('טלפון תלמיד', '<input type="tel" name="phoneStudent" value="' + esc(v('phoneStudent')) + '">') + '</div>' +
      '<div class="grid2">' + field('עיר', '<input name="city" value="' + esc(v('city')) + '">') +
      field('כתובת / מיקום', '<input name="location" value="' + esc(v('location')) + '">') + '</div>' +
      '<div class="grid2">' + field('אמצעי תשלום', '<select name="payMethod"><option value=""></option>' + d.payMethods.map((x) => '<option' + (x === v('payMethod') ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>') +
      field('יתרת פתיחה (₪)', '<input type="number" name="openingBalance" inputmode="decimal" value="' + esc(s ? s.opening : 0) + '">') + '</div>' +
      '<p class="hint">יתרת פתיחה: מספר חיובי הוא זכות, שלילי הוא חוב מלפני המערכת.</p>' +
      field('פולו-אפ הבא', '<input type="date" name="followup" value="' + esc(v('followup')) + '">') +
      field('הערות', '<textarea name="notes">' + esc(v('notes')) + '</textarea>') +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">' + (s ? 'שמירת שינויים' : 'הוספה') + '</button></div></form>',
    submit: (f) => {
      const st = {
        first: f.first, last: f.last, status: f.status, subject: f.subject,
        days: f.days ? f.days.split(',').filter(String).map(Number) : [], time: f.time, price: f.price,
        parent: f.parent, phoneParent: f.phoneParent, phoneStudent: f.phoneStudent, city: f.city, location: f.location,
        payMethod: f.payMethod, openingBalance: Number(f.openingBalance) || 0, followup: f.followup, notes: f.notes,
      };
      if (s) st.code = s.code;
      return mutate('saveStudent', { student: st }, {
        ok: s ? 'השינויים נשמרו' : 'נוסף: ' + (f.first + ' ' + f.last).trim(),
        after: (nd) => { closeSheet(); if (!s && nd.savedCode) setTimeout(() => openStudent(nd.savedCode), 50); },
      });
    },
  });
}

function pickStudentSheet() {
  let q = '';
  const listHtml = () => {
    const items = D().students.filter((s) => s.status !== 'לא פעיל')
      .filter((s) => !q || (s.name + ' ' + s.subject).toLowerCase().indexOf(q.toLowerCase()) >= 0)
      .sort((a, b) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || a.name.localeCompare(b.name, 'he')).slice(0, 40);
    return items.map((s) => '<div class="row"><button class="who" data-act="pickLesson" data-code="' + esc(s.code) + '"><b>' + esc(s.name) + '</b><span>' +
      esc([s.status, s.subject].filter(Boolean).join(', ')) + '</span></button></div>').join('') || '<div class="empty">לא נמצא</div>';
  };
  openSheet({
    label: 'שיעור נוסף',
    render: () => sheetHead('שיעור נוסף — למי?') + '<input class="search" type="search" placeholder="חיפוש" autofocus data-pick="1" style="width:100%;margin-bottom:10px">' +
      '<div class="list" id="pickList">' + listHtml() + '</div>',
    mount: (el) => {
      const inp = $('[data-pick]', el);
      inp.value = q;
      inp.addEventListener('input', () => { q = inp.value; $('#pickList', el).innerHTML = listHtml(); });
    },
  });
}

function choiceSheet(title, options, text) {
  openSheet({
    label: title,
    render: () => sheetHead(title) + (text ? '<p class="muted" style="margin:-4px 0 14px">' + esc(text) + '</p>' : '') +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      options.map((o, i) => (o.href
        ? '<a class="btn btn-block ' + (o.cls || 'btn-soft') + '" href="' + esc(o.href) + '"' + (o.blank ? ' target="_blank" rel="noopener"' : '') + ' data-act="choice" data-i="' + i + '">' + esc(o.label) + '</a>'
        : '<button class="btn btn-block ' + (o.cls || 'btn-soft') + '" data-act="choice" data-i="' + i + '">' + esc(o.label) + '</button>')).join('') +
      '<button class="btn btn-block btn-ghost" data-act="closeSheet">ביטול</button></div>',
    options: options,
  });
}

function confirmSheet(title, text, label, onYes) {
  choiceSheet(title, [{ label: label, cls: 'btn-red', run: onYes }], text);
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button">ביטול</button>' : '');
  if (undo) $('button', t).onclick = () => { t.classList.remove('on'); undo(); };
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), undo ? 6000 : 3200);
}

/* ---------------- actions ---------------- */
function newLessonId(d, before, code) {
  const old = new Set((before && before.lessons || []).map((l) => l.id));
  const n = d.lessons.find((l) => l.code === code && !old.has(l.id));
  return n ? n.id : '';
}

function logToday(code, status) {
  const s = studentBy(code);
  return mutate('logLesson', { code: code, status: status || 'בוצע', dedupe: true }, {
    after: () => { app.fresh = status && status !== 'בוצע' ? null : code; setTimeout(() => { app.fresh = null; }, 800); },
    ok: () => (status === 'בוטל - מחויב' ? firstName(s.name) + ': בוטל עם חיוב'
      : status === 'בוטל' ? firstName(s.name) + ': בוטל בלי חיוב' : 'נרשם שיעור ל' + firstName(s.name)),
    undo: (d, before) => {
      const id = newLessonId(d, before, code);
      return id ? () => mutate('deleteLesson', { id: id }, { ok: 'הרישום בוטל' }) : null;
    },
  });
}

const ACTIONS = {
  refresh: () => refresh(),
  open: (el) => openStudent(el.dataset.code),
  closeSheet: () => closeSheet(),
  backdrop: (el, e) => { if (e.target === el) closeSheet(); },
  logDone: (el) => { el.classList.add('busy'); logToday(el.dataset.code); },
  cancelMenu: (el) => {
    const code = el.dataset.code;
    choiceSheet('השיעור של ' + firstName(studentBy(code).name) + ' בוטל', [
      { label: 'בוטל — לחייב', run: () => { closeAllSheets(); logToday(code, 'בוטל - מחויב'); } },
      { label: 'בוטל — בלי חיוב', run: () => { closeAllSheets(); logToday(code, 'בוטל'); } },
    ]);
  },
  unlog: (el) => {
    const id = el.dataset.id;
    confirmSheet('ביטול הרישום', 'השיעור של ' + el.dataset.name + ' יימחק מלשונית השיעורים.', 'מחיקת הרישום', () => {
      closeAllSheets(); mutate('deleteLesson', { id: id }, { ok: 'הרישום נמחק' });
    });
  },
  choice: (el, e) => {
    const top = sheets[sheets.length - 1];
    const o = top && top.options && top.options[Number(el.dataset.i)];
    if (!o) return;
    if (o.href) { if (o.after) o.after(); setTimeout(closeSheet, 300); return; }
    e.preventDefault();
    o.run();
  },
  sent: (el) => { markSent(el.dataset.code); setTimeout(render, 400); },
  extraLesson: () => pickStudentSheet(),
  pickLesson: (el) => { closeSheet(); lessonSheet(el.dataset.code); },
  lesson: (el) => lessonSheet(el.dataset.code),
  pay: (el) => paySheet(el.dataset.code),
  contact: (el) => contactSheet(el.dataset.code),
  edit: (el) => studentSheet(el.dataset.code),
  newStudent: () => studentSheet(null),
  reach: (el) => {
    const s = studentBy(el.dataset.code);
    const how = el.dataset.how;
    const opts = [];
    const add = (who, phone) => {
      if (!phone) return;
      opts.push(how === 'wa'
        ? { label: 'וואטסאפ ל' + who, href: waHref(phone, ''), blank: true }
        : { label: 'שיחה ל' + who + ' (' + phone + ')', href: telHref(phone) });
    };
    add('הורה' + (s.parent ? ' — ' + firstName(s.parent) : ''), s.phoneParent);
    add('תלמיד — ' + firstName(s.name), s.phoneStudent);
    if (opts.length === 1) { window.open(opts[0].href, how === 'wa' ? '_blank' : '_self'); return; }
    choiceSheet(how === 'wa' ? 'וואטסאפ' : 'שיחה', opts);
  },
  delLesson: (el) => confirmSheet('מחיקת שיעור', 'השיעור יימחק מלשונית השיעורים והיתרה תתעדכן.', 'מחיקה', () => {
    closeSheet(); mutate('deleteLesson', { id: el.dataset.id }, { ok: 'השיעור נמחק' });
  }),
  delPayment: (el) => confirmSheet('מחיקת תשלום', 'התשלום יימחק מלשונית התשלומים והיתרה תתעדכן.', 'מחיקה', () => {
    closeSheet(); mutate('deletePayment', { id: el.dataset.id }, { ok: 'התשלום נמחק' });
  }),
  filter: (el) => { app.filter = el.dataset.f; render(); },
  allAlerts: () => { app.showAllAlerts = true; render(); },
  month: (el) => {
    const ms = D().months;
    const i = ms.findIndex((m) => m.key === app.monthKey) + Number(el.dataset.dir);
    if (i >= 0 && i < ms.length) { app.monthKey = ms[i].key; render(); }
  },
  scroll: (el, e) => { e.preventDefault(); const t = document.getElementById(el.dataset.to); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  disconnect: () => confirmSheet('ניתוק המכשיר', 'הקישור למנוע יימחק מהמכשיר הזה בלבד. הגיליון לא משתנה.', 'ניתוק', () => {
    store.del(LS.cfg); store.del(LS.state); app.data = null; closeAllSheets(); refresh();
  }),
  copyTopic: async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.topic); toast('הנושא הועתק'); } catch (e) { toast('לא ניתן להעתיק. סמן את הטקסט והעתק ידנית.'); }
  },
  testNotify: () => mutate('testNotify', {}, { ok: (d) => (d.notifyOk ? 'נשלחה התראת בדיקה. בדוק את ntfy.' : 'השליחה נכשלה. בדוק את הנושא בהגדרות.') }),
  pasteLink: async () => {
    try {
      const t = await navigator.clipboard.readText();
      const inp = $('form[data-form="connect"] input[name="link"]');
      if (inp) inp.value = t;
      connectWith(t);
    } catch (e) { toast('אין גישה ללוח. הדבק ידנית בשדה.'); }
  },
};

async function connectWith(text) {
  const c = parseSetup(text);
  if (!c) { toast('הקישור לא תקין. העתק אותו שוב מהגיליון.'); return; }
  store.set(LS.cfg, c);
  toast('מתחבר לגיליון…');
  try {
    await api('ping');
    app.data = null; app.demo = false;
    await refresh();
    toast('מחובר ✓');
    location.hash = '#today';
  } catch (e) {
    store.del(LS.cfg);
    toast('החיבור נכשל: ' + e.message);
  }
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && !['scroll', 'choice'].includes(el.dataset.act) && el.getAttribute('href') && el.getAttribute('href')[0] !== '#') {
    fn(el, e); // external link keeps its default navigation
    return;
  }
  if (el.tagName === 'A' && el.dataset.act === 'choice') { fn(el, e); return; }
  if (el.dataset.act !== 'backdrop') e.preventDefault();
  fn(el, e);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  const g = b.parentElement;
  const hidden = $('input[type="hidden"]', g);
  if (g.dataset.multi) {
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    hidden.value = $$('button', g).filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.v).join(',');
  } else {
    $$('button', g).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    hidden.value = b.dataset.v;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v.trim() : v; });
  if (form.dataset.form === 'connect') { connectWith(data.link); return; }
  const top = sheets[sheets.length - 1];
  if (!top || !top.submit) return;
  const btn = $('button[type="submit"]', form);
  if (btn) btn.classList.add('busy');
  try { await top.submit(data); } finally { if (btn) btn.classList.remove('busy'); }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.input === 'q') {
    app.q = el.value;
    const box = $('#stuList');
    if (box) box.innerHTML = studentListHtml(filteredStudents(), isWide());
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheets.length) closeSheet(); });

function isWide() { return window.matchMedia('(min-width: 900px)').matches; }
let wasWide = isWide();
let resizeTimer = null;
window.addEventListener('resize', () => {
  const w = isWide();
  if (w !== wasWide) { wasWide = w; render(); return; }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (app.view === 'money' && app.data) bindChart(); }, 150);
});

/* ---------------- routing ---------------- */
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (/setup=/.test(h)) {
    const c = parseSetup(h);
    history.replaceState(null, '', location.pathname + location.search + '#today');
    if (c) { connectWith('#setup=' + h.split('setup=')[1]); }
    else toast('קישור ההגדרה לא תקין');
    app.view = 'today';
    render();
    return;
  }
  const m = h.match(/^s=(.+)$/);
  if (m) {
    app.view = 'students';
    render();
    if (app.data) openStudent(m[1]);
    return;
  }
  const view = h === 'tomorrow' || h === 'alerts' ? 'today' : (TITLES[h] ? h : 'today');
  if (view !== app.view) closeAllSheets();
  app.view = view;
  render();
  window.scrollTo(0, 0);
  if (h === 'tomorrow' || h === 'alerts') {
    const t = document.getElementById(h);
    if (t) setTimeout(() => t.scrollIntoView({ block: 'start' }), 60);
  }
}
window.addEventListener('hashchange', route);

/* ---------------- boot ---------------- */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cfg() && Date.now() - app.lastFetch > 60000) refresh({ silent: true });
});
setInterval(() => {
  if (document.visibilityState === 'visible' && cfg() && Date.now() - app.lastFetch > 300000) refresh({ silent: true });
}, 60000);

(async function boot() {
  const cached = cfg() ? store.get(LS.state) : null;
  if (cached && cached.students) app.data = cached;
  else if (!cfg()) await loadDemo();
  route();
  if (cfg() && !/setup=/.test(location.hash)) refresh({ silent: !!cached });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  }
})();
