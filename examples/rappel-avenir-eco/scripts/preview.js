#!/usr/bin/env node
'use strict';

/**
 * Aperçu local de la page Apps Script : npm run preview, puis http://localhost:3111/?src=avenir-eco
 * Les e-mails sont affichés dans le terminal, les leads gardés en mémoire (perdus à l'arrêt).
 * Simulation seulement : voir scripts/gas-harness.js pour ses limites.
 */

const http = require('http');
const { createGoogleEnvironment } = require('./gas-harness');

const PORT = Number(process.env.PORT) || 3111;

const gas = createGoogleEnvironment({
  props: {
    OWNER_EMAIL: process.env.OWNER_EMAIL || 'conseiller@example.test',
    AVENIR_ECO_EMAIL: process.env.AVENIR_ECO_EMAIL || 'partenaire@example.test'
  },
  onMail: message => process.stdout.write(`[mail] À: ${message.to} | ${message.subject}\n${message.body}\n`)
});
gas.call('setup');

// Remplace google.script.run (absent hors de Google) par des appels HTTP vers ce serveur.
const SHIM = `<script>
window.google = { script: { run: (function () {
  function chain(ok, fail) {
    return {
      withSuccessHandler: function (f) { return chain(f, fail); },
      withFailureHandler: function (f) { return chain(ok, f); },
      submitCallback: function (data) {
        fetch('/__submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .then(function (r) { return r.json(); }).then(ok || function () {}).catch(fail || function () {});
      }
    };
  }
  return chain();
})() } };
</script>`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    const page = gas.page(url.searchParams.get('src') ?? undefined);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page.html.replace('</head>', `<meta name="viewport" content="${page.meta.viewport}">${SHIM}</head>`));
  }
  if (req.method === 'POST' && url.pathname === '/__submit') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let result;
      try {
        result = gas.call('submitCallback', JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_error) {
        result = { ok: false, error: 'Requête invalide.' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      process.stdout.write(`[feuille] ${JSON.stringify(gas.leadsSheet().rows.slice(1))}\n`);
    });
    return undefined;
  }
  res.writeHead(404);
  return res.end('Introuvable');
}).listen(PORT, '127.0.0.1', () => process.stdout.write(`Aperçu : http://localhost:${PORT}/?src=avenir-eco\n`));
