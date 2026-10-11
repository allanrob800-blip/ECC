/**
 * Rappel Avenir Eco : application web Google Apps Script.
 *
 * Page « Me faire rappeler » ouverte par QR code. Chaque demande est écrite dans
 * un Google Sheet, le conseiller reçoit un e-mail complet et le contact du
 * partenaire (Avenir Eco) est prévenu quand le lead vient de son stand.
 *
 * Réglages (Paramètres du projet > Propriétés du script) :
 *   OWNER_EMAIL           e-mail du conseiller (obligatoire)
 *   AVENIR_ECO_EMAIL      e-mail du contact Avenir Eco (plusieurs : séparés par des virgules)
 *   PARTNER_SHARE_CONTACT "1" pour inclure téléphone et e-mail du client dans le message au partenaire
 *   VCARD_URL             remplace le lien vkard par défaut (facultatif)
 *   AVENIR_ECO_LOGO_URL   remplace l'adresse du logo d'Avenir Eco (facultatif, https uniquement)
 *   SHEET_ID              rempli automatiquement par setup()
 */

const PROFILE = {
  name: 'Allan Fix',
  firstName: 'Allan',
  title: 'Conseiller commercial · Agence Rennes',
  phone: '+33685740141',
  email: 'allan.fix@octopusenergy.fr',
  trustpilotUrl: 'https://fr.trustpilot.com/review/octopusenergy.fr',
  subscribeUrl: 'https://octopusenergy.fr/souscription',
  privacyUrl: 'https://octopusenergy.fr/politique-de-confidentialite',
  privacyEmail: 'donnees@octoenergy.com',
  mascotUrl: 'https://static.octopuscdn.com/constantine/constantine.svg',
  vcardUrl: 'https://api.vkard.io/vcf/serve/44146dc1-7140-4653-b44b-bc7b1e1e5289/627b0e5c74'
};

/** Une source qui commence par la clé (« avenir-eco », « avenir-eco-rennes ») déclenche l'e-mail au partenaire. */
const PARTNERS = {
  'avenir-eco': {
    label: 'Avenir Eco',
    emailProperty: 'AVENIR_ECO_EMAIL',
    // Logo officiel du site d'Avenir Eco ; la propriété AVENIR_ECO_LOGO_URL le remplace si l'adresse change.
    logoProperty: 'AVENIR_ECO_LOGO_URL',
    logoUrl: 'https://cdn.prod.website-files.com/6875f788ff9a3fd5f68ab607/6aca63c77fa0678dc3ec178a_avenireco-solaire-noir-vert.svg'
  }
};

const SLOTS = {
  asap: 'Dès que possible',
  morning: 'Ce matin (9h–12h)',
  afternoon: 'Cet après-midi (14h–17h)',
  evening: 'En fin de journée (après 17h)'
};

const SHEET_NAME = 'Leads';
const COLUMNS = ['Reçu le', 'Prénom', 'Nom', 'Téléphone', 'E-mail', 'Créneau', 'Source', 'Partenaire', 'Mail conseiller', 'Mail partenaire', 'ID'];
const COL_MAIL_OWNER = 9;

