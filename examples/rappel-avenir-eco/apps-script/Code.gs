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
 *   AVENIR_ECO_LOGO_URL   remplace le logo d'Avenir Eco intégré (facultatif, https uniquement)
 *   AVENIR_ECO_REPS       prénoms des conseillers Avenir Eco proposés au client, séparés par des virgules (facultatif)
 *   SHEET_ID              rempli automatiquement par setup()
 */

const PROFILE = {
  name: 'Allan Fix',
  firstName: 'Allan',
  title: 'Conseiller commercial · Agence Rennes',
  phone: '+33685740141',
  email: 'allan.fix@octopusenergy.fr',
  trustpilotUrl: 'https://fr.trustpilot.com/review/octopusenergy.fr',
  privacyUrl: 'https://octopusenergy.fr/legal/politique-confidentialite-oef',
  privacyEmail: 'donnees@octoenergy.com',
  mascotUrl: 'https://static.octopuscdn.com/constantine/constantine.svg',
  vcardUrl: 'https://api.vkard.io/vcf/serve/44146dc1-7140-4653-b44b-bc7b1e1e5289/627b0e5c74'
};

/** Une source qui commence par la clé (« avenir-eco », « avenir-eco-rennes ») déclenche l'e-mail au partenaire. */
const PARTNERS = {
  'avenir-eco': {
    label: 'Avenir Eco',
    emailProperty: 'AVENIR_ECO_EMAIL',
    // Logo intégré (fichier Logo.gs) ; la propriété AVENIR_ECO_LOGO_URL (https) peut le remplacer.
    logoProperty: 'AVENIR_ECO_LOGO_URL',
    logoData: function () { return AVENIR_ECO_LOGO_DATA_URI; },
    // Conseillers du partenaire que le client peut citer (facultatif). La propriété AVENIR_ECO_REPS
    // (prénoms séparés par des virgules) remplace cette liste.
    advisorsProperty: 'AVENIR_ECO_REPS',
    defaultAdvisors: ['Nicolas', 'Thierry', 'Julien']
  }
};

/** Valeur envoyée par le formulaire pour « Un autre conseiller » (le client ne se souvient pas du nom). */
const ADVISOR_OTHER = 'autre';
const ADVISOR_OTHER_LABEL = 'Un autre conseiller';
const MAX_ADVISORS = 8;

const SLOTS = {
  asap: 'Dès que possible',
  morning: 'Ce matin (9h–12h)',
  afternoon: 'Cet après-midi (14h–17h)',
  evening: 'En fin de journée (après 17h)'
};

const SHEET_NAME = 'Leads';
const COLUMNS = ['Reçu le', 'Prénom', 'Nom', 'Téléphone', 'E-mail', 'Créneau', 'Source', 'Partenaire', 'Conseiller cité', 'Mail conseiller', 'Mail partenaire', 'ID'];
const COL_MAIL_OWNER = 10;

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
    privacyUrl: PROFILE.privacyUrl,
    privacyEmail: PROFILE.privacyEmail,
    mascotUrl: PROFILE.mascotUrl,
    vcardUrl: getProperty_('VCARD_URL') || PROFILE.vcardUrl
  };
  template.source = normalizeSource(e && e.parameter && e.parameter.src);
  // Logo et mention du partenaire seulement sur les QR de ce partenaire, jamais sur un accès direct.
  const partner = resolvePartner_(template.source);
  template.partner = partner ? { label: partner.label, logoHtml: partnerLogoHtml_(partner), advisors: partnerAdvisors_(partner) } : null;
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
    partner: partner ? partner.key : '',
    advisor: resolveAdvisor_(partner, raw.advisor)
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

/** Prénoms des conseillers du partenaire : propriété du script si elle existe, sinon la liste par défaut. */
function partnerAdvisors_(partner) {
  const clean = function (names) {
    const seen = {};
    return names.map(function (name) { return cleanText_(name, 30); }).filter(function (name) {
      const key = name.toLowerCase();
      if (!name || seen[key] || key === ADVISOR_OTHER) return false;
      seen[key] = true;
      return true;
    }).slice(0, MAX_ADVISORS);
  };
  const custom = getProperty_(partner.advisorsProperty);
  const fromProperty = custom ? clean(String(custom).split(',')) : [];
  return fromProperty.length > 0 ? fromProperty : clean(partner.defaultAdvisors);
}

