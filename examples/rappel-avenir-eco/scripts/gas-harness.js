'use strict';

/**
 * Environnement de test local pour apps-script/Code.gs : simule en mémoire les services
 * Google utilisés (feuille de calcul, e-mail, propriétés, cache, verrou, gabarits HTML).
 *
 * Limite : c'est une simulation. Elle vérifie notre logique et le rendu de la page, pas le
 * comportement réel de Google (quotas, bac à sable des iframes, envoi effectif des e-mails).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SCRIPT_DIR = path.join(__dirname, '..', 'apps-script');

function parisParts(date) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** Ne gère que les motifs utilisés par Code.gs. */
function formatDate(date, _timeZone, pattern) {
  const p = parisParts(date);
  const pad = n => String(n).padStart(2, '0');
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  switch (pattern) {
    case 'u': return String(weekday);
    case 'M': return String(Number(p.month));
    case 'd': return String(Number(p.day));
    case 'yyyy': return p.year;
    case 'HH:mm': return `${p.hour}:${p.minute}`;
    case "yyyy-MM-dd'T'HH:mm:ssXXX": {
      const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
      const sign = offsetMin >= 0 ? '+' : '-';
      return `${p.year}-${pad(p.month)}-${pad(p.day)}T${p.hour}:${p.minute}:${p.second}${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
    }
    default: throw new Error(`Motif de date non simulé : ${pattern}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
}

/** Compile un gabarit Apps Script : <?= échappé ?>, <?!= brut ?> et <? code ?>. */
function renderTemplate(name, data) {
  const source = fs.readFileSync(path.join(SCRIPT_DIR, `${name}.html`), 'utf8');
  let code = 'let __out = "";\n';
  const scriptlet = /<\?(!?=)?([\s\S]*?)\?>/g;
  let last = 0;
  let match;
  while ((match = scriptlet.exec(source))) {
    code += `__out += ${JSON.stringify(source.slice(last, match.index))};\n`;
    const body = match[2].trim().replace(/;$/, '');
    if (match[1] === '=') code += `__out += __escape(${body});\n`;
    else if (match[1] === '!=') code += `__out += (${body});\n`;
    else code += `${match[2]}\n`;
    last = scriptlet.lastIndex;
  }
  code += `__out += ${JSON.stringify(source.slice(last))};\nreturn __out;`;
  const include = file => fs.readFileSync(path.join(SCRIPT_DIR, `${file}.html`), 'utf8');
  return new Function('__escape', 'include', 'data', `with (data) {\n${code}\n}`)(escapeHtml, include, data);
}

function createSheet(state) {
  const sheet = {
    name: 'Feuille 1',
    rows: [],
    formats: [],
    getLastRow: () => sheet.rows.length,
    setName(name) { sheet.name = name; return sheet; },
    setFrozenRows() { return sheet; },
    deleteRow(n) { sheet.rows.splice(n - 1, 1); sheet.formats.splice(n - 1, 1); },
    getRange(row, col, numRows = 1, numCols = 1) {
      if (state.failSheet) throw new Error('Feuille inaccessible');
      const range = {
        setNumberFormat(fmt) {
          for (let r = 0; r < numRows; r += 1) sheet.formats[row - 1 + r] = fmt;
          return range;
        },
        setValues(values) {
          values.forEach((vals, r) => {
            const target = sheet.rows[row - 1 + r] || (sheet.rows[row - 1 + r] = []);
            vals.forEach((val, c) => { target[col - 1 + c] = val; });
          });
          return range;
        },
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r += 1) {
            const line = [];
            for (let c = 0; c < numCols; c += 1) line.push((sheet.rows[row - 1 + r] || [])[col - 1 + c] ?? '');
            out.push(line);
          }
          return out;
        },
        setFontWeight() { return range; }
      };
      return range;
    }
  };
  return sheet;
}

