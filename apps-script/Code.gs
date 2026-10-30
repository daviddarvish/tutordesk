/**
 * TutorDesk — מנוע ניהול שיעורים פרטיים
 * ------------------------------------------------------------
 * רץ בתוך הגיליון "שיעורים פרטיים" (Extensions → Apps Script).
 * - מוסיף לשוניות מסודרות: תלמידים, שיעורים, תשלומים, יומן, הגדרות
 * - מעביר נתונים מהלשונית הקיימת "ניהול תלמידים" בלי לשנות אותה
 * - חושף API מאובטח במפתח לאפליקציה (מק + אייפון)
 * - שולח התראות ל-ntfy: סיכום בוקר, בדיקת ערב, סיכום שבועי
 */

const VERSION = '1.0.0';
const TZ = 'Asia/Jerusalem';
const DEFAULT_APP_URL = 'https://daviddarvish.github.io/tutordesk/';
const SOURCE_SHEET = 'ניהול תלמידים';

const SH = {
  students: 'תלמידים',
  lessons: 'שיעורים',
  payments: 'תשלומים',
  log: 'יומן',
  settings: 'הגדרות',
};

const STATUSES = ['קבוע', 'מזדמן', 'פולו-אפ קרוב', 'פולו-אפ רחוק', 'ליד', 'לא פעיל'];
const LESSON_STATUSES = ['בוצע', 'בוטל - מחויב', 'בוטל'];
const PAY_METHODS = ['מזומן', 'ביט', 'פייבוקס', 'העברה בנקאית', 'צ׳ק', 'אחר'];
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const COLS = {
  students: [
    ['code', 'קוד'], ['first', 'שם פרטי'], ['last', 'שם משפחה'], ['status', 'סטטוס'],
    ['subject', 'מקצוע / רמה'], ['city', 'עיר'], ['location', 'כתובת / מיקום'],
    ['parent', 'שם הורה'], ['phoneStudent', 'טלפון תלמיד'], ['phoneParent', 'טלפון הורה'],
    ['days', 'ימים'], ['time', 'שעה'], ['frequency', 'תדירות'], ['perWeek', 'שיעורים בשבוע'],
    ['price', 'מחיר לשיעור'], ['payMethod', 'אמצעי תשלום'],
    ['openingBalance', 'יתרת פתיחה (+זכות / -חוב)'], ['followup', 'פולו-אפ הבא'],
    ['lastContact', 'קשר אחרון'], ['notes', 'הערות'], ['created', 'נוצר'], ['updated', 'עודכן'],
  ],
  lessons: [
    ['id', 'מזהה'], ['date', 'תאריך'], ['code', 'קוד תלמיד'], ['name', 'שם'], ['minutes', 'דקות'],
    ['price', 'מחיר'], ['status', 'סטטוס'], ['note', 'הערה'], ['logged', 'נרשם'],
  ],
  payments: [
    ['id', 'מזהה'], ['date', 'תאריך'], ['code', 'קוד תלמיד'], ['name', 'שם'], ['amount', 'סכום'],
    ['method', 'אמצעי'], ['note', 'הערה'], ['logged', 'נרשם'],
  ],
  log: [['ts', 'זמן'], ['code', 'קוד תלמיד'], ['name', 'שם'], ['action', 'פעולה'], ['details', 'פרטים']],
};

// [מפתח, שם בעברית, ערך ברירת מחדל, הסבר]
const SETTINGS_DEFAULTS = [
  ['teacherName', 'שם המורה', 'דוד', 'מופיע בהודעות לתלמידים'],
  ['defaultPrice', 'מחיר ברירת מחדל', '200', '₪ לשיעור, לתלמיד בלי מחיר'],
  ['lessonMinutes', 'משך שיעור', '40', 'דקות'],
  ['targetRegulars', 'יעד תלמידים קבועים', '40', ''],
  ['debtThreshold', 'סף חוב להתראה', '400', '₪'],
  ['inactiveDays', 'ימים בלי שיעור עד התראה', '14', 'לתלמידים קבועים'],
  ['morningHour', 'שעת סיכום בוקר', '7', '0-23'],
  ['eveningHour', 'שעת בדיקת ערב', '20', '0-23'],
  ['weeklyDay', 'יום סיכום שבועי', 'ראשון', 'נשלח עם סיכום הבוקר'],
  ['notifications', 'התראות פעילות', 'כן', 'כן / לא'],
  ['appUrl', 'כתובת האפליקציה', DEFAULT_APP_URL, 'לחיצה על התראה פותחת אותה'],
  ['reminderTemplate', 'תבנית תזכורת לשיעור',
    'היי {שם}, תזכורת לשיעור {מקצוע} מחר, יום {יום}{בשעה}. נתראה! {מורה}', 'משתנים: {שם} {הורה} {מקצוע} {יום} {בשעה} {מורה}'],
  ['paymentTemplate', 'תבנית תזכורת תשלום',
    'היי {הורה}, תזכורת קטנה: יש יתרה פתוחה של ₪{סכום} עבור השיעורים של {שם}. אפשר בביט או במזומן בשיעור הבא. תודה! {מורה}', 'משתנים: {שם} {הורה} {סכום} {מורה}'],
  ['followupTemplate', 'תבנית פולו-אפ',
    'היי {שם}, מה שלומך? רציתי לבדוק איך הולך ב{מקצוע} ואם מתאים לקבוע שיעור השבוע. {מורה}', 'משתנים: {שם} {הורה} {מקצוע} {מורה}'],
];