/**
 * Conseiller cité par le client : uniquement un prénom de la liste (ou « autre »), et seulement sur une
 * source partenaire. Toute autre valeur est ignorée : le champ ne peut pas servir à écrire du texte libre.
 */
function resolveAdvisor_(partner, raw) {
  if (!partner || typeof raw !== 'string' || raw === '') return '';
  if (raw === ADVISOR_OTHER) return ADVISOR_OTHER_LABEL;
  const match = partnerAdvisors_(partner).filter(function (name) { return name === raw; });
  return match.length > 0 ? match[0] : '';
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

/** Balise <img> du logo : la propriété du script si elle est valide (https), sinon le logo intégré. */
function partnerLogoHtml_(partner) {
  const custom = getProperty_(partner.logoProperty);
  const src = custom && /^https:\/\/[^\s"'<>]+$/.test(custom) ? custom : partner.logoData();
  return '<img id="partner-logo" src="' + escapeHtml_(src) + '" alt="' + escapeHtml_(partner.label) + '">';
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
    name: mail.name || 'Rappel ' + PROFILE.name
  };
  if (replyTo) options.replyTo = replyTo;
  if (mail.inlineImages && hasImages_(mail.inlineImages)) options.inlineImages = mail.inlineImages;
  MailApp.sendEmail(options);
}

// ---------------------------------------------------------------------------
// E-mails
// ---------------------------------------------------------------------------

/** Noms d'expéditeur affichés dans la boîte de réception (la photo de profil vient du compte Google d'envoi). */
const SENDER_NAME_OWNER = 'Octopus Rappel';
const SENDER_NAME_PARTNER = 'Allan Fix · Octopus Energy';

const SLOT_BANNER = {
  asap: 'Dès que possible',
  morning: 'Ce matin · 9h–12h',
  afternoon: 'Cet après-midi · 14h–17h',
  evening: 'Fin de journée · après 17h'
};
const SLOT_SHORT = { asap: 'dès que possible', morning: 'ce matin', afternoon: 'cet après-midi', evening: 'fin de journée' };

const MAIL_FONT = 'Helvetica,Arial,sans-serif';

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch];
  });
}

/**
 * Date en français, fuseau Paris, sans dépendre d'Intl : « dimanche 11 octobre 2026 à 12:37 »,
 * ou sans l'année (withYear = false) : « dimanche 11 octobre à 12:37 ».
 */
function formatDateFr_(iso, withYear) {
  const date = new Date(iso);
  const day = Number(Utilities.formatDate(date, TIMEZONE, 'u'));
  const month = Number(Utilities.formatDate(date, TIMEZONE, 'M'));
  const year = withYear === false ? '' : ' ' + Utilities.formatDate(date, TIMEZONE, 'yyyy');
  return DAYS_FR[day - 1] + ' ' + Utilities.formatDate(date, TIMEZONE, 'd') + ' ' + MONTHS_FR[month - 1] + year +
    ' à ' + Utilities.formatDate(date, TIMEZONE, 'HH:mm');
}

function fullName_(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ');
}

/**
 * Images des e-mails, envoyées en pièces jointes en ligne (Gmail n'affiche pas les images « data: »).
 * Chaque image est facultative : si son fichier (OctopusAssets.gs) est absent, l'e-mail s'en passe.
 */
function emailImages_(wanted) {
  const sources = {
    mascot: typeof OCTOPUS_MASCOT_PNG_BASE64 !== 'undefined' ? ['image/png', 'mascot.png', OCTOPUS_MASCOT_PNG_BASE64] : null,
    wordmark: typeof OCTOPUS_WORDMARK_PNG_BASE64 !== 'undefined' ? ['image/png', 'octopus-energy.png', OCTOPUS_WORDMARK_PNG_BASE64] : null,
    avenir: typeof AVENIR_ECO_LOGO_EMAIL_DATA_URI !== 'undefined' ? ['image/jpeg', 'avenir-eco.jpg', AVENIR_ECO_LOGO_EMAIL_DATA_URI.split(',')[1]] : null
  };
  const images = {};
  wanted.forEach(function (key) {
    const source = sources[key];
    if (source) images[key] = Utilities.newBlob(Utilities.base64Decode(source[2]), source[0], source[1]);
  });
  return images;
}