const TIMEZONE = 'Europe/Paris';
const RETENTION_DAYS = 365;
const FLOOD_MAX_PER_10_MIN = 30;
const DUPLICATE_WINDOW_SECONDS = 300;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const DAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ---------------------------------------------------------------------------
// Page web
// ---------------------------------------------------------------------------

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  template.profile = {
    name: PROFILE.name,
    firstName: PROFILE.firstName,
    title: PROFILE.title,
    phone: PROFILE.phone,
    phoneDisplay: formatPhone(PROFILE.phone),
    email: PROFILE.email,
    trustpilotUrl: PROFILE.trustpilotUrl,
    subscribeUrl: PROFILE.subscribeUrl,
    privacyUrl: PROFILE.privacyUrl,
    privacyEmail: PROFILE.privacyEmail,
    mascotUrl: PROFILE.mascotUrl,
    vcardUrl: getProperty_('VCARD_URL') || PROFILE.vcardUrl
  };
  template.source = normalizeSource(e && e.parameter && e.parameter.src);
  // Logo et mention du partenaire seulement sur les QR de ce partenaire, jamais sur un accès direct.
  const partner = resolvePartner_(template.source);
  template.partner = partner ? { label: partner.label, logoUrl: partnerLogoUrl_(partner) } : null;
  return template.evaluate()
    .setTitle('Octopus Energy · ' + PROFILE.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Insère le contenu d'un autre fichier du projet (style, script) dans le gabarit. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function cleanText_(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Numéro au format E.164 (+33…) ou null s'il est invalide. */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/[\s.\-()]/g, '');
  if (digits.indexOf('00') === 0) digits = '+' + digits.slice(2);
  if (/^0[1-9]\d{8}$/.test(digits)) return '+33' + digits.slice(1);
  if (/^\+33[1-9]\d{8}$/.test(digits)) return digits;
  if (/^\+(?!33)[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

function formatPhone(e164) {
  const fr = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164 || '');
  return fr ? '0' + fr[1] + ' ' + fr[2] + ' ' + fr[3] + ' ' + fr[4] + ' ' + fr[5] : e164;
}

function normalizeSource(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SOURCE_RE.test(value) ? value : 'direct';
}

function validateLead(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};

  const firstName = cleanText_(input.firstName, 60);
  if (!firstName) errors.firstName = 'Indiquez votre prénom.';

  const lastName = cleanText_(input.lastName, 60);

  const phone = normalizePhone(cleanText_(input.phone, 30));
  if (!phone) errors.phone = 'Numéro de téléphone invalide.';

  const email = cleanText_(input.email, 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) errors.email = 'Adresse e-mail invalide.';

  const slot = Object.prototype.hasOwnProperty.call(SLOTS, input.slot) ? input.slot : 'asap';

  if (input.consent !== true) errors.consent = 'Votre accord est nécessaire pour être rappelé(e).';

  if (Object.keys(errors).length > 0) return { ok: false, errors: errors };
  return {
    ok: true,
    value: { firstName: firstName, lastName: lastName, phone: phone, email: email, slot: slot, source: normalizeSource(input.source) }
  };
}

// ---------------------------------------------------------------------------
// Traitement d'une demande (appelé par la page via google.script.run)
// ---------------------------------------------------------------------------

function submitCallback(raw) {
  try {
    return processLead_(raw);
  } catch (error) {
    console.error('submitCallback: ' + error.message);
    return { ok: false, error: 'Service momentanément indisponible. Appelez-moi directement.' };
  }
}

function processLead_(raw) {
  // Champ piège invisible : seul un robot le remplit. Faux succès, rien n'est enregistré.
  if (raw && typeof raw.website === 'string' && raw.website !== '') return { ok: true };

  const result = validateLead(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  const value = result.value;

  const cache = CacheService.getScriptCache();
  // Pas d'adresse IP côté Apps Script : plafond global par tranche de 10 minutes contre les envois en masse.
  const bucket = 'flood-' + Math.floor(Date.now() / 600000);
  const count = Number(cache.get(bucket) || 0);
  if (count >= FLOOD_MAX_PER_10_MIN) {
    return { ok: false, error: 'Trop de demandes. Réessayez dans quelques minutes ou appelez-moi directement.' };
  }
  cache.put(bucket, String(count + 1), 700);

  // Double appui sur le bouton : même numéro dans les 5 minutes = déjà reçu.
  const dupKey = 'phone-' + value.phone;
  if (cache.get(dupKey)) return { ok: true };

  const partner = resolvePartner_(value.source);
  const now = new Date();
  const lead = Object.assign({
    id: Utilities.getUuid(),
    createdAt: Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    partner: partner ? partner.key : ''
  }, value);

  let row = 0;
  try {
    row = appendLead_(lead);
  } catch (error) {
    console.error('Enregistrement du lead ' + lead.id + ' impossible : ' + error.message);
  }

  const ownerEmails = parseEmails_(getProperty_('OWNER_EMAIL'));
  const status = { owner: 'failed', partner: partner ? 'failed' : '' };

  status.owner = trySend_(ownerEmails, buildOwnerMail(lead, partner && partner.label), lead.email || undefined, lead.id);

  if (partner) {
    const partnerEmails = parseEmails_(getProperty_(partner.emailProperty));
    if (partnerEmails.length === 0) {
      status.partner = 'no-address';
    } else {
      const mail = buildPartnerMail(lead, partner.label, getProperty_('PARTNER_SHARE_CONTACT') === '1');
      status.partner = trySend_(partnerEmails, mail, ownerEmails[0], lead.id);
    }
  }

  if (row > 0) {
    try {
      const sheet = getSheet_();
      sheet.getRange(row, COL_MAIL_OWNER, 1, 2).setValues([[status.owner, status.partner]]);
    } catch (error) {
      console.error('Statut des e-mails du lead ' + lead.id + ' non enregistré : ' + error.message);
    }
  }

  // Le lead n'est perdu que si ni le Sheet ni l'e-mail au conseiller n'ont fonctionné.
  if (row === 0 && status.owner !== 'sent') {
    return { ok: false, error: 'Service momentanément indisponible. Appelez-moi directement.' };
  }
  // Marqué seulement ici : une demande échouée peut être renvoyée tout de suite.
  cache.put(dupKey, '1', DUPLICATE_WINDOW_SECONDS);
  return { ok: true };
}

function resolvePartner_(source) {
  const keys = Object.keys(PARTNERS);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (source === key || source.indexOf(key + '-') === 0) {
      return Object.assign({ key: key }, PARTNERS[key]);
    }
  }
  return null;
}