function createGoogleEnvironment(options = {}) {
  const state = {
    props: { OWNER_EMAIL: 'allan@example.test', AVENIR_ECO_EMAIL: 'contact@avenir.test', ...options.props },
    sent: [],
    logs: [],
    spreadsheets: new Map(),
    triggers: [],
    cache: new Map(),
    quota: options.quota ?? 100,
    failMailFor: options.failMailFor || null,
    failSheet: false
  };

  const mailLog = options.onMail || null;

  const env = {
    console: {
      log: msg => state.logs.push(['log', String(msg)]),
      warn: msg => state.logs.push(['warn', String(msg)]),
      error: msg => state.logs.push(['error', String(msg)])
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (key in state.props ? state.props[key] : null),
        setProperty: (key, value) => { state.props[key] = value; }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => (state.cache.has(key) ? state.cache.get(key) : null),
        put: (key, value) => { state.cache.set(key, value); }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      sleep() {},
      base64Decode: text => [...Buffer.from(text, 'base64')],
      newBlob: (bytes, contentType, name) => ({ bytes: Buffer.from(bytes), contentType, name, getName: () => name })
    },
    MailApp: {
      getRemainingDailyQuota: () => state.quota,
      sendEmail(message) {
        if (state.failMailFor && state.failMailFor(message)) throw new Error('Service de messagerie indisponible');
        const recipients = message.to.split(',').length;
        state.quota -= recipients;
        state.sent.push(message);
        if (mailLog) mailLog(message);
      }
    },
    SpreadsheetApp: {
      create(name) {
        const sheet = createSheet(state);
        const id = `sheet-${state.spreadsheets.size + 1}`;
        const spreadsheet = {
          name, sheet, getId: () => id, getUrl: () => `https://sheets.example.test/${id}`,
          getSheets: () => [sheet], getSheetByName: wanted => (sheet.name === wanted ? sheet : null)
        };
        state.spreadsheets.set(id, spreadsheet);
        return spreadsheet;
      },
      openById(id) {
        if (!state.spreadsheets.has(id)) throw new Error(`Feuille introuvable : ${id}`);
        return state.spreadsheets.get(id);
      }
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: trigger => { state.triggers.splice(state.triggers.indexOf(trigger), 1); },
      newTrigger(handler) {
        const trigger = { getHandlerFunction: () => handler, spec: {} };
        const builder = {
          timeBased() { return builder; },
          everyDays(n) { trigger.spec.everyDays = n; return builder; },
          atHour(h) { trigger.spec.atHour = h; return builder; },
          create() { state.triggers.push(trigger); return trigger; }
        };
        return builder;
      }
    },
    HtmlService: {
      createTemplateFromFile(name) {
        return {
          evaluate() {
            const output = {
              html: renderTemplate(name, this),
              title: '',
              meta: {},
              setTitle(title) { output.title = title; return output; },
              addMetaTag(key, value) { output.meta[key] = value; return output; },
              getContent: () => output.html
            };
            return output;
          }
        };
      },
      createHtmlOutputFromFile: name => ({ getContent: () => fs.readFileSync(path.join(SCRIPT_DIR, `${name}.html`), 'utf8') })
    }
  };

  const context = vm.createContext(env);
  // Tous les fichiers .gs partagent la même portée globale, comme dans Apps Script.
  const skip = options.skipFiles || [];
  for (const file of fs.readdirSync(SCRIPT_DIR).filter(name => name.endsWith('.gs') && !skip.includes(name)).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPT_DIR, file), 'utf8'), context, { filename: file });
  }

  const roundTrip = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  return {
    state,
    context,
    /** Appelle une fonction de Code.gs ; le résultat est recopié pour éviter les écarts entre contextes JS. */
    call: (name, ...args) => roundTrip(context[name](...args)),
    page: (source) => context.doGet({ parameter: source === undefined ? {} : { src: source } }),
    leadsSheet() {
      const id = state.props.SHEET_ID;
      return id ? state.spreadsheets.get(id).sheet : null;
    }
  };
}

module.exports = { createGoogleEnvironment, formatDate };