/* ============================================================
 * תפריט בגיליון
 * ============================================================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎓 TutorDesk')
    .addItem('1. התקנה', 'setup')
    .addItem('2. העברת נתונים מ"ניהול תלמידים"', 'migrate')
    .addSeparator()
    .addItem('חיבור האפליקציה (קישור + QR)', 'showConnection')
    .addItem('שליחת התראת בדיקה', 'testNotification')
    .addItem('הרצת בדיקות בוקר וערב עכשיו', 'runChecksNow')
    .addToUi();
}

/* ============================================================
 * התקנה
 * ============================================================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const p = props_();
  p.setProperty('SS_ID', ss.getId());

  ['students', 'lessons', 'payments', 'log'].forEach(function (kind) { ensureSheet_(ss, kind); });
  ensureSettingsSheet_(ss);
  formatSheets_(ss);

  if (!p.getProperty('API_KEY')) p.setProperty('API_KEY', randomToken_(32));
  if (!p.getProperty('NTFY_TOPIC')) p.setProperty('NTFY_TOPIC', 'tutordesk-' + randomToken_(12).toLowerCase());

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hourlyTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hourlyTick').timeBased().everyHours(1).create();

  const warnings = [];
  if (ss.getSpreadsheetTimeZone() !== TZ) {
    warnings.push('אזור הזמן של הגיליון הוא ' + ss.getSpreadsheetTimeZone() +
      '. מומלץ לשנות ל-Asia/Jerusalem: קובץ ← הגדרות.');
  }
  uiAlert_('TutorDesk הותקן ✓',
    'נוצרו הלשוניות: תלמידים, שיעורים, תשלומים, יומן, הגדרות.\n' +
    'נקבעה בדיקה אוטומטית כל שעה.\n\n' +
    'הצעד הבא: 🎓 TutorDesk ← 2. העברת נתונים.' +
    (warnings.length ? '\n\n⚠️ ' + warnings.join('\n⚠️ ') : ''));
}

function ensureSheet_(ss, kind) {
  let sh = ss.getSheetByName(SH[kind]);
  const labels = COLS[kind].map(function (c) { return c[1]; });
  if (!sh) {
    sh = ss.insertSheet(SH[kind]);
    sh.getRange(1, 1, 1, labels.length).setValues([labels]);
    return sh;
  }
  // לשונית קיימת: מוסיפים רק עמודות חסרות בסוף, בלי לגעת בקיים
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = labels.filter(function (l) { return headers.indexOf(l) < 0; });
  if (missing.length) {
    const start = headers.filter(function (h) { return h !== ''; }).length ? lastCol + 1 : 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  return sh;
}

function ensureSettingsSheet_(ss) {
  let sh = ss.getSheetByName(SH.settings);
  if (!sh) {
    sh = ss.insertSheet(SH.settings);
    sh.getRange(1, 1, 1, 4).setValues([['מפתח', 'הגדרה', 'ערך', 'הסבר']]);
  }
  const last = sh.getLastRow();
  const existing = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const rows = SETTINGS_DEFAULTS.filter(function (d) { return existing.indexOf(d[0]) < 0; });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  return sh;
}

function formatSheets_(ss) {
  const all = ['students', 'lessons', 'payments', 'log'];
  all.forEach(function (kind) {
    const sh = ss.getSheetByName(SH[kind]);
    sh.setRightToLeft(true);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#e8eef7');
  });
  const st = ss.getSheetByName(SH.settings);
  st.setRightToLeft(true);
  st.setFrozenRows(1);
  st.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#e8eef7');
  st.setColumnWidth(2, 180);
  st.setColumnWidth(3, 420);
  st.setColumnWidth(4, 300);

  const listRule = function (list) {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  };
  const colOf = function (sh, kind, key) {
    const idx = headerIdx_(sh, kind).idx[key];
    return idx >= 0 ? idx + 1 : 0;
  };
  const stu = ss.getSheetByName(SH.students);
  let c = colOf(stu, 'students', 'status');
  if (c) stu.getRange(2, c, 999, 1).setDataValidation(listRule(STATUSES));
  ['followup', 'lastContact'].forEach(function (k) {
    const col = colOf(stu, 'students', k);
    if (col) stu.getRange(2, col, 999, 1).setNumberFormat('dd/mm/yyyy');
  });
  ['phoneStudent', 'phoneParent'].forEach(function (k) {
    const col = colOf(stu, 'students', k);
    if (col) stu.getRange(2, col, 999, 1).setNumberFormat('@');
  });
  const les = ss.getSheetByName(SH.lessons);
  c = colOf(les, 'lessons', 'status');
  if (c) les.getRange(2, c, 999, 1).setDataValidation(listRule(LESSON_STATUSES));
  c = colOf(les, 'lessons', 'date');
  if (c) les.getRange(2, c, 999, 1).setNumberFormat('dd/mm/yyyy');
  const pay = ss.getSheetByName(SH.payments);
  c = colOf(pay, 'payments', 'method');
  if (c) pay.getRange(2, c, 999, 1).setDataValidation(listRule(PAY_METHODS));
  c = colOf(pay, 'payments', 'date');
  if (c) pay.getRange(2, c, 999, 1).setNumberFormat('dd/mm/yyyy');
}

/* ============================================================
 * העברת נתונים מהלשונית הקיימת
 * ============================================================ */

function migrate() {
  const report = migrateCore_(false);
  if (report.blocked) {
    uiAlert_('ההעברה כבר בוצעה', 'בלשונית "תלמידים" כבר יש ' + report.existing +
      ' תלמידים. כדי לא ליצור כפילויות ההעברה לא רצה שוב.\n' +
      'אם צריך להריץ מחדש: מחק את השורות בלשונית "תלמידים" (חוץ מהכותרת) והרץ שוב.');
    return;
  }
  uiAlert_('ההעברה הושלמה ✓', report.text);
}

