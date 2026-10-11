'use strict';

const { EMAIL_RE } = require('./config');

const SLOTS = {
  asap: 'Dès que possible',
  morning: 'Ce matin (9h–12h)',
  afternoon: 'Cet après-midi (14h–17h)',
  evening: 'En fin de journée (après 17h)'
};

const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Retourne le numéro au format E.164 (+33…) ou null s'il est invalide. */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/[\s.\-()]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(digits)) return `+33${digits.slice(1)}`;
  if (/^\+33[1-9]\d{8}$/.test(digits)) return digits;
  if (/^\+(?!33)[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

function formatPhone(e164) {
  const fr = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164 || '');
  return fr ? `0${fr[1]} ${fr[2]} ${fr[3]} ${fr[4]} ${fr[5]}` : e164;
}

function normalizeSource(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SOURCE_RE.test(value) ? value : 'direct';
}

function validateLead(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};

  const firstName = cleanText(input.firstName, 60);
  if (!firstName) errors.firstName = 'Indiquez votre prénom.';

  const lastName = cleanText(input.lastName, 60);

  const phone = normalizePhone(cleanText(input.phone, 30));
  if (!phone) errors.phone = 'Numéro de téléphone invalide.';

  const email = cleanText(input.email, 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) errors.email = 'Adresse e-mail invalide.';

  const slot = Object.prototype.hasOwnProperty.call(SLOTS, input.slot) ? input.slot : 'asap';

  if (input.consent !== true) errors.consent = 'Votre accord est nécessaire pour être rappelé(e).';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { firstName, lastName, phone, email, slot, source: normalizeSource(input.source) }
  };
}

module.exports = { validateLead, normalizePhone, formatPhone, normalizeSource, SLOTS };
