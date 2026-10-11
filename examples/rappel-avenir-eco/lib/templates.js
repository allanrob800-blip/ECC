'use strict';

const { SLOTS, formatPhone } = require('./validate');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]
  ));
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Paris'
  }).format(new Date(iso));
}

function fullName(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ');
}

function table(rows) {
  const body = rows
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(label)}</td><td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join('');
  return `<table style="font-family:Arial,sans-serif;font-size:15px">${body}</table>`;
}

/** E-mail complet pour le conseiller (coordonnées incluses). */
function ownerMail(lead, partnerLabel) {
  const origin = partnerLabel || (lead.source === 'direct' ? 'Accès direct' : lead.source);
  const rows = [
    ['Nom', fullName(lead)],
    ['Téléphone', formatPhone(lead.phone)],
    ['E-mail', lead.email || 'non renseigné'],
    ['Créneau souhaité', SLOTS[lead.slot]],
    ['Origine', origin],
    ['Reçu le', formatDate(lead.createdAt)]
  ];
  const text = rows.map(([label, value]) => `${label} : ${value}`).join('\n');
  return {
    subject: `Nouvelle demande de rappel : ${fullName(lead)} (${origin})`,
    text: `Nouvelle demande de rappel.\n\n${text}\n`,
    html: `<p style="font-family:Arial,sans-serif">Nouvelle demande de rappel.</p>${table(rows)}`
  };
}

/**
 * E-mail pour le contact du partenaire. Par défaut : prénom, créneau et heure
 * seulement, sans téléphone ni e-mail (minimisation des données, RGPD).
 */
function partnerMail(lead, partnerLabel, { shareContact = false, repName = '' } = {}) {
  const rows = [
    ['Prénom', lead.firstName],
    ['Créneau souhaité', SLOTS[lead.slot]],
    ['Reçu le', formatDate(lead.createdAt)]
  ];
  if (shareContact) {
    rows.splice(1, 0, ['Téléphone', formatPhone(lead.phone)]);
    if (lead.email) rows.splice(2, 0, ['E-mail', lead.email]);
  }
  const intro = `Un client de votre stand ${partnerLabel} vient de demander à être rappelé${repName ? ` par ${repName}` : ''}.`;
  const text = rows.map(([label, value]) => `${label} : ${value}`).join('\n');
  return {
    subject: `Nouveau lead depuis votre stand : ${lead.firstName}`,
    text: `${intro}\n\n${text}\n`,
    html: `<p style="font-family:Arial,sans-serif">${escapeHtml(intro)}</p>${table(rows)}`
  };
}

module.exports = { ownerMail, partnerMail, escapeHtml };