/** Adresse du logo : la propriété du script si elle est valide (https), sinon celle par défaut. */
function partnerLogoUrl_(partner) {
  const custom = getProperty_(partner.logoProperty);
  return custom && /^https:\/\/[^\s"'<>]+$/.test(custom) ? custom : partner.logoUrl;
}

/** Retourne « sent » ou « failed » ; une seule nouvelle tentative après 1 s. */
function trySend_(to, mail, replyTo, leadId) {
  if (to.length === 0) return 'no-address';
  try {
    if (MailApp.getRemainingDailyQuota() < to.length) throw new Error('quota quotidien d\'e-mails épuisé');
    try {
      sendMail_(to, mail, replyTo);
    } catch (_firstError) {
      Utilities.sleep(1000);
      sendMail_(to, mail, replyTo);
    }
    return 'sent';
  } catch (error) {
    console.error('E-mail du lead ' + leadId + ' non envoyé : ' + error.message);
    return 'failed';
  }
}

function sendMail_(to, mail, replyTo) {
  const options = {
    to: to.join(','),
    subject: mail.subject,
    body: mail.text,
    htmlBody: mail.html,
    name: 'Rappel ' + PROFILE.name
  };
  if (replyTo) options.replyTo = replyTo;
  MailApp.sendEmail(options);
}

// ---------------------------------------------------------------------------
// E-mails
// ---------------------------------------------------------------------------

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch];
  });
}

/** Date en français, fuseau Paris, sans dépendre d'Intl : « dimanche 11 octobre 2026 à 12:37 ». */
function formatDateFr_(iso) {
  const date = new Date(iso);
  const day = Number(Utilities.formatDate(date, TIMEZONE, 'u'));
  const month = Number(Utilities.formatDate(date, TIMEZONE, 'M'));
  return DAYS_FR[day - 1] + ' ' + Utilities.formatDate(date, TIMEZONE, 'd') + ' ' + MONTHS_FR[month - 1] + ' ' +
    Utilities.formatDate(date, TIMEZONE, 'yyyy') + ' à ' + Utilities.formatDate(date, TIMEZONE, 'HH:mm');
}

function fullName_(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ');
}

function table_(rows) {
  const body = rows.map(function (row) {
    return '<tr><td style="padding:4px 12px 4px 0;color:#555">' + escapeHtml_(row[0]) +
      '</td><td style="padding:4px 0"><strong>' + escapeHtml_(row[1]) + '</strong></td></tr>';
  }).join('');
  return '<table style="font-family:Arial,sans-serif;font-size:15px">' + body + '</table>';
}

function plain_(rows) {
  return rows.map(function (row) { return row[0] + ' : ' + row[1]; }).join('\n');
}

/** E-mail complet pour le conseiller. */
function buildOwnerMail(lead, partnerLabel) {
  const origin = partnerLabel || (lead.source === 'direct' ? 'Accès direct' : lead.source);
  const rows = [
    ['Nom', fullName_(lead)],
    ['Téléphone', formatPhone(lead.phone)],
    ['E-mail', lead.email || 'non renseigné'],
    ['Créneau souhaité', SLOTS[lead.slot]],
    ['Origine', origin],
    ['Reçu le', formatDateFr_(lead.createdAt)]
  ];
  return {
    subject: 'Nouvelle demande de rappel : ' + fullName_(lead) + ' (' + origin + ')',
    text: 'Nouvelle demande de rappel.\n\n' + plain_(rows) + '\n',
    html: '<p style="font-family:Arial,sans-serif">Nouvelle demande de rappel.</p>' + table_(rows)
  };
}

/**
 * E-mail pour le contact du partenaire. Par défaut : prénom, créneau et heure
 * seulement, sans téléphone ni e-mail (minimisation des données, RGPD).
 */