function migrateCore_(force) {
  const ss = ss_();
  const src = ss.getSheetByName(SOURCE_SHEET);
  if (!src) throw new Error('לא נמצאה לשונית "' + SOURCE_SHEET + '"');
  const existing = readTable_('students');
  if (existing.length && !force) return { blocked: true, existing: existing.length };

  const S = getSettings_();
  const rows = src.getDataRange().getDisplayValues();
  const sectionRules = [
    [/פולו\s*-?\s*אפ\s*קרוב/, 'פולו-אפ קרוב'],
    [/פולו\s*-?\s*אפ\s*רחוק/, 'פולו-אפ רחוק'],
    [/מזדמנ/, 'מזדמן'],
    [/קבועי/, 'קבוע'],
    [/לא\s*פעיל/, 'לא פעיל'],
    [/לידים/, 'ליד'],
  ];
  const headerRules = [
    ['num', /^מס/], ['code', /קוד/], ['last', /משפחה/], ['parentPhone', /טל.*(אמא|אבא|הורה)/],
    ['studentPhone', /טל.*תלמיד/], ['parent', /הורה/], ['first', /שם/], ['city', /^עיר/],
    ['location', /כתובת/], ['subject', /מקצוע/], ['days', /^יום|^ימים/], ['time', /^שעה/],
    ['notes', /הערות/], ['payMethod', /^תשלום/], ['frequency', /תדירות/], ['perWeek', /כמות/],
    ['balance', /יתרה/], ['price', /מחיר/], ['srcStatus', /סטטוס/],
  ];

  let status = 'קבוע';
  let map = null;
  const out = [];
  let skipped = 0;
  const balances = [];
  const now = new Date();

  rows.forEach(function (r) {
    const cells = r.map(function (v) { return String(v).trim(); });
    const filled = cells.filter(function (v) { return v !== ''; });
    if (!filled.length) return;

    // שורת כותרות
    if (filled.length >= 5 && cells.some(function (v) { return /שם/.test(v); }) &&
        cells.some(function (v) { return /טל|עיר|מקצוע/.test(v); })) {
      map = {};
      cells.forEach(function (h, j) {
        if (!h) return;
        for (let i = 0; i < headerRules.length; i++) {
          const key = headerRules[i][0];
          if (headerRules[i][1].test(h) && map[key] === undefined) { map[key] = j; break; }
        }
      });
      return;
    }

    // שורת כותרת מקטע
    if (filled.length <= 3) {
      const joined = filled.join(' ');
      for (let i = 0; i < sectionRules.length; i++) {
        if (sectionRules[i][0].test(joined)) { status = sectionRules[i][1]; return; }
      }
    }

    if (!map) return;
    const get = function (k) { return map[k] === undefined ? '' : (cells[map[k]] || ''); };
    let first = get('first');
    let last = get('last');
    if (!first && !last) { skipped++; return; }
    if (!last && /\s/.test(first)) {
      const sp = first.indexOf(' ');
      last = first.slice(sp + 1).trim();
      first = first.slice(0, sp).trim();
    }

    let notes = get('notes');
    const srcStatus = get('srcStatus');
    if (srcStatus) notes = (notes ? notes + ' · ' : '') + 'סטטוס במקור: ' + srcStatus;
    const rawCode = get('code');
    if (rawCode && !/^\d+$/.test(rawCode)) notes = (notes ? notes + ' · ' : '') + 'קוד במקור: ' + rawCode;

    const balText = get('balance');
    let opening = 0;
    if (balText) {
      const n = parseMoney_(balText);
      if (/זכות/.test(balText)) opening = Math.abs(n);
      else if (/חוב/.test(balText)) opening = -Math.abs(n);
      else opening = n ? -n : 0; // לפי הכותרת המקורית "חובה/זכות (+/-)": חיובי = חוב
      if (opening !== 0) balances.push((first + ' ' + last).trim() + ': ' + (opening < 0 ? 'חוב ₪' + (-opening) : 'זכות ₪' + opening));
    }

    const daysArr = parseDays_(get('days'));
    out.push({
      code: /^\d+$/.test(rawCode) ? rawCode : '',
      first: first, last: last, status: status,
      subject: get('subject'), city: get('city'), location: get('location'),
      parent: get('parent'), phoneStudent: normPhone_(get('studentPhone')), phoneParent: normPhone_(get('parentPhone')),
      days: daysArr.length ? daysArr.map(function (d) { return DAY_NAMES[d]; }).join(', ') : get('days'),
      time: parseTime_(get('time')) || get('time'),
      frequency: get('frequency'), perWeek: get('perWeek'),
      price: parseMoney_(get('price')) || S.defaultPrice,
      payMethod: mapPayMethod_(get('payMethod')),
      openingBalance: opening, notes: notes, created: now, updated: now,
    });
  });

  // קודים: שומרים קודים מספריים ייחודיים, ממלאים חסרים/כפולים
  const used = {};
  let maxCode = 100;
  out.forEach(function (s) { if (s.code) maxCode = Math.max(maxCode, Number(s.code)); });
  out.forEach(function (s) {
    if (!s.code || used[s.code]) s.code = String(++maxCode);
    used[s.code] = true;
  });

  const sh = sheet_(SH.students);
  const hi = headerIdx_(sh, 'students');
  if (out.length) {
    const matrix = out.map(function (o) { return rowFromObj_(hi, o); });
    sh.getRange(sh.getLastRow() + 1, 1, matrix.length, hi.width).setValues(matrix);
  }
  appendLog_('', '', 'העברת נתונים', out.length + ' תלמידים מהלשונית "' + SOURCE_SHEET + '"');
  props_().setProperty('MIGRATED_DATE', todayStr_());

  const counts = {};
  out.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });
  const lines = Object.keys(counts).map(function (k) { return '• ' + k + ': ' + counts[k]; });
  const text = 'הועברו ' + out.length + ' תלמידים ללשונית "תלמידים":\n' + lines.join('\n') +
    (skipped ? '\n\nדולגו ' + skipped + ' שורות בלי שם.' : '') +
    (balances.length ? '\n\nיתרות פתיחה (לבדוק שהכיוון נכון):\n' + balances.join('\n') : '') +
    '\n\nהלשונית "' + SOURCE_SHEET + '" לא שונתה.\n' +
    'כדאי לעבור על "ימים", "שעה" ו"מחיר לשיעור" אצל הקבועים — מהם נבנה לוח היום.';
  return { blocked: false, count: out.length, counts: counts, balances: balances, skipped: skipped, text: text };
}

/* ============================================================
 * Web App API
 * ============================================================ */

function doGet() {
  return ContentService.createTextOutput('TutorDesk API ' + VERSION + ' פעיל. השתמש באפליקציה.');
}

