// Builds a mock Google environment running Code.gs, seeded with synthetic (fake) students and ~4 months of history
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createEnv, Utilities } = require('./gas-mock');

const TZ = 'Asia/Jerusalem';
const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function buildSeededEnv() {
  const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
  const env = createEnv();
  const ctx = vm.createContext(env);
  vm.runInContext(code, ctx, { filename: 'Code.gs' });
  const run = (expr) => { vm.runInContext('SETTINGS_MEMO = null', ctx); return vm.runInContext(expr, ctx); };

  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const dow = Number(Utilities.formatDate(new Date(), TZ, 'u')) % 7;
  const d = (i) => DAY[(dow + i + 7) % 7];

  const src = env.ss.insertSheet('ניהול תלמידים');
  const H = ['מס׳', 'קוד תלמיד', 'שם תלמיד', 'משפחה', 'עיר', 'כתובת', 'שם ההורה', 'טל - תלמיד', 'טל -אמא', 'מקצוע', 'יום', 'שעה', 'הערות', 'תשלום', 'תדירות', 'כמות', 'יתרה חובה/זכות(+/-)', 'מחיר'];
  const rows = [
    ['קבועים'], H,
    [1, 101, 'נועם', 'אלמוג', 'גבעת שמואל', 'מגיע אליי', 'מיכל אלמוג', '', '0521234501', 'י׳ מתמטיקה 5 יח׳', `${d(0)} ו${d(3)}`, '08:30', '', "ב'", 'שבועי', 2, '', '₪ 200'],
    [2, 102, 'תמר', 'שגיא', 'גבעת שמואל', '', 'אורית שגיא', '0531234502', '0541234502', 'ח׳ חשבון', d(0), '10:00', '', "מ'", 'שבועי', 1, '', '₪ 200'],
    [3, 103, 'איתי', 'ברק', 'בני ברק', 'זום', 'יוסי ברק', '', '0501234503', 'פסיכומטרי כמותי', `${d(0)} ו${d(2)}`, '12:15', 'חבילה של 10', "ב'", 'פעמיים', 2, 'חוב 400 שקל', '₪ 180'],
    [4, 104, 'שקד', 'רוזן', 'פתח תקווה', 'מגיע אליהם', 'דנה רוזן', '', '0521234504', 'י״א פיזיקה', `${d(2)} ו${d(4)}`, '17:00', '', "ב'", 'שבועי', 2, '', '₪ 220'],
    [5, 105, 'יונתן', 'כץ', 'רמת גן', '', 'רינה כץ', '', '0541234505', 'ט׳ אנגלית', d(3), '18:30', '', "מ'", 'שבועי', 1, '', '₪ 200'],
    [6, 106, 'מאיה', 'לוי', 'גבעת שמואל', '', 'שירן לוי', '0581234506', '', 'סטודנטית — חדו״א 1', d(4), '20:00', '', "ב'", 'שבועי', 1, '', '₪ 250'],
    [7, 107, 'אורי', 'פרץ', 'קריית אונו', '', 'אבי פרץ', '', '0521234507', 'צו ראשון', d(5), '16:00', '', '', 'שבועי', 1, '', '₪ 200'],
    [8, 108, 'הדר', 'מזרחי', 'גבעתיים', '', '', '0501234508', '', 'י״ב מתמטיקה', '', '', 'עבר לזום', "ב'", '', 1, '', '₪ 200'],
    ['מזדמנים -לתזכר'],
    [9, 109, 'רועי', 'גולן', 'תל אביב', '', 'ליאת גולן', '', '0521234509', 'י׳ פיזיקה', '', '', 'לפני מבחנים', '', '', '', '', '₪ 200'],
    [10, 110, 'נטע', 'חיים', 'גבעת שמואל', '', '', '0541234510', '', 'סטטיסטיקה', '', '', '', '', '', '', '', '₪ 220'],
    ['פולו אפ קרוב'],
    [11, '', 'עדי', 'שמש', 'פתח תקווה', '', 'גלית שמש', '', '0531234511', 'ח׳ מתמטיקה', '', '', 'מחכה לתשובה', '', '', '', '', ''],
    [12, '', 'ליאם', 'אברהם', 'אור יהודה', '', '', '0581234512', '', 'פסיכומטרי', '', '', '', '', '', '', '', ''],
    ['פולו אפ רחוק'],
    [13, '', 'יעלי', 'דהן', 'חולון', '', '', '', '0501234513', '', '', '', 'אחרי בגרות קיץ', '', '', '', '', ''],
    [14, '', 'אביב', 'נחום', 'רמת השרון', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  rows.forEach((r, i) => r.forEach((v, j) => src.set(i + 1, j + 1, v)));

  run('setup()');
  run('migrateCore_(false)');

  // history: ~17 weeks of lessons for regulars, deterministic pseudo-random
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const st0 = run('buildState_()');
  const regs = st0.students.filter(s => s.status === 'קבוע' && s.daysArr.length);
  const addDays = (s, n) => run(`addDays_("${s}", ${n})`);
  const start = addDays(today, -120);
  for (let dd = start; dd < today; dd = addDays(dd, 1)) {
    const wd = run(`dowOf_("${dd}")`);
    regs.forEach(s => {
      if (s.daysArr.indexOf(wd) < 0) return;
      const r = rnd();
      const status = r < 0.88 ? 'בוצע' : r < 0.94 ? 'בוטל - מחויב' : 'בוטל';
      run(`logLesson_(${JSON.stringify({ code: s.code, date: dd, status })})`);
    });
  }
  // casual lessons
  [['109', -40], ['109', -12], ['110', -25], ['110', -5]].forEach(([c, off]) =>
    run(`logLesson_(${JSON.stringify({ code: c, date: addDays(today, off), minutes: 60 })})`));

  // payments: most students pay every ~4 lessons; two fall behind
  const st1 = run('buildState_()');
  const chrono = st1.lessons.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const acc = {};
  const cnt = {};
  chrono.forEach(l => {
    if (l.status === 'בוטל') return;
    acc[l.code] = (acc[l.code] || 0) + l.price;
    cnt[l.code] = (cnt[l.code] || 0) + 1;
    if (cnt[l.code] % 4 !== 0) return;
    let amount = acc[l.code];
    if (l.code === '103') amount = Math.round(amount * 0.6);
    if (l.code === '105' && l.date > addDays(today, -35)) return;
    const method = st1.students.find(s => s.code === l.code).payMethod || 'ביט';
    run(`logPayment_(${JSON.stringify({ code: l.code, date: l.date, amount, method })})`);
    acc[l.code] = 0;
  });
  // a few in-month payments
  

  // follow-ups
  const contacts = [
    { code: '111', kind: 'וואטסאפ', note: 'שלחתי מחירון, ביקשה לחזור אליה', followup: today },
    { code: '112', kind: 'שיחה', note: 'מתלבט בין קורס לשיעורים פרטיים', followup: addDays(today, -2) },
    { code: '113', kind: 'וואטסאפ', note: 'לחזור אחרי הבגרות', followup: addDays(today, 40) },
    { code: '109', kind: 'שיחה', note: 'מבחן בפיזיקה בעוד שבועיים', followup: addDays(today, 3) },
  ];
  contacts.forEach(c => run(`logContact_(${JSON.stringify(c)})`));
  run(`saveStudent_(${JSON.stringify({ first: 'אלה', last: 'ויס', phoneParent: '0521234515', subject: 'ז׳ מתמטיקה', city: 'גבעת שמואל', notes: 'הגיעה מהמודעה בקבוצת ההורים' })})`);

  return { env, ctx, run, today };
}

module.exports = { buildSeededEnv };

if (require.main === module) {
  const { run, env } = buildSeededEnv();
  const st = run('buildState_()');
  st.demo = true;
  const out = path.join(__dirname, '../app/demo.json');
  fs.writeFileSync(out, JSON.stringify(st));
  console.log('demo.json:', st.students.length, 'students,', st.lessons.length, 'lessons,', st.payments.length, 'payments,',
    st.alerts.length, 'alerts; today', st.agenda.today.length, 'tomorrow', st.agenda.tomorrow.length,
    '| kpi', JSON.stringify(st.kpi));
  console.log('api key for local tests:', env.props.API_KEY.slice(0, 4) + '…');
}