function buildPartnerMail(lead, partnerLabel, shareContact) {
  const rows = [
    ['Prénom', lead.firstName],
    ['Créneau souhaité', SLOTS[lead.slot]],
    ['Reçu le', formatDateFr_(lead.createdAt)]
  ];
  if (shareContact) {
    rows.splice(1, 0, ['Téléphone', formatPhone(lead.phone)]);
    if (lead.email) rows.splice(2, 0, ['E-mail', lead.email]);
  }
  const intro = 'Un client de votre stand ' + partnerLabel + ' vient de demander à être rappelé par ' + PROFILE.name + '.';
  return {
    subject: 'Nouveau lead depuis votre stand : ' + lead.firstName,
    text: intro + '\n\n' + plain_(rows) + '\n',
    html: '<p style="font-family:Arial,sans-serif">' + escapeHtml_(intro) + '</p>' + table_(rows)
  };
}

// ---------------------------------------------------------------------------
// Google Sheet
// ---------------------------------------------------------------------------

function getProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function parseEmails_(raw) {
  return String(raw || '').split(',').map(function (item) { return item.trim(); }).filter(function (item) {
    return EMAIL_RE.test(item);
  });
}

function getSheet_() {
  const id = getProperty_('SHEET_ID');
  if (!id) throw new Error('SHEET_ID absent : exécutez setup() une fois.');
  return SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
}

/** Ajoute le lead et retourne son numéro de ligne. */
function appendLead_(lead) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const row = sheet.getLastRow() + 1;
    const range = sheet.getRange(row, 1, 1, COLUMNS.length);
    // Format « texte brut » avant l'écriture : une valeur comme « =1+1 » reste du texte et n'est jamais évaluée.
    range.setNumberFormat('@');
    range.setValues([[
      lead.createdAt, lead.firstName, lead.lastName, lead.phone, lead.email,
      SLOTS[lead.slot], lead.source, lead.partner, '', '', lead.id
    ]]);
    return row;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Installation et maintenance (à lancer à la main depuis l'éditeur)
// ---------------------------------------------------------------------------

/** À lancer une fois : vérifie les réglages et crée le Google Sheet des leads. */
function setup() {
  if (parseEmails_(getProperty_('OWNER_EMAIL')).length === 0) {
    throw new Error('Propriété OWNER_EMAIL absente ou invalide (Paramètres du projet > Propriétés du script).');
  }
  if (parseEmails_(getProperty_('AVENIR_ECO_EMAIL')).length === 0) {
    console.warn('AVENIR_ECO_EMAIL absente ou invalide : le partenaire ne sera pas prévenu.');
  }
  if (!getProperty_('SHEET_ID')) {
    const spreadsheet = SpreadsheetApp.create('Leads · Rappel Avenir Eco');
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName(SHEET_NAME);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', spreadsheet.getId());
    console.log('Google Sheet créé : ' + spreadsheet.getUrl());
  }
  console.log('Configuration valide.');
}

/** Envoie un e-mail de test clairement identifié au conseiller et au contact partenaire. */
function sendTestEmails() {
  const lead = {
    id: 'test', createdAt: Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    firstName: 'TEST', lastName: 'Ne pas rappeler', phone: '+33600000000', email: '', slot: 'asap',
    source: 'avenir-eco', partner: 'avenir-eco'
  };
  const owner = buildOwnerMail(lead, 'Avenir Eco');
  owner.subject = '[TEST] ' + owner.subject;
  console.log('Conseiller : ' + trySend_(parseEmails_(getProperty_('OWNER_EMAIL')), owner, undefined, lead.id));
  const partnerMail = buildPartnerMail(lead, 'Avenir Eco', false);
  partnerMail.subject = '[TEST] ' + partnerMail.subject;
  console.log('Partenaire : ' + trySend_(parseEmails_(getProperty_('AVENIR_ECO_EMAIL')), partnerMail, undefined, lead.id));
}

/** Supprime les leads de plus de RETENTION_DAYS jours (conservation annoncée aux clients : 12 mois). */
function purgeOldLeads() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const dates = sheet.getRange(2, 1, last - 1, 1).getValues();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const at = Date.parse(String(dates[i][0]));
    if (!isFinite(at) || at < cutoff) {
      sheet.deleteRow(i + 2);
      removed += 1;
    }
  }
  console.log(removed + ' lead(s) supprimé(s).');
  return removed;
}

/** À lancer une fois : programme la purge quotidienne vers 3 h. */
function installPurgeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'purgeOldLeads') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('purgeOldLeads').timeBased().everyDays(1).atHour(3).create();
  console.log('Purge quotidienne programmée.');
}