function doPost(e) {
  let res;
  const lock = LockService.getScriptLock();
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const key = props_().getProperty('API_KEY');
    if (!key || !req.key || !safeEqual_(String(req.key), key)) {
      res = { ok: false, error: 'מפתח גישה שגוי', code: 'AUTH' };
    } else {
      lock.waitLock(25000);
      res = api_(req);
    }
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function api_(req) {
  ensureKeys_();
  switch (req.action) {
    case 'ping': return { ok: true, version: VERSION };
    case 'state': return buildState_();
    case 'saveStudent': {
      const code = saveStudent_(req.student || {});
      const st = buildState_();
      st.savedCode = code;
      return st;
    }
    case 'logLesson': logLesson_(req); break;
    case 'deleteLesson': deleteById_('lessons', req.id, 'מחיקת שיעור'); break;
    case 'logPayment': logPayment_(req); break;
    case 'deletePayment': deleteById_('payments', req.id, 'מחיקת תשלום'); break;
    case 'logContact': logContact_(req); break;
    case 'testNotify': {
      const ok = notify_('בדיקה מ-TutorDesk ✓', 'ההתראות מחוברות. לחיצה פותחת את האפליקציה.', { tags: ['white_check_mark'], hash: 'today' });
      const st = buildState_();
      st.notifyOk = ok;
      return st;
    }
    default: throw new Error('פעולה לא מוכרת: ' + req.action);
  }
  return buildState_();
}

/* ============================================================
 * פעולות
 * ============================================================ */

const STUDENT_FIELDS = ['first', 'last', 'status', 'subject', 'city', 'location', 'parent', 'phoneStudent',
  'phoneParent', 'days', 'time', 'frequency', 'perWeek', 'price', 'payMethod', 'openingBalance', 'followup', 'notes'];

function saveStudent_(st) {
  const first = String(st.first || '').trim();
  const last = String(st.last || '').trim();
  if (!first && !last) throw new Error('חסר שם');
  if (st.status && STATUSES.indexOf(st.status) < 0) throw new Error('סטטוס לא תקין');

  const clean = {};
  STUDENT_FIELDS.forEach(function (k) { if (st[k] !== undefined) clean[k] = st[k]; });
  clean.first = first;
  clean.last = last;
  if (clean.phoneStudent !== undefined) clean.phoneStudent = normPhone_(clean.phoneStudent);
  if (clean.phoneParent !== undefined) clean.phoneParent = normPhone_(clean.phoneParent);
  if (Array.isArray(clean.days)) clean.days = clean.days.map(function (d) { return DAY_NAMES[d]; }).join(', ');
  if (clean.time !== undefined) clean.time = parseTime_(clean.time) || String(clean.time || '');
  if (clean.price !== undefined) clean.price = parseMoney_(clean.price) || '';
  if (clean.openingBalance !== undefined) clean.openingBalance = Number(clean.openingBalance) || 0;
  if (clean.followup !== undefined) clean.followup = clean.followup ? toDate_(dstr_(clean.followup)) : '';
  clean.updated = new Date();

  const students = readTable_('students');
  const name = (first + ' ' + last).trim();
  if (st.code) {
    const ex = students.filter(function (s) { return String(s.code) === String(st.code); })[0];
    if (!ex) throw new Error('תלמיד לא נמצא: ' + st.code);
    updateObj_('students', ex._row, clean);
    appendLog_(st.code, name, 'עדכון תלמיד', '');
    return String(st.code);
  }
  const code = String(nextCode_(students));
  clean.code = code;
  clean.status = clean.status || 'ליד';
  clean.created = new Date();
  appendObj_('students', clean);
  appendLog_(code, name, 'תלמיד חדש', clean.status);
  return code;
}

function logLesson_(req) {
  const S = getSettings_();
  const st = findStudent_(req.code);
  const date = dstr_(req.date) || todayStr_();
  const status = LESSON_STATUSES.indexOf(req.status) >= 0 ? req.status : 'בוצע';
  if (req.dedupe) {
    const dup = readTable_('lessons').some(function (l) {
      return String(l.code) === String(st.code) && dstr_(l.date) === date && String(l.status || 'בוצע') !== 'בוטל';
    });
    if (dup) return;
  }
  const price = req.price !== undefined && req.price !== '' ? Number(req.price) : (parseMoney_(st.price) || S.defaultPrice);
  const lesson = {
    id: 'L' + Utilities.getUuid().slice(0, 8),
    date: toDate_(date), code: String(st.code), name: fullName_(st),
    minutes: Number(req.minutes) || S.lessonMinutes,
    price: status === 'בוטל' ? 0 : price,
    status: status, note: req.note || '', logged: new Date(),
  };
  appendObj_('lessons', lesson);
  appendLog_(st.code, lesson.name, 'שיעור: ' + status, date + ' · ₪' + lesson.price);
}

function logPayment_(req) {
  const st = findStudent_(req.code);
  const amount = Number(req.amount);
  if (!(amount > 0)) throw new Error('סכום לא תקין');
  const date = dstr_(req.date) || todayStr_();
  const pay = {
    id: 'P' + Utilities.getUuid().slice(0, 8),
    date: toDate_(date), code: String(st.code), name: fullName_(st), amount: amount,
    method: PAY_METHODS.indexOf(req.method) >= 0 ? req.method : (req.method || 'אחר'),
    note: req.note || '', logged: new Date(),
  };
  appendObj_('payments', pay);
  appendLog_(st.code, pay.name, 'תשלום', '₪' + amount + ' · ' + pay.method);
}

function logContact_(req) {
  const st = findStudent_(req.code);
  const patch = { lastContact: toDate_(todayStr_()), updated: new Date() };
  if (req.followup !== undefined) patch.followup = req.followup ? toDate_(dstr_(req.followup)) : '';
  if (req.status && STATUSES.indexOf(req.status) >= 0) patch.status = req.status;
  if (req.note) {
    const stamp = Utilities.formatDate(new Date(), TZ, 'dd/MM');
    patch.notes = (st.notes ? String(st.notes) + '\n' : '') + stamp + ': ' + req.note;
  }
  updateObj_('students', st._row, patch);
  appendLog_(st.code, fullName_(st), 'קשר: ' + (req.kind || 'הודעה'),
    [req.note, patch.status ? 'סטטוס ← ' + patch.status : '', req.followup ? 'פולו-אפ ' + dstr_(req.followup) : '']
      .filter(String).join(' · '));
}

function deleteById_(kind, id, label) {
  if (!id) throw new Error('חסר מזהה');
  const rows = readTable_(kind);
  const r = rows.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!r) throw new Error('הרשומה לא נמצאה');
  sheet_(SH[kind]).deleteRow(r._row);
  appendLog_(r.code, r.name, label, dstr_(r.date) + ' · ₪' + (r.price || r.amount || 0));
}

/* ============================================================
 * מצב מחושב (משמש גם את האפליקציה וגם את ההתראות)
 * ============================================================ */