function hasImages_(images) {
  return Object.keys(images).length > 0;
}

function smsLink_(lead) {
  const text = 'Bonjour ' + lead.firstName + ', c\'est ' + PROFILE.firstName + ' d\'Octopus Energy. ' +
    'Je viens d\'essayer de vous joindre suite à votre demande de rappel. Quand puis-je vous appeler ?';
  return 'sms:' + lead.phone + '?&body=' + encodeURIComponent(text);
}

/** Bouton d'e-mail (tableau + lien, compatible Gmail, Outlook et Apple Mail). */
function button_(href, label, style) {
  return '<a href="' + href + '" style="display:block;text-decoration:none;font-weight:bold;text-align:center;' + style + '">' + label + '</a>';
}

/** « Marc (Avenir Eco) » ou « Un conseiller Avenir Eco » ; chaîne vide si le client n'a cité personne. */
function advisorLabel_(lead, partnerLabel) {
  if (!lead.advisor) return '';
  return lead.advisor === ADVISOR_OTHER_LABEL ? 'Un conseiller ' + partnerLabel : lead.advisor + ' (' + partnerLabel + ')';
}

/** Fin de phrase de l'e-mail du partenaire : « , et indique avoir échangé avec Marc, de votre équipe ». */
function advisorSentence_(lead, html) {
  if (!lead.advisor) return '';
  const who = lead.advisor === ADVISOR_OTHER_LABEL ? 'un conseiller' : (html ? '<b>' + escapeHtml_(lead.advisor) + '</b>' : lead.advisor);
  return ', et indique avoir échangé avec ' + who + ', de votre équipe';
}

