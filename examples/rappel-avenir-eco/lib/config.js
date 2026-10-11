'use strict';

const path = require('path');
const profile = require('../config/profile.json');
const partnersFile = require('../config/partners.json');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function parseEmails(raw) {
  return String(raw || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => EMAIL_RE.test(item));
}

function loadPartners(env) {
  const partners = {};
  for (const [key, def] of Object.entries(partnersFile)) {
    partners[key] = { key, label: def.label, emails: parseEmails(env[def.emailEnv]) };
  }
  return partners;
}

function loadConfig(env = process.env) {
  const mailer = env.MAILER || (env.RESEND_API_KEY ? 'resend' : 'log');
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    baseUrl: env.BASE_URL || '',
    profile: {
      ...profile,
      email: env.OWNER_EMAIL || profile.email,
      vcardUrl: env.VCARD_URL || profile.vcardUrl
    },
    ownerEmails: parseEmails(env.OWNER_EMAIL || profile.email),
    partners: loadPartners(env),
    partnerShareContact: env.PARTNER_SHARE_CONTACT === '1',
    mailer,
    resendApiKey: env.RESEND_API_KEY || '',
    mailFrom: env.MAIL_FROM || '',
    dataFile: env.DATA_FILE || path.join(__dirname, '..', 'data', 'leads.jsonl'),
    retentionDays: Number(env.RETENTION_DAYS) || 365,
    trustProxy: env.TRUST_PROXY === '1',
    rateLimit: { max: Number(env.RATE_LIMIT_MAX) || 10, windowMs: 10 * 60 * 1000 }
  };
}

/** Problèmes bloquants ou probables de configuration, affichés au démarrage. */
function configWarnings(config) {
  const warnings = [];
  if (config.mailer === 'resend') {
    if (!config.resendApiKey) warnings.push('MAILER=resend mais RESEND_API_KEY est vide.');
    if (!config.mailFrom) warnings.push('MAIL_FROM est vide : Resend refusera l\'envoi.');
  }
  if (config.mailer === 'log') warnings.push('Mode MAILER=log : aucun e-mail n\'est réellement envoyé.');
  if (config.ownerEmails.length === 0) warnings.push('OWNER_EMAIL invalide ou vide.');
  for (const partner of Object.values(config.partners)) {
    if (partner.emails.length === 0) {
      warnings.push(`Aucun e-mail configuré pour le partenaire « ${partner.label} » (variable d'environnement manquante) : pas de notification.`);
    }
  }
  return warnings;
}

module.exports = { loadConfig, configWarnings, parseEmails, EMAIL_RE };