function buildState_() {
  const S = getSettings_();
  const today = todayStr_();
  const tomorrow = addDays_(today, 1);
  const students = readTable_('students').map(normStudent_);
  const lessons = readTable_('lessons').map(function (l) {
    return {
      id: String(l.id), date: dstr_(l.date), code: String(l.code).trim(), name: String(l.name || ''),
      minutes: Number(l.minutes) || 0, price: parseMoney_(l.price), status: String(l.status || 'בוצע'), note: String(l.note || ''),
    };
  }).filter(function (l) { return l.date; });
  const payments = readTable_('payments').map(function (p) {
    return {
      id: String(p.id), date: dstr_(p.date), code: String(p.code).trim(), name: String(p.name || ''),
      amount: parseMoney_(p.amount), method: String(p.method || ''), note: String(p.note || ''),
    };
  }).filter(function (p) { return p.date; });

  const byCode = {};
  students.forEach(function (s) { byCode[s.code] = s; });
  lessons.forEach(function (l) {
    const s = byCode[l.code];
    if (!s) return;
    if (l.status !== 'בוטל') s.charged += l.price;
    if (l.status === 'בוצע') {
      s.lessonCount++;
      if (l.date > s.lastLesson) s.lastLesson = l.date;
    }
  });
  payments.forEach(function (p) {
    const s = byCode[p.code];
    if (!s) return;
    s.paid += p.amount;
    if (p.date > s.lastPayment) s.lastPayment = p.date;
  });

  students.forEach(function (s) {
    s.balance = round2_(s.opening + s.paid - s.charged);
    const ref = s.lastLesson || s.created || today;
    s.daysSince = Math.max(0, diffDays_(ref, today));
    s.waStudent = waLink_(s.phoneStudent, '');
    s.waParent = waLink_(s.phoneParent, '');
    s.waPay = s.balance < 0 ? waLink_(s.phoneParent || s.phoneStudent,
      fillTemplate_(S.paymentTemplate, s, S, { amount: fmtNum_(-s.balance) })) : '';
    s.waFollow = waLink_(s.phoneStudent || s.phoneParent, fillTemplate_(S.followupTemplate, s, S, {}));
  });

  // סדר יום
  const regs = students.filter(function (s) { return s.status === 'קבוע'; });
  const scheduled = function (date) {
    const dow = dowOf_(date);
    return regs.filter(function (s) { return s.daysArr.indexOf(dow) >= 0; })
      .sort(function (a, b) { return (a.time || '99') < (b.time || '99') ? -1 : 1; });
  };
  const todayLessons = lessons.filter(function (l) { return l.date === today; });
  const agendaToday = scheduled(today).map(function (s) {
    const done = todayLessons.filter(function (l) { return l.code === s.code; })[0];
    return { code: s.code, name: s.name, time: s.time, subject: s.subject, price: s.price,
      logged: !!done, lessonId: done ? done.id : '', lessonStatus: done ? done.status : '' };
  });
  const scheduledCodes = agendaToday.map(function (a) { return a.code; });
  const extraToday = todayLessons.filter(function (l) { return scheduledCodes.indexOf(l.code) < 0; });
  const agendaTomorrow = scheduled(tomorrow).map(function (s) {
    const to = s.phoneParent || s.phoneStudent;
    return { code: s.code, name: s.name, time: s.time, subject: s.subject,
      wa: waLink_(to, fillTemplate_(S.reminderTemplate, s, S, { day: DAY_NAMES[dowOf_(tomorrow)] })),
      waTo: s.phoneParent ? 'הורה' : (s.phoneStudent ? 'תלמיד' : '') };
  });

  // התראות
  const alerts = [];
  students.forEach(function (s) {
    if (s.followup && s.followup <= today && s.status !== 'לא פעיל') {
      alerts.push({ type: 'followup', code: s.code, name: s.name, prio: 1,
        text: 'פולו-אפ' + (s.followup < today ? ' (באיחור ' + diffDays_(s.followup, today) + ' ימים)' : ' להיום'),
        wa: waLink_(s.phoneStudent || s.phoneParent, fillTemplate_(S.followupTemplate, s, S, {})) });
    }
    if (s.balance <= -S.debtThreshold) {
      alerts.push({ type: 'debt', code: s.code, name: s.name, prio: 2, amount: -s.balance,
        text: 'חוב ₪' + fmtNum_(-s.balance),
        wa: waLink_(s.phoneParent || s.phoneStudent, fillTemplate_(S.paymentTemplate, s, S, { amount: fmtNum_(-s.balance) })) });
    }
    if (s.status === 'קבוע' && s.daysSince >= S.inactiveDays) {
      alerts.push({ type: 'inactive', code: s.code, name: s.name, prio: 3,
        text: s.lastLesson ? s.daysSince + ' ימים בלי שיעור' : 'אין שיעור רשום מאז ההעברה',
        wa: waLink_(s.phoneParent || s.phoneStudent, '') });
    }
    if (s.status === 'קבוע' && !s.daysArr.length) {
      alerts.push({ type: 'noSchedule', code: s.code, name: s.name, prio: 4, text: 'קבוע בלי יום שיעור — לא יופיע בלוח' });
    }
  });
  alerts.sort(function (a, b) { return a.prio - b.prio || (b.amount || 0) - (a.amount || 0); });

  // חודשים
  const monthKey = today.slice(0, 7);
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths_(monthKey, -i));
  const mAgg = {};
  months.forEach(function (k) { mAgg[k] = { key: k, lessons: 0, minutes: 0, billed: 0, collected: 0 }; });
  lessons.forEach(function (l) {
    const m = mAgg[l.date.slice(0, 7)];
    if (!m) return;
    if (l.status !== 'בוטל') m.billed += l.price;
    if (l.status === 'בוצע') { m.lessons++; m.minutes += l.minutes; }
  });
  payments.forEach(function (p) {
    const m = mAgg[p.date.slice(0, 7)];
    if (m) m.collected += p.amount;
  });
  const monthsArr = months.map(function (k) { return mAgg[k]; });
  const cur = mAgg[monthKey];
  const outstanding = students.reduce(function (a, s) { return a + (s.balance < 0 ? -s.balance : 0); }, 0);
  const debtors = students.filter(function (s) { return s.balance < 0; }).length;

  const cutoff = addDays_(today, -400);
  const sortDesc = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; };

  return {
    ok: true, version: VERSION,
    generatedAt: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
    sheetUrl: sheetUrl_(),
    today: today, tomorrow: tomorrow, todayDow: dowOf_(today),
    settings: {
      teacherName: S.teacherName, defaultPrice: S.defaultPrice, lessonMinutes: S.lessonMinutes,
      targetRegulars: S.targetRegulars, debtThreshold: S.debtThreshold, inactiveDays: S.inactiveDays,
      notifications: S.notifications, topic: props_().getProperty('NTFY_TOPIC') || '',
    },
    statuses: STATUSES, lessonStatuses: LESSON_STATUSES, payMethods: PAY_METHODS, dayNames: DAY_NAMES,
    students: students.map(publicStudent_),
    lessons: lessons.filter(function (l) { return l.date >= cutoff; }).sort(sortDesc),
    payments: payments.filter(function (p) { return p.date >= cutoff; }).sort(sortDesc),
    agenda: { today: agendaToday, tomorrow: agendaTomorrow, extraToday: extraToday },
    alerts: alerts,
    kpi: {
      regulars: regs.length, target: S.targetRegulars, monthKey: monthKey,
      month: { lessons: cur.lessons, minutes: cur.minutes, billed: cur.billed, collected: cur.collected,
        hourly: cur.minutes ? Math.round(cur.billed / (cur.minutes / 60)) : 0 },
      outstanding: round2_(outstanding), debtors: debtors,
    },
    months: monthsArr,
  };
}

function normStudent_(s) {
  const S = getSettings_();
  const first = String(s.first || '').trim();
  const last = String(s.last || '').trim();
  const daysArr = parseDays_(s.days);
  return {
    code: String(s.code).trim(), first: first, last: last, name: (first + ' ' + last).trim(),
    status: STATUSES.indexOf(String(s.status)) >= 0 ? String(s.status) : (s.status ? String(s.status) : 'ליד'),
    subject: String(s.subject || ''), city: String(s.city || ''), location: String(s.location || ''),
    parent: String(s.parent || ''), phoneStudent: normPhone_(s.phoneStudent), phoneParent: normPhone_(s.phoneParent),
    days: String(s.days || ''), daysArr: daysArr, time: parseTime_(s.time) || String(s.time || ''),
    frequency: String(s.frequency || ''), perWeek: String(s.perWeek || ''),
    price: parseMoney_(s.price) || S.defaultPrice, payMethod: String(s.payMethod || ''),
    opening: parseMoney_(s.openingBalance), followup: dstr_(s.followup), lastContact: dstr_(s.lastContact),
    notes: String(s.notes || ''), created: dstr_(s.created),
    charged: 0, paid: 0, lessonCount: 0, lastLesson: '', lastPayment: '',
  };
}

