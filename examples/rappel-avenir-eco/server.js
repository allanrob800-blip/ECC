'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadConfig, configWarnings } = require('./lib/config');
const { validateLead, normalizeSource, formatPhone } = require('./lib/validate');
const { createMailer, sendWithRetry } = require('./lib/mailer');
const { ownerMail, partnerMail, escapeHtml } = require('./lib/templates');
const { createRateLimiter } = require('./lib/ratelimit');
const store = require('./lib/store');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 10 * 1024;
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    'default-src \'none\'',
    'img-src \'self\' https://static.octopuscdn.com data:',
    'style-src \'self\'',
    'script-src \'self\'',
    'connect-src \'self\'',
    'form-action \'self\'',
    'base-uri \'none\'',
    'frame-ancestors \'none\''
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function log(level, message, meta = {}) {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...meta })}\n`);
}

/** Un partenaire est reconnu par sa clé exacte (« avenir-eco ») ou en préfixe (« avenir-eco-rennes »). */
function resolvePartner(source, partners) {
  return Object.values(partners).find(p => source === p.key || source.startsWith(`${p.key}-`)) || null;
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    // Dernière entrée = celle ajoutée par notre proxy ; les précédentes sont falsifiables.
    if (forwarded.length > 0) return forwarded[forwarded.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_error) {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function renderView(template, config, source) {
  const p = config.profile;
  const values = {
    REP_NAME: p.name,
    REP_FIRSTNAME: p.firstName,
    REP_TITLE: p.title,
    TEL: p.phone,
    TEL_DISPLAY: formatPhone(p.phone),
    EMAIL: p.email,
    TRUSTPILOT_URL: p.trustpilotUrl,
    SUBSCRIBE_URL: p.subscribeUrl,
    PRIVACY_URL: p.privacyUrl,
    PRIVACY_EMAIL: p.privacyEmail,
    MASCOT_URL: p.mascotUrl,
    SRC: source
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => escapeHtml(values[key] ?? ''));
}

function createApp(config, { mailer = createMailer(config), now = () => new Date() } = {}) {
  const template = fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8');
  const limiter = createRateLimiter(config.rateLimit);

  async function handleCallback(req, res) {
    if (!limiter.allow(clientIp(req, config))) {
      return sendJson(res, 429, { ok: false, error: 'Trop de demandes. Réessayez dans quelques minutes.' });
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendJson(res, error.status || 400, { ok: false, error: 'Requête invalide.' });
    }

    // Champ piège invisible : seul un robot le remplit. Faux succès, rien n'est enregistré.
    if (body && typeof body.website === 'string' && body.website !== '') {
      return sendJson(res, 201, { ok: true });
    }

    const result = validateLead(body);
    if (!result.ok) return sendJson(res, 400, { ok: false, errors: result.errors });

    const partner = resolvePartner(result.value.source, config.partners);
    const lead = {
      type: 'lead',
      id: crypto.randomUUID(),
      createdAt: now().toISOString(),
      ...result.value,
      partner: partner ? partner.key : null
    };

    let stored = false;
    try {
      await store.append(config.dataFile, lead);
      stored = true;
    } catch (error) {
      log('error', 'lead storage failed', { leadId: lead.id, error: error.message });
    }

    const owner = ownerMail(lead, partner && partner.label);
    const ownerSend = sendWithRetry(mailer, { to: config.ownerEmails, replyTo: lead.email || undefined, ...owner });

    let partnerSend = Promise.resolve('skipped');
    if (partner && partner.emails.length > 0) {
      const mail = partnerMail(lead, partner.label, {
        shareContact: config.partnerShareContact,
        repName: config.profile.name
      });
      partnerSend = sendWithRetry(mailer, { to: partner.emails, replyTo: config.ownerEmails[0], ...mail }).then(() => 'sent');
    }

    const [ownerResult, partnerResult] = await Promise.allSettled([ownerSend.then(() => 'sent'), partnerSend]);
    const mail = {
      owner: ownerResult.status === 'fulfilled' ? ownerResult.value : 'failed',
      partner: partnerResult.status === 'fulfilled' ? partnerResult.value : 'failed'
    };
    for (const [who, outcome] of [['owner', ownerResult], ['partner', partnerResult]]) {
      if (outcome.status === 'rejected') log('error', `${who} mail failed`, { leadId: lead.id, error: outcome.reason.message });
    }

    if (stored) {
      await store.append(config.dataFile, { type: 'mail', leadId: lead.id, createdAt: lead.createdAt, ...mail })
        .catch(error => log('error', 'mail status storage failed', { leadId: lead.id, error: error.message }));
    }

    // Le lead n'est perdu que si ni le fichier ni l'e-mail au conseiller n'ont fonctionné.
    if (!stored && mail.owner !== 'sent') {
      return sendJson(res, 500, { ok: false, error: 'Service momentanément indisponible. Appelez-moi directement.' });
    }
    return sendJson(res, 201, { ok: true });
  }

  function serveStatic(req, res, pathname) {
    const file = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`)) return false;
    let data;
    try {
      data = fs.readFileSync(file);
    } catch (_error) {
      return false;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    try {
      if (pathname === '/api/callback') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return sendJson(res, 405, { ok: false, error: 'Méthode non autorisée.' });
        }
        return await handleCallback(req, res);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendJson(res, 405, { ok: false, error: 'Méthode non autorisée.' });
      }

      if (pathname === '/') {
        const html = renderView(template, config, normalizeSource(url.searchParams.get('src')));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
      if (pathname === '/contact') {
        res.writeHead(302, { Location: config.profile.vcardUrl, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ok');
      }
      if (serveStatic(req, res, pathname)) return undefined;

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Page introuvable');
    } catch (error) {
      log('error', 'unhandled request error', { error: error.message });
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Erreur interne.' });
      else res.end();
      return undefined;
    }
  });

  return server;
}

function start() {
  const config = loadConfig();
  for (const warning of configWarnings(config)) log('warn', warning);

  const purge = () => store.purgeOlderThan(config.dataFile, config.retentionDays)
    .then(removed => removed && log('info', 'old leads purged', { removed }))
    .catch(error => log('error', 'purge failed', { error: error.message }));
  purge();
  setInterval(purge, 24 * 60 * 60 * 1000).unref();

  const server = createApp(config);
  server.listen(config.port, config.host, () => log('info', 'server listening', { port: config.port }));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { createApp, resolvePartner, renderView };