/** E-mail pour le conseiller : sombre, créneau en évidence, boutons Appeler / SMS / Écrire. */
function buildOwnerMail(lead, partnerLabel) {
  const images = emailImages_(partnerLabel ? ['mascot', 'avenir'] : ['mascot']);
  const name = escapeHtml_(fullName_(lead));
  const first = escapeHtml_(lead.firstName);
  const phoneDisplay = formatPhone(lead.phone);
  const received = formatDateFr_(lead.createdAt);
  const receivedShort = formatDateFr_(lead.createdAt, false);
  const origin = partnerLabel ? 'Stand ' + partnerLabel : 'Accès direct';
  const banner = SLOT_BANNER[lead.slot];
  const via = partnerLabel ? ' via ' + partnerLabel : '';
  const subject = '🔥 Nouveau lead' + via + ' · ' + lead.firstName + ' · ' + SLOT_SHORT[lead.slot];
  const hours = banner.split(' · ')[1];
  const preheader = 'À rappeler ' + SLOT_SHORT[lead.slot] + (hours ? ' (' + hours + ')' : '') + ' · ' + phoneDisplay;

  const mascot = images.mascot
    ? '<tr><td align="center" style="padding:2px 0 10px;"><img src="cid:mascot" width="64" alt="" style="display:block;height:auto;"></td></tr>'
    : '';
  const viaBlock = partnerLabel
    ? '<tr><td align="center" style="padding-bottom:18px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="color:#949FFF;font-size:13px;padding-right:10px;font-family:' + MAIL_FONT + ';">via le stand</td>' +
      '<td>' + (images.avenir
        ? '<img src="cid:avenir" width="46" height="46" alt="' + escapeHtml_(partnerLabel) + '" style="display:block;border-radius:10px;">'
        : '<span style="display:block;background:#FFFFFF;color:#0B1D18;font-weight:bold;font-size:14px;border-radius:10px;padding:10px 12px;font-family:' + MAIL_FONT + ';">' + escapeHtml_(partnerLabel) + '</span>') +
      '</td></tr></table></td></tr>'
    : '<tr><td style="height:12px;line-height:12px;font-size:12px;">&nbsp;</td></tr>';
  const emailRow = lead.email
    ? '<tr><td style="color:#949FFF;font-size:12px;width:96px;padding:11px 0 4px;vertical-align:top;">E-mail</td>' +
      '<td style="color:#F0FFFF;font-size:14px;padding:11px 0 4px;"><a href="mailto:' + escapeHtml_(lead.email) + '" style="color:#F0FFFF;">' + escapeHtml_(lead.email) + '</a></td></tr>'
    : '';
  const advisorLabel = advisorLabel_(lead, partnerLabel);
  const advisorRow = advisorLabel
    ? '<tr><td style="color:#949FFF;font-size:12px;width:96px;padding:4px 0;vertical-align:top;">A échangé avec</td>' +
      '<td style="color:#F0FFFF;font-size:14px;padding:4px 0;">' + escapeHtml_(advisorLabel) + '</td></tr>'
    : '';
  const secondary = lead.email
    ? '<td width="49%" align="center">' + button_(smsLink_(lead), '💬&nbsp; SMS prérempli', 'border:2px solid #60F0F8;color:#60F0F8;font-size:14px;padding:12px 6px;border-radius:12px;') + '</td>' +
      '<td width="2%">&nbsp;</td>' +
      '<td width="49%" align="center">' + button_('mailto:' + escapeHtml_(lead.email), '✉️&nbsp; Écrire', 'border:2px solid #60F0F8;color:#60F0F8;font-size:14px;padding:12px 6px;border-radius:12px;') + '</td>'
    : '<td align="center">' + button_(smsLink_(lead), '💬&nbsp; SMS prérempli', 'border:2px solid #60F0F8;color:#60F0F8;font-size:14px;padding:12px 6px;border-radius:12px;') + '</td>';

  const html =
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + escapeHtml_(preheader) + '</div>' +
    '<div style="background:#100030;padding:24px 12px 28px;font-family:' + MAIL_FONT + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">' +
    mascot +
    '<tr><td align="center" style="color:#60F0F8;font-size:22px;font-weight:bold;line-height:1.2;padding-bottom:10px;">Nouvelle demande de rappel</td></tr>' +
    viaBlock +
    '<tr><td style="background:#60F0F8;border-radius:14px;padding:14px 18px;" align="center">' +
    '<div style="color:#100030;font-size:11px;font-weight:bold;letter-spacing:1.5px;">À RAPPELER</div>' +
    '<div style="color:#100030;font-size:20px;font-weight:bold;line-height:1.25;padding-top:2px;">' + escapeHtml_(banner) + '</div></td></tr>' +
    '<tr><td style="height:12px;line-height:12px;font-size:12px;">&nbsp;</td></tr>' +
    '<tr><td style="background:#2D1A83;border-radius:16px;padding:22px 22px 8px;">' +
    '<div style="color:#F0FFFF;font-size:22px;font-weight:bold;line-height:1.2;">' + name + '</div>' +
    '<div style="padding:6px 0 16px;"><a href="tel:' + lead.phone + '" style="color:#60F0F8;font-size:25px;font-weight:bold;text-decoration:none;">' + phoneDisplay + '</a></div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #4B35A8;">' +
    emailRow + advisorRow +
    '<tr><td style="color:#949FFF;font-size:12px;width:96px;padding:4px 0;vertical-align:top;">Origine</td><td style="color:#F0FFFF;font-size:14px;padding:4px 0;">' + escapeHtml_(origin) + '</td></tr>' +
    '<tr><td style="color:#949FFF;font-size:12px;padding:4px 0 14px;vertical-align:top;">Reçu le</td><td style="color:#F0FFFF;font-size:14px;padding:4px 0 14px;">' + escapeHtml_(receivedShort) + '</td></tr>' +
    '</table></td></tr>' +
    '<tr><td align="center" style="padding:18px 0 10px;">' + button_('tel:' + lead.phone, '📞&nbsp; Appeler ' + first, 'background:#F050F8;color:#100030;font-size:17px;padding:16px 10px;border-radius:14px;') + '</td></tr>' +
    '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' + secondary + '</tr></table></td></tr>' +
    '<tr><td align="center" style="color:#949FFF;font-size:11px;line-height:1.7;padding-top:20px;">✅ Consentement recueilli le ' + escapeHtml_(received) + '<br>Données conservées 12 mois · Octopus Energy</td></tr>' +
    '</table></div>';

  const lines = [
    'NOUVELLE DEMANDE DE RAPPEL' + (partnerLabel ? ' (' + origin + ')' : ''),
    'À rappeler : ' + banner,
    '',
    fullName_(lead) + ' : ' + phoneDisplay,
    lead.email ? 'E-mail : ' + lead.email : 'E-mail : non renseigné',
    advisorLabel ? 'A échangé avec : ' + advisorLabel : null,
    'Origine : ' + origin,
    'Reçu le : ' + received,
    '',
    'Consentement recueilli le ' + received + '. Données conservées 12 mois.'
  ];
  return {
    subject: subject,
    text: lines.filter(function (line) { return line !== null; }).join('\n') + '\n',
    html: html,
    name: SENDER_NAME_OWNER,
    inlineImages: images
  };
}