function publicStudent_(s) { return s; }

function sheetUrl_() {
  try { return ss_().getUrl(); } catch (e) { return ''; }
}

/* ============================================================
 * התראות (ntfy)
 * ============================================================ */

function hourlyTick() {
  const S = getSettings_();
  if (String(S.notifications).trim() === 'לא') return;
  const p = props_();
  const hour = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  const today = todayStr_();
  const inWindow = function (h) { return hour >= h && hour < h + 3; };

  if (inWindow(S.morningHour) && p.getProperty('LAST_MORNING') !== today) {
    if (morningDigest_()) p.setProperty('LAST_MORNING', today);
  }
  if (inWindow(S.morningHour) && DAY_NAMES[dowOf_(today)] === String(S.weeklyDay).trim() &&
      p.getProperty('LAST_WEEKLY') !== today) {
    if (weeklySummary_()) p.setProperty('LAST_WEEKLY', today);
  }
  if (inWindow(S.eveningHour) && p.getProperty('LAST_EVENING') !== today) {
    if (eveningCheck_()) p.setProperty('LAST_EVENING', today);
  }
}

function runChecksNow() {
  const a = morningDigest_();
  const b = eveningCheck_();
  const c = weeklySummary_();
  uiAlert_('בדיקות התראה', 'בוקר ' + yn_(a) + '   ערב ' + yn_(b) + '   שבועי ' + yn_(c) +
    '\n(כשאין מה לדווח, לא נשלחת התראה)');
}

function testNotification() {
  const ok = notify_('בדיקה מ-TutorDesk ✓', 'ההתראות מחוברות. לחיצה פותחת את האפליקציה.', { tags: ['white_check_mark'], hash: 'today' });
  uiAlert_('התראת בדיקה', ok ? 'ההתראה נשלחה ✓ — בדוק את אפליקציית ntfy.' :
    'השליחה נכשלה. בדוק שההתקנה בוצעה ושיש חיבור לרשת.');
}

/** מחזיר true אם נשלח או שאין מה לשלוח (כדי לא לנסות שוב), false אם השליחה נכשלה */
function morningDigest_() {
  const st = buildState_();
  const lines = [];
  if (st.agenda.today.length) {
    lines.push('📅 היום ' + lessonsWord_(st.agenda.today.length) + ': ' +
      st.agenda.today.map(function (a) { return (a.time ? a.time + ' ' : '') + a.name; }).join(' · '));
  }
  const fu = st.alerts.filter(function (a) { return a.type === 'followup'; });
  if (fu.length) lines.push('📞 פולו-אפ (' + fu.length + '): ' + names_(fu, 4));
  const debts = st.alerts.filter(function (a) { return a.type === 'debt'; });
  if (debts.length) {
    const sum = debts.reduce(function (x, a) { return x + a.amount; }, 0);
    lines.push('💰 חובות מעל הסף: ₪' + fmtNum_(sum) + ' — ' + names_(debts, 3));
  }
  const ina = st.alerts.filter(function (a) { return a.type === 'inactive'; });
  if (ina.length) lines.push('⏸ קבועים בלי שיעור: ' + names_(ina, 4));
  if (!lines.length) return true;
  const actions = [];
  if (fu.length === 1 && fu[0].wa) actions.push({ action: 'view', label: 'וואטסאפ ל' + firstName_(fu[0].name), url: fu[0].wa });
  return notify_('בוקר טוב — ' + (st.agenda.today.length ? lessonsWord_(st.agenda.today.length) + ' היום' : 'אין שיעורים קבועים היום'),
    lines.join('\n'), { tags: ['sunrise'], hash: 'today', actions: actions });
}

function eveningCheck_() {
  const st = buildState_();
  let ok = true;
  const open = st.agenda.today.filter(function (a) { return !a.logged; });
  if (open.length) {
    ok = notify_((open.length === 1 ? 'לא סומן שיעור אחד' : 'לא סומנו ' + open.length + ' שיעורים') + ' מהיום', 'סמן בוצע/בוטל כדי שהיתרות וההכנסה יהיו מדויקים:\n' +
      names_(open, 8), { tags: ['pencil2'], hash: 'today' }) && ok;
  }
  const tm = st.agenda.tomorrow;
  if (tm.length) {
    const actions = tm.length <= 3 ? tm.filter(function (a) { return a.wa; }).map(function (a) {
      return { action: 'view', label: 'תזכורת ל' + firstName_(a.name), url: a.wa };
    }) : [];
    ok = notify_('מחר ' + lessonsWord_(tm.length) + ' — ' + (tm.length === 1 ? 'שלח תזכורת' : 'שלח תזכורות'),
      tm.map(function (a) { return (a.time ? a.time + ' ' : '') + a.name + (a.wa ? '' : ' (אין טלפון)'); }).join('\n') +
      (tm.length > 3 ? '\nלחיצה פותחת את רשימת התזכורות.' : ''),
      { tags: ['alarm_clock'], hash: 'tomorrow', actions: actions }) && ok;
  }
  return ok;
}

function weeklySummary_() {
  const st = buildState_();
  const from = addDays_(st.today, -7);
  const les = st.lessons.filter(function (l) { return l.date >= from && l.date < st.today; });
  const done = les.filter(function (l) { return l.status === 'בוצע'; });
  const billed = les.reduce(function (a, l) { return a + (l.status !== 'בוטל' ? l.price : 0); }, 0);
  const minutes = done.reduce(function (a, l) { return a + l.minutes; }, 0);
  const collected = st.payments.filter(function (p) { return p.date >= from && p.date < st.today; })
    .reduce(function (a, p) { return a + p.amount; }, 0);
  const migrated = props_().getProperty('MIGRATED_DATE') || '';
  const fresh = st.students.filter(function (s) { return s.created && s.created >= from && s.created !== migrated; }).length;
  const msg = [
    '📚 ' + lessonsWord_(done.length) + ' · ' + fmtNum_(Math.round(minutes / 6) / 10) + ' שעות',
    '🧾 חויב ₪' + fmtNum_(billed) + ' · נגבה ₪' + fmtNum_(collected),
    '💰 יתרות פתוחות: ₪' + fmtNum_(st.kpi.outstanding) + ' (' + st.kpi.debtors + ' תלמידים)',
    '🎯 קבועים: ' + st.kpi.regulars + ' / ' + st.kpi.target + (fresh ? ' · ' + fresh + ' חדשים השבוע' : ''),
  ].join('\n');
  return notify_('סיכום שבועי', msg, { tags: ['bar_chart'], hash: 'money' });
}

