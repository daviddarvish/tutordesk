// End-to-end test of Code.gs against the mock services, with synthetic data
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { createEnv, Utilities } = require('./gas-mock');

const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const env = createEnv();
const ctx = vm.createContext(env);
vm.runInContext(code, ctx, { filename: 'Code.gs' });
const run = (expr) => vm.runInContext(expr, ctx);
const resetMemo = () => run('SETTINGS_MEMO = null');

const TZ = 'Asia/Jerusalem';
const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const dow = Number(Utilities.formatDate(new Date(), TZ, 'u')) % 7;
const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const tomorrowName = DAY[(dow + 1) % 7];

// ---- synthetic source sheet in the same stacked layout as "ניהול תלמידים"
const src = env.ss.insertSheet('ניהול תלמידים');
const H1 = ['מס׳', 'קוד תלמיד', 'שם תלמיד', 'משפחה', 'עיר', 'כתובת', 'שם ההורה', 'טל - תלמיד', 'טל -אמא', 'מקצוע', 'יום', 'שעה', 'הערות', 'תשלום', 'תדירות', 'כמות', 'יתרה חובה/זכות(+/-)', 'מחיר'];
const H2 = ['מס׳', '', 'שם פרטי תלמיד', 'שם משפחה', 'עיר', 'כתובת', 'שם ההורה', 'טל - תלמיד', 'טל -אמא', '', '', '', '', 'סטטוס', '', 'כמות שבועית', '', 'מחיר לשיעור'];
const rows = [
  ['ניהול תלמידים', '', 'לידים'],
  ['קבועים'],
  H1,
  [1, 101, 'אלון', 'טסט', 'גבעת שמואל', 'מגיע אליי', 'רונית טסט', '', 521111111, 'י׳ מתמטיקה', `${DAY[dow]} ו${DAY[(dow + 2) % 7]}`, '17:30', 'כל 8 שיעורים 1300', "מ'", 'שבועי', 2, 0, '₪ 200'],
  [2, 102, 'בר', 'דמו', 'גבעת שמואל', '', '', '053-2222222', '', 'ח חשבון', tomorrowName, '18', '', "ב'", 'שבועי', 1, '', '₪ 200'],
  [3, 103, 'גל', 'ניסוי', 'פתח תקווה', 'מגיע אליהם', '', '', '0543333333', 'י״ב', 'א׳ וג׳', '', '', '', '', '', 'חוב 200 שקל', '200'],
  [4, 104, 'דנה', '', '', '', '', '', '', '', '', '', '', "ב'", '', 1, '', '₪ 180'],
  [5, 105],
  [6, 101, 'כפול', 'קוד', '', '', '', '', '', '', '', '', '', '', '', '', 150, ''],
  [],
  ['מזדמנים -לתזכר מזדמנים -'],
  [7, 'מינצר', '', 'משפחה בלבד - ליצור קשר', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  [8, 120, 'הילה', 'זמנית', 'רמת גן', '', '', '972504444444', '', 'אנגלית', '', '', '', '', '', '', '', ''],
  ['פולו אפ קרוב'],
  [9, '', 'יואב', 'קרוב', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['פולו אפ רחוק'],
  H2,
  [10, '', 'שירה בן חיים', '', 'חולון', '', '', '', '', '', '', '', '', 'לא ענתה', '', '', '', ''],
  [11, '', 'עומר', 'רחוק', '', '', '', '', '', '', '', '', '', '', '', '', '', '120'],
];
rows.forEach((r, i) => r.forEach((v, j) => src.set(i + 1, j + 1, v)));

// ---- setup
run('setup()');
['תלמידים', 'שיעורים', 'תשלומים', 'יומן', 'הגדרות'].forEach(n => assert(env.ss.getSheetByName(n), 'missing ' + n));
assert(env.props.API_KEY && env.props.API_KEY.length === 32, 'api key');
assert(/^tutordesk-/.test(env.props.NTFY_TOPIC), 'topic');
assert.strictEqual(env.triggers.length, 1);
run('setup()'); // idempotent
assert.strictEqual(env.triggers.length, 1, 'trigger not duplicated');
assert.strictEqual(env.ss.getSheetByName('הגדרות').getLastRow(), 1 + 14, 'settings not duplicated');
console.log('✓ setup + idempotent');

// ---- migrate
resetMemo();
const rep = run('migrateCore_(false)');
console.log('  migration counts:', JSON.stringify(rep.counts), 'skipped', rep.skipped);
assert.strictEqual(rep.count, 10);
assert.strictEqual(rep.counts['קבוע'], 5);
assert.strictEqual(rep.counts['מזדמן'], 2);
assert.strictEqual(rep.counts['פולו-אפ קרוב'], 1);
assert.strictEqual(rep.counts['פולו-אפ רחוק'], 2);
assert.strictEqual(rep.skipped, 1);
const blocked = run('migrateCore_(false)');
assert(blocked.blocked, 'second migration blocked');
console.log('✓ migration + duplicate protection');

const key = env.props.API_KEY;
const post = (body) => JSON.parse(run(`doPost(${JSON.stringify({ postData: { contents: JSON.stringify(body) } })}).getContent()`));
resetMemo();
assert.strictEqual(post({ key: 'wrong', action: 'state' }).code, 'AUTH');
resetMemo();
let st = post({ key, action: 'state' });
assert(st.ok, st.error);
const byName = n => st.students.find(s => s.first === n);

const alon = byName('אלון');
assert.strictEqual(alon.code, '101');
assert.strictEqual(alon.phoneParent, '052-1111111');
assert.deepStrictEqual(alon.daysArr, [dow, (dow + 2) % 7].sort());
assert.strictEqual(alon.time, '17:30');
assert.strictEqual(alon.payMethod, 'מזומן');
assert.strictEqual(alon.price, 200);
assert.strictEqual(byName('בר').time, '18:00');
assert.strictEqual(byName('בר').payMethod, 'ביט');
assert.strictEqual(byName('בר').phoneStudent, '053-2222222');
assert.deepStrictEqual(byName('גל').daysArr, [0, 2]);
assert.strictEqual(byName('גל').balance, -200);
assert.strictEqual(byName('דנה').price, 180);
const dup = byName('כפול');
assert.notStrictEqual(dup.code, '101', 'duplicate code reassigned');
assert.strictEqual(dup.balance, -150, 'numeric balance = debt per header');
assert.strictEqual(byName('הילה').phoneStudent, '050-4444444');
const minzer = st.students.find(s => s.last.startsWith('משפחה בלבד'));
assert(minzer && /קוד במקור: מינצר/.test(minzer.notes), 'non-numeric code moved to notes');
const shira = byName('שירה');
assert.strictEqual(shira.last, 'בן חיים');
assert.strictEqual(shira.status, 'פולו-אפ רחוק');
assert(/סטטוס במקור: לא ענתה/.test(shira.notes));
assert.strictEqual(byName('עומר').price, 120);
const codes = st.students.map(s => s.code);
assert.strictEqual(new Set(codes).size, codes.length, 'codes unique');
console.log('✓ parsing: phones, days, times, money, codes, split names');

// agenda
assert(st.agenda.today.some(a => a.code === '101'), 'alon today');
assert(st.agenda.tomorrow.some(a => a.code === '102'), 'bar tomorrow');
const barTm = st.agenda.tomorrow.find(a => a.code === '102');
assert(barTm.wa.startsWith('https://wa.me/972532222222?text='), barTm.wa);
const waText = decodeURIComponent(barTm.wa.split('text=')[1]);
assert(waText.includes(tomorrowName) && waText.includes('18:00') && waText.includes('דוד'), waText);
console.log('  reminder text:', waText);
assert(st.alerts.some(a => a.type === 'noSchedule' && a.name.startsWith('דנה')));
console.log('✓ agenda today/tomorrow + WhatsApp reminder link');

// lessons / payments
resetMemo();
st = post({ key, action: 'logLesson', code: '101', dedupe: true });
assert(st.agenda.today.find(a => a.code === '101').logged, 'logged');
resetMemo();
st = post({ key, action: 'logLesson', code: '101', dedupe: true });
assert.strictEqual(st.lessons.filter(l => l.code === '101').length, 1, 'dedupe');
assert.strictEqual(st.students.find(s => s.code === '101').balance, -200);
resetMemo();
st = post({ key, action: 'logLesson', code: '103', status: 'בוטל - מחויב', minutes: 60, price: 250 });
assert.strictEqual(st.students.find(s => s.code === '103').balance, -450);
assert(st.alerts.some(a => a.type === 'debt' && a.code === '103' && a.amount === 450), 'debt alert over threshold');
const debtWa = decodeURIComponent(st.alerts.find(a => a.type === 'debt').wa.split('text=')[1]);
assert(debtWa.includes('450'), debtWa);
resetMemo();
st = post({ key, action: 'logLesson', code: '103', status: 'בוטל' });
assert.strictEqual(st.students.find(s => s.code === '103').balance, -450, 'cancelled not charged');
resetMemo();
st = post({ key, action: 'logPayment', code: '103', amount: 450, method: 'ביט' });
assert.strictEqual(st.students.find(s => s.code === '103').balance, 0);
assert(!st.alerts.some(a => a.type === 'debt' && a.code === '103'));
resetMemo();
assert.strictEqual(post({ key, action: 'logPayment', code: '103', amount: -5 }).ok, false, 'reject bad amount');
const lid = st.lessons.find(l => l.code === '101').id;
resetMemo();
st = post({ key, action: 'deleteLesson', id: lid });
assert(!st.lessons.some(l => l.id === lid));
assert(!st.agenda.today.find(a => a.code === '101').logged);
console.log('✓ lessons, cancellations, payments, balance, delete');

// month KPIs
assert.strictEqual(st.kpi.month.billed, 250);
assert.strictEqual(st.kpi.month.collected, 450);
assert.strictEqual(st.months.length, 12);
assert.strictEqual(st.months[11].key, today.slice(0, 7));
console.log('✓ monthly KPIs');

// students: add / edit / contact
resetMemo();
st = post({ key, action: 'saveStudent', student: { first: 'ליד', last: 'חדש', phoneParent: '0587777777', subject: 'פסיכומטרי' } });
const newCode = st.savedCode;
const lead = st.students.find(s => s.code === newCode);
assert.strictEqual(lead.status, 'ליד');
assert.strictEqual(lead.phoneParent, '058-7777777');
resetMemo();
st = post({ key, action: 'saveStudent', student: { code: newCode, first: 'ליד', last: 'חדש', status: 'קבוע', days: [dow], time: '9:15', price: 220 } });
const edited = st.students.find(s => s.code === newCode);
assert.strictEqual(edited.status, 'קבוע');
assert.strictEqual(edited.time, '09:15');
assert.strictEqual(edited.price, 220);
assert(st.agenda.today.some(a => a.code === newCode));
resetMemo();
st = post({ key, action: 'logContact', code: '120', kind: 'וואטסאפ', note: 'ביקש שאחזור אחרי החגים', followup: today });
const hila = st.students.find(s => s.code === '120');
assert.strictEqual(hila.followup, today);
assert(/ביקש שאחזור/.test(hila.notes));
assert(st.alerts.some(a => a.type === 'followup' && a.code === '120'));
resetMemo();
assert.strictEqual(post({ key, action: 'saveStudent', student: { first: '' } }).ok, false);
console.log('✓ add/edit student, contact log, follow-up alert');

// manual rows in sheet get keys
const les = env.ss.getSheetByName('שיעורים');
les.set(les.getLastRow() + 1, 2, new Date());
les.set(les.getLastRow(), 3, '102');
les.set(les.getLastRow(), 6, 200);
resetMemo();
st = post({ key, action: 'state' });
assert(st.lessons.some(l => l.code === '102' && /^L/.test(l.id)), 'manual lesson got id');
console.log('✓ manual sheet edits picked up');

// notifications
env.sent.length = 0;
resetMemo();
assert(run('morningDigest_()'));
resetMemo();
assert(run('eveningCheck_()'));
resetMemo();
assert(run('weeklySummary_()'));
env.sent.forEach(m => console.log('  ntfy →', m.body.title, '|', m.body.message.replace(/\n/g, ' / ').slice(0, 120), m.body.actions ? '| actions: ' + m.body.actions.map(a => a.label).join(', ') : ''));
assert(env.sent.length >= 3);
env.sent.forEach(m => {
  assert.strictEqual(m.url, 'https://ntfy.sh/');
  assert.strictEqual(m.body.topic, env.props.NTFY_TOPIC);
  assert(m.body.click.startsWith('https://daviddarvish.github.io/tutordesk/#'));
});
const eve = env.sent.find(m => m.body.title.startsWith('מחר'));
assert(eve && eve.body.actions && eve.body.actions[0].url.startsWith('https://wa.me/'));
console.log('✓ ntfy payloads');

// hourly tick dedupes per day
env.sent.length = 0;
resetMemo();
run('hourlyTick()');
const n1 = env.sent.length;
resetMemo();
run('hourlyTick()');
assert.strictEqual(env.sent.length, n1, 'no duplicates within the day');
console.log('✓ hourly tick: sent', n1, 'now, nothing on repeat');


// hourly tick inside the configured windows
const hourNow = Number(Utilities.formatDate(new Date(), TZ, 'H'));
const setSheet = env.ss.getSheetByName('הגדרות');
setSheet.data.forEach((r, i) => {
  if (r[0] === 'morningHour' || r[0] === 'eveningHour') setSheet.set(i + 1, 3, String(hourNow));
  if (r[0] === 'weeklyDay') setSheet.set(i + 1, 3, DAY[dow]);
});
delete env.props.LAST_MORNING; delete env.props.LAST_EVENING; delete env.props.LAST_WEEKLY;
env.sent.length = 0;
resetMemo(); run('hourlyTick()');
const titles = env.sent.map(m => m.body.title);
console.log('  in-window tick sent:', titles.join(' | '));
assert(titles.some(t => t.startsWith('בוקר טוב')) && titles.some(t => t === 'סיכום שבועי') && titles.some(t => t.startsWith('מחר')));
const n2 = env.sent.length;
resetMemo(); run('hourlyTick()');
assert.strictEqual(env.sent.length, n2, 'no repeat in window');
setSheet.data.forEach((r, i) => { if (r[0] === 'notifications') setSheet.set(i + 1, 3, 'לא'); });
delete env.props.LAST_MORNING;
resetMemo(); run('hourlyTick()');
assert.strictEqual(env.sent.length, n2, 'notifications off respected');
console.log('✓ hourly tick windows, weekly day, off switch');

// helpers
assert.strictEqual(JSON.stringify(run('parseDays_("שני ורביעי")')), JSON.stringify([1, 3]));
assert.strictEqual(JSON.stringify(run('parseDays_("ראשון ושלישי")')), JSON.stringify([0, 2]));
assert.strictEqual(JSON.stringify(run('parseDays_("ה\'")')), JSON.stringify([4]));
assert.strictEqual(JSON.stringify(run('parseDays_("שנייה")')), JSON.stringify([]));
assert.strictEqual(run('normPhone_("+972-52-123-4567")'), '052-1234567');
assert.strictEqual(run('normPhone_("03-5551234")'), '03-5551234');
assert.strictEqual(run('waLink_("052-1234567","")'), 'https://wa.me/972521234567');
assert.strictEqual(run('dstr_("5/11/2026")'), '2026-11-05');
assert.strictEqual(run('addMonths_("2026-01", -1)'), '2025-12');
console.log('✓ helpers');

fs.writeFileSync(path.join(__dirname, 'state-sample.json'), JSON.stringify(st, null, 1));
console.log('\nALL BACKEND TESTS PASSED');