/**
 * E-mail pour le contact du partenaire : clair, aux couleurs du partenaire. Par défaut : prénom, créneau
 * et heure seulement, sans téléphone ni e-mail du client (minimisation des données, RGPD).
 */
function buildPartnerMail(lead, partnerLabel, shareContact) {
  const images = emailImages_(['avenir', 'wordmark']);
  const first = escapeHtml_(lead.firstName);
  const received = formatDateFr_(lead.createdAt, false);
  const label = escapeHtml_(partnerLabel);
  const subject = '📍 Un client de votre stand veut être rappelé · ' + lead.firstName;
  const slotLine = SLOT_BANNER[lead.slot].replace(' · ', ' (') + (SLOT_BANNER[lead.slot].indexOf(' · ') > -1 ? ')' : '');

  const rows = [['Prénom', lead.firstName]];
  if (lead.advisor) rows.push(['Conseiller cité', lead.advisor === ADVISOR_OTHER_LABEL ? 'Un autre conseiller' : lead.advisor]);
  rows.push(['Rappel souhaité', slotLine]);
  if (shareContact) {
    rows.push(['Téléphone', formatPhone(lead.phone)]);
    if (lead.email) rows.push(['E-mail', lead.email]);
  }
  rows.push(['Reçu le', received]);
  const rowsHtml = rows.map(function (row, index) {
    const top = index === 0 ? '14px' : '5px';
    const bottom = index === rows.length - 1 ? '14px' : '5px';
    return '<tr><td style="color:#5C6B64;font-size:12px;width:120px;padding:' + top + ' 0 ' + bottom + ' 16px;vertical-align:top;">' + escapeHtml_(row[0]) + '</td>' +
      '<td style="color:#0B1D18;font-size:14px;font-weight:bold;padding:' + top + ' 16px ' + bottom + ' 0;">' + escapeHtml_(row[1]) + '</td></tr>';
  }).join('');

  const avenir = images.avenir
    ? '<td><img src="cid:avenir" width="48" height="48" alt="' + label + '" style="display:block;border-radius:10px;"></td>'
    : '<td style="color:#FFFFFF;font-size:18px;font-weight:bold;font-family:' + MAIL_FONT + ';">' + label + '</td>';
  const wordmark = images.wordmark
    ? '<td><img src="cid:wordmark" width="128" alt="Octopus Energy" style="display:block;height:auto;"></td>'
    : '<td style="color:#FFFFFF;font-size:18px;font-weight:bold;font-family:' + MAIL_FONT + ';">Octopus Energy</td>';

  const html =
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + escapeHtml_(PROFILE.name) + ' (Octopus Energy) a été prévenu. Rien à faire de votre côté.</div>' +
    '<div style="background:#EEF2E3;padding:24px 12px;font-family:' + MAIL_FONT + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;">' +
    '<tr><td style="background:#0B1D18;border-radius:16px 16px 0 0;padding:16px 20px;" align="center"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
    avenir + '<td style="color:#90AD03;font-size:20px;padding:0 14px;">×</td>' + wordmark + '</tr></table></td></tr>' +
    '<tr><td style="padding:26px 24px 8px;">' +
    '<div style="color:#5F7400;font-size:11px;font-weight:bold;letter-spacing:1.5px;">NOUVEAU LEAD DEPUIS VOTRE STAND</div>' +
    '<div style="color:#0B1D18;font-size:25px;font-weight:bold;line-height:1.2;padding:8px 0 10px;">Un client veut être rappelé</div>' +
    '<div style="color:#33423D;font-size:15px;line-height:1.55;"><b>' + first + '</b> vient de laisser ses coordonnées en scannant le QR code de votre stand' + advisorSentence_(lead, true) + '. <b>' + escapeHtml_(PROFILE.name) + '</b>, conseiller Octopus&nbsp;Energy, a été prévenu et rappellera ce client rapidement.</div></td></tr>' +
    '<tr><td style="padding:14px 24px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7EA;border-radius:12px;">' + rowsHtml + '</table></td></tr>' +
    '<tr><td style="padding:10px 24px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="30" valign="top" style="color:#5F7400;font-size:20px;line-height:1.2;">✔</td>' +
    '<td style="color:#0B1D18;font-size:15px;line-height:1.5;"><b>Rien à faire de votre côté.</b><br><span style="color:#33423D;font-size:14px;">' + escapeHtml_(PROFILE.firstName) + ' s’occupe de tout. Une question sur ce lead ? Vous pouvez l’appeler directement.</span></td></tr></table></td></tr>' +
    '<tr><td style="padding:16px 24px 6px;">' + button_('tel:' + PROFILE.phone, '📞&nbsp; Appeler ' + escapeHtml_(PROFILE.firstName) + ' · ' + formatPhone(PROFILE.phone), 'background:#90AD03;color:#0B1D18;font-size:16px;padding:15px 10px;border-radius:999px;') + '</td></tr>' +
    '<tr><td style="padding:14px 24px 22px;color:#7A867F;font-size:11px;line-height:1.6;" align="center">' +
    (shareContact ? '' : 'Par respect de la vie privée de ce client, ses coordonnées ne sont pas transmises dans ce message.<br>') +
    'Message automatique · Service de rappel d’' + escapeHtml_(PROFILE.name) + ', Octopus Energy</td></tr>' +
    '</table></div>';

  const lines = [
    'UN CLIENT DE VOTRE STAND ' + partnerLabel.toUpperCase() + ' VEUT ÊTRE RAPPELÉ',
    '',
    lead.firstName + ' vient de laisser ses coordonnées en scannant le QR code de votre stand' + advisorSentence_(lead, false) + '.',
    PROFILE.name + ', conseiller Octopus Energy, a été prévenu et rappellera ce client rapidement. Rien à faire de votre côté.',
    ''
  ].concat(rows.map(function (row) { return row[0] + ' : ' + row[1]; })).concat([
    '',
    'Une question sur ce lead ? ' + PROFILE.firstName + ' : ' + formatPhone(PROFILE.phone),
    shareContact ? '' : 'Par respect de la vie privée de ce client, ses coordonnées ne sont pas transmises dans ce message.'
  ]);
  return {
    subject: subject,
    text: lines.join('\n') + '\n',
    html: html,
    name: SENDER_NAME_PARTNER,
    inlineImages: images
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
      SLOTS[lead.slot], lead.source, lead.partner, lead.advisor || '', '', '', lead.id
    ]]);
    return row;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Installation et maintenance (à lancer à la main depuis l'éditeur)
// ---------------------------------------------------------------------------

/**
 * Met à jour un Sheet créé avec l'ancienne disposition : ajoute la colonne « Conseiller cité » avant
 * « Mail conseiller », sans toucher aux leads déjà enregistrés (leurs cellules glissent d'une colonne).
 */
function migrateSheet_(sheet) {
  const header = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  if (header[8] === 'Mail conseiller') {
    sheet.insertColumnBefore(9);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    console.log('Colonne « Conseiller cité » ajoutée au Sheet.');
  }
}

/** À lancer une fois : vérifie les réglages et crée le Google Sheet des leads (ou le met à jour). */
function setup() {
  if (parseEmails_(getProperty_('OWNER_EMAIL')).length === 0) {
    throw new Error('Propriété OWNER_EMAIL absente ou invalide (Paramètres du projet > Propriétés du script).');
  }
  if (parseEmails_(getProperty_('AVENIR_ECO_EMAIL')).length === 0) {
    console.warn('AVENIR_ECO_EMAIL absente ou invalide : le partenaire ne sera pas prévenu.');
  }
  if (getProperty_('SHEET_ID')) {
    migrateSheet_(getSheet_());
  } else {
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