function notify_(title, message, opts) {
  opts = opts || {};
  const topic = props_().getProperty('NTFY_TOPIC');
  if (!topic) return false;
  const S = getSettings_();
  const payload = { topic: topic, title: title, message: message, tags: opts.tags || [], priority: opts.priority || 3 };
  if (S.appUrl) payload.click = String(S.appUrl) + (opts.hash ? '#' + opts.hash : '');
  if (opts.actions && opts.actions.length) payload.actions = opts.actions.slice(0, 3).map(function (a) {
    return { action: 'view', label: a.label, url: a.url, clear: true };
  });
  try {
    const r = UrlFetchApp.fetch('https://ntfy.sh/', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    return r.getResponseCode() === 200;
  } catch (e) {
    console.error('ntfy: ' + e);
    return false;
  }
}

/* ============================================================
 * חיבור האפליקציה
 * ============================================================ */

function showConnection() {
  const p = props_();
  const S = getSettings_();
  let url = p.getProperty('WEBAPP_URL') || '';
  if (!url) {
    try {
      const u = ScriptApp.getService().getUrl();
      if (u && /\/exec$/.test(u)) url = u;
    } catch (e) {}
  }
  const t = HtmlService.createTemplate(CONNECT_HTML);
  t.data = JSON.stringify({ url: url, key: p.getProperty('API_KEY') || '', topic: p.getProperty('NTFY_TOPIC') || '', appUrl: S.appUrl });
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(460).setHeight(640), 'חיבור האפליקציה');
}

function saveWebAppUrl(url) {
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(String(url))) throw new Error('כתובת לא תקינה — צריכה להסתיים ב-/exec');
  props_().setProperty('WEBAPP_URL', url);
  return true;
}

const CONNECT_HTML = [
  '<!doctype html><html dir="rtl"><head><meta charset="utf-8">',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>',
  '<style>body{font-family:Arial,sans-serif;font-size:14px;color:#1f2937;margin:0;padding:4px 2px}',
  'label{font-weight:bold;display:block;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:8px;font-size:13px;direction:ltr;border:1px solid #cbd5e1;border-radius:6px}',
  'button{background:#1d4ed8;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer;margin-top:8px}',
  '.muted{color:#64748b;font-size:12px}.box{background:#f1f5f9;border-radius:8px;padding:10px;margin-top:10px}',
  '#qr{display:flex;justify-content:center;margin:10px 0}code{direction:ltr;display:inline-block}</style></head><body>',
  '<label>כתובת ה-Web App (מסתיימת ב-/exec)</label>',
  '<input id="url" placeholder="https://script.google.com/macros/s/.../exec">',
  '<div class="muted">פריסה ← ניהול פריסות ← העתק את כתובת ה-Web App</div>',
  '<button onclick="build()">צור קישור הגדרה</button>',
  '<div id="out" style="display:none"><div id="qr"></div>',
  '<div class="muted" style="text-align:center">סרוק במצלמת האייפון. במק: העתק ופתח בדפדפן.</div>',
  '<input id="link" readonly onclick="this.select()"><button onclick="copyLink()">העתק קישור</button></div>',
  '<div class="box"><b>התראות ntfy</b><br>באפליקציית ntfy: ➕ ← הירשם לנושא:<br><code id="topic"></code>',
  '<div class="muted">הקישור מכיל את מפתח הגישה. אל תשתף אותו.</div></div>',
  '<script>var D=<?!= data ?>;',
  'document.getElementById("url").value=D.url;document.getElementById("topic").textContent=D.topic;',
  'function b64(s){return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}',
  'function build(){var u=document.getElementById("url").value.trim();',
  'if(!/^https:\\/\\/script\\.google\\.com\\/.+\\/exec$/.test(u)){alert("הכתובת צריכה להתחיל ב-https://script.google.com ולהסתיים ב-/exec");return;}',
  'google.script.run.saveWebAppUrl(u);',
  'var link=D.appUrl.replace(/#.*$/,"")+"#setup="+b64(JSON.stringify({u:u,k:D.key,t:D.topic}));',
  'document.getElementById("link").value=link;var q=qrcode(0,"M");q.addData(link);q.make();',
  'document.getElementById("qr").innerHTML=q.createSvgTag({cellSize:4,margin:2});document.getElementById("out").style.display="block";}',
  'function copyLink(){var i=document.getElementById("link");i.select();document.execCommand("copy");}',
  'if(D.url)build();</script></body></html>',
].join('\n');

/* ============================================================
 * עזרי גיליון
 * ============================================================ */

function props_() { return PropertiesService.getScriptProperties(); }

/** הודעה בגיליון; כשמריצים מעורך הסקריפט, ההודעה נכתבת ליומן ההרצה */
function uiAlert_(title, msg) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (e) {
    console.log(title + '\n' + msg);
  }
}

function ss_() {
  const id = props_().getProperty('SS_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('חסרה הלשונית "' + name + '". הרץ 🎓 TutorDesk ← 1. התקנה');
  return s;
}

function headerIdx_(sh, kind) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const idx = {};
  COLS[kind].forEach(function (c) { idx[c[0]] = headers.indexOf(c[1]); });
  return { idx: idx, width: lastCol, headers: headers };
}

function readTable_(kind) {
  const sh = sheet_(SH[kind]);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const hi = headerIdx_(sh, kind);
  const vals = sh.getRange(2, 1, last - 1, hi.width).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    const o = { _row: i + 2 };
    let any = false;
    Object.keys(hi.idx).forEach(function (k) {
      const j = hi.idx[k];
      o[k] = j >= 0 ? r[j] : '';
      if (o[k] !== '' && o[k] !== null) any = true;
    });
    if (any) out.push(o);
  });
  return out;
}

function rowFromObj_(hi, obj) {
  const row = [];
  for (let i = 0; i < hi.width; i++) row.push('');
  Object.keys(hi.idx).forEach(function (k) {
    if (hi.idx[k] >= 0 && obj[k] !== undefined && obj[k] !== null) row[hi.idx[k]] = obj[k];
  });
  return row;
}

function appendObj_(kind, obj) {
  const sh = sheet_(SH[kind]);
  const hi = headerIdx_(sh, kind);
  sh.getRange(sh.getLastRow() + 1, 1, 1, hi.width).setValues([rowFromObj_(hi, obj)]);
}

function updateObj_(kind, rowNum, patch) {
  const sh = sheet_(SH[kind]);
  const hi = headerIdx_(sh, kind);
  Object.keys(patch).forEach(function (k) {
    if (hi.idx[k] >= 0) sh.getRange(rowNum, hi.idx[k] + 1).setValue(patch[k]);
  });
}

