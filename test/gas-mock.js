// Minimal mock of the Google Apps Script services used by Code.gs
const crypto = require('crypto');

function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function partsInTz(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
  });
  const o = {};
  f.formatToParts(date).forEach(p => { o[p.type] = p.value; });
  if (o.hour === '24') o.hour = '00';
  return o;
}

const Utilities = {
  formatDate(date, tz, pattern) {
    const p = partsInTz(date, tz);
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return pattern
      .replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour).replace('mm', p.minute)
      .replace(/\bH\b/, String(Number(p.hour))).replace(/\bu\b/, String(wd));
  },
  parseDate(str, tz, pattern) {
    if (pattern !== 'yyyy-MM-dd') throw new Error('mock parseDate pattern');
    const [y, m, d] = str.split('-').map(Number);
    // find UTC instant that is local midnight in tz
    let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const p = partsInTz(new Date(guess), tz);
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      guess += Date.UTC(y, m - 1, d) - asUtc;
    }
    return new Date(guess);
  },
  getUuid() { return crypto.randomUUID(); },
};

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined || v === null ? '' : (isDate(v) ? new Date(v.getTime()) : v));
      }
      out.push(row);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map(r => r.map(v => isDate(v) ? Utilities.formatDate(v, 'Asia/Jerusalem', 'dd/MM/yyyy') : String(v)));
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error(`setValues size mismatch ${vals.length}x${vals[0].length} vs ${this.nr}x${this.nc}`);
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setDataValidation() { return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(r => { for (let j = r.length - 1; j >= 0; j--) { if (r[j] !== '' && r[j] !== undefined) { m = Math.max(m, j + 1); break; } } });
    return m;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc}`);
    return new Range(this, r, c, nr, nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setRightToLeft() { return this; }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getId() { return 'SS1'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/SS1/edit'; }
  getSpreadsheetTimeZone() { return 'Asia/Jerusalem'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
}

function createEnv() {
  const ss = new Spreadsheet();
  const props = {};
  const sent = [];
  const alerts = [];
  const triggers = [];
  const dv = { requireValueInList() { return dv; }, setAllowInvalid() { return dv; }, build() { return {}; } };
  const env = {
    ss, props, sent, alerts, triggers,
    Utilities,
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      newDataValidation: () => dv,
      getUi: () => ({
        alert: (...a) => { alerts.push(a.filter(x => typeof x === 'string')); },
        ButtonSet: { OK: 'OK' },
        createMenu() { const m = { addItem() { return m; }, addSeparator() { return m; }, addToUi() {} }; return m; },
        showModalDialog: (o, t) => { alerts.push(['dialog', t]); },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => { sent.push({ url, body: JSON.parse(opts.payload) }); return { getResponseCode: () => 200 }; },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => { const b = { timeBased() { return b; }, everyHours() { return b; }, create() { triggers.push({ getHandlerFunction: () => fn }); } }; return b; },
      getService: () => ({ getUrl: () => null }),
    },
    HtmlService: {
      createTemplate: html => ({ evaluate() { return { setWidth() { return this; }, setHeight() { return this; } }; } }),
    },
  };
  return env;
}

module.exports = { createEnv, Utilities };