function appendLog_(code, name, action, details) {
  try {
    appendObj_('log', { ts: new Date(), code: code || '', name: name || '', action: action, details: details || '' });
  } catch (e) { console.error(e); }
}

/** משלים קודים לתלמידים ומזהים לשיעורים/תשלומים שנוספו ידנית בגיליון */
function ensureKeys_() {
  const students = readTable_('students');
  let next = nextCode_(students);
  students.forEach(function (s) {
    if (!String(s.code).trim() && (String(s.first).trim() || String(s.last).trim())) {
      updateObj_('students', s._row, { code: String(next++), created: s.created || new Date() });
    }
  });
  [['lessons', 'L'], ['payments', 'P']].forEach(function (kp) {
    readTable_(kp[0]).forEach(function (r) {
      if (!String(r.id).trim() && String(r.code).trim()) {
        updateObj_(kp[0], r._row, { id: kp[1] + Utilities.getUuid().slice(0, 8) });
      }
    });
  });
}

function nextCode_(students) {
  let max = 100;
  students.forEach(function (s) {
    const n = Number(String(s.code).trim());
    if (n > max) max = n;
  });
  return max + 1;
}

function findStudent_(code) {
  const s = readTable_('students').filter(function (x) { return String(x.code).trim() === String(code).trim(); })[0];
  if (!s) throw new Error('תלמיד לא נמצא: ' + code);
  return s;
}

let SETTINGS_MEMO = null;

function getSettings_() {
  if (SETTINGS_MEMO) return SETTINGS_MEMO;
  const out = {};
  SETTINGS_DEFAULTS.forEach(function (d) { out[d[0]] = d[2]; });
  try {
    const sh = ss_().getSheetByName(SH.settings);
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
        const k = String(r[0]).trim();
        if (k && String(r[2]).trim() !== '') out[k] = String(r[2]).trim();
      });
    }
  } catch (e) {}
  ['defaultPrice', 'lessonMinutes', 'targetRegulars', 'debtThreshold', 'inactiveDays', 'morningHour', 'eveningHour']
    .forEach(function (k) {
      const def = Number(SETTINGS_DEFAULTS.filter(function (d) { return d[0] === k; })[0][2]);
      const n = Number(out[k]);
      out[k] = isFinite(n) && String(out[k]) !== '' ? n : def;
    });
  SETTINGS_MEMO = out;
  return out;
}

/* ============================================================
 * עזרי טקסט, תאריכים, כסף
 * ============================================================ */

function pad_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function toDate_(str) { return str ? Utilities.parseDate(str, TZ, 'yyyy-MM-dd') : ''; }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function dstr_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  return '';
}

function ymd_(str) { return str.split('-').map(Number); }
function addDays_(str, n) {
  const p = ymd_(str);
  const x = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 864e5);
  return x.getUTCFullYear() + '-' + pad_(x.getUTCMonth() + 1) + '-' + pad_(x.getUTCDate());
}
function addMonths_(key, n) {
  const p = key.split('-').map(Number);
  const t = p[0] * 12 + (p[1] - 1) + n;
  return Math.floor(t / 12) + '-' + pad_(t % 12 + 1);
}
function dowOf_(str) { const p = ymd_(str); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
function diffDays_(a, b) {
  const pa = ymd_(a), pb = ymd_(b);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5);
}

function parseDays_(text) {
  if (Array.isArray(text)) return text.map(Number).filter(function (n) { return n >= 0 && n <= 6; });
  const s = ' ' + String(text || '') + ' ';
  const found = [];
  DAY_NAMES.forEach(function (name, i) {
    if (new RegExp('(^|[^\\u05D0-\\u05EA])ו?' + name + '(?![\\u05D0-\\u05EA])').test(s)) found.push(i);
  });
  const letters = { 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5, 'ש': 6 };
  const re = /(^|[^א-ת])ו?([אבגדהוש])\s*['׳’]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const d = letters[m[2]];
    if (found.indexOf(d) < 0) found.push(d);
  }
  return found.sort();
}

function parseTime_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'HH:mm');
  const s = String(v);
  let m = s.match(/(\d{1,2})[:.](\d{2})/);
  if (m && Number(m[1]) < 24) return pad_(m[1]) + ':' + m[2];
  m = s.match(/(^|\D)(\d{1,2})(\D|$)/);
  if (m && Number(m[2]) >= 7 && Number(m[2]) <= 23) return pad_(m[2]) + ':00';
  return '';
}

function parseMoney_(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function mapPayMethod_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^מ['׳]?$|מזומן/.test(s)) return 'מזומן';
  if (/^ב['׳]?$|ביט/.test(s)) return 'ביט';
  if (/^פ['׳]?$|פייבוקס/.test(s)) return 'פייבוקס';
  if (/העברה/.test(s)) return 'העברה בנקאית';
  return s;
}

function normPhone_(v) {
  const raw = String(v === undefined || v === null ? '' : v).trim();
  if (!raw) return '';
  let d = raw.replace(/[^\d]/g, '');
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (/^5\d{8}$/.test(d)) d = '0' + d;
  if (/^05\d{8}$/.test(d)) return d.slice(0, 3) + '-' + d.slice(3);
  if (/^0[2-9]\d{7}$/.test(d)) return d.slice(0, 2) + '-' + d.slice(2);
  return raw;
}

function waLink_(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('972') !== 0) d = d.indexOf('0') === 0 ? '972' + d.slice(1) : '972' + d;
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}

function fillTemplate_(tpl, s, S, extra) {
  extra = extra || {};
  return String(tpl || '')
    .replace(/\{שם\}/g, s.first || s.name || '')
    .replace(/\{הורה\}/g, firstName_(s.parent) || s.first || '')
    .replace(/\{מקצוע\}/g, s.subject || '')
    .replace(/\{יום\}/g, extra.day || '')
    .replace(/\{בשעה\}/g, s.time ? ' בשעה ' + s.time : '')
    .replace(/\{סכום\}/g, extra.amount || '')
    .replace(/\{מורה\}/g, S.teacherName || '')
    .replace(/\s{2,}/g, ' ').trim();
}

function fullName_(s) { return (String(s.first || '') + ' ' + String(s.last || '')).trim(); }
function firstName_(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function names_(arr, max) {
  const n = arr.slice(0, max).map(function (a) { return a.name; }).join(', ');
  return arr.length > max ? n + ' ועוד ' + (arr.length - max) : n;
}
function fmtNum_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function round2_(n) { return Math.round(n * 100) / 100; }
function yn_(b) { return b ? '✓' : '✗'; }
function lessonsWord_(n) { return n === 1 ? 'שיעור אחד' : n + ' שיעורים'; }

function randomToken_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
