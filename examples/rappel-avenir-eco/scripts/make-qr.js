#!/usr/bin/env node
'use strict';

/**
 * Génère les QR codes (SVG vectoriel pour l'imprimeur + PNG) de la page de rappel.
 *
 * Usage : node scripts/make-qr.js <url-de-l-application> [source ...] [--out dossier]
 * Exemple : node scripts/make-qr.js https://script.google.com/macros/s/XXXX/exec avenir-eco avenir-eco-rennes
 *
 * Sans source, génère « avenir-eco ». L'URL encodée est <url-de-l-application>?src=<source>.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function parseArgs(argv) {
  const positional = [];
  let out = path.join(__dirname, '..', 'qr');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = path.resolve(argv[i + 1] || '');
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  return { appUrl: positional[0], sources: positional.slice(1), out };
}

async function main() {
  const { appUrl, sources, out } = parseArgs(process.argv.slice(2));
  if (!appUrl) {
    process.stderr.write('Usage : node scripts/make-qr.js <url-de-l-application> [source ...] [--out dossier]\n');
    process.exit(1);
  }

  const base = new URL(appUrl);
  if (base.protocol !== 'https:') {
    process.stderr.write('Refus : l\'URL doit être en https:// (un QR imprimé ne doit pas pointer vers du http).\n');
    process.exit(1);
  }
  if (base.hostname === 'script.google.com' && !base.pathname.endsWith('/exec')) {
    process.stderr.write('Refus : utilisez l\'URL de déploiement qui se termine par /exec (pas /dev, réservée aux tests).\n');
    process.exit(1);
  }

  let QRCode;
  try {
    QRCode = require('qrcode');
  } catch (_error) {
    process.stderr.write('Module « qrcode » absent : lancez d\'abord `npm install` dans ce dossier.\n');
    process.exit(1);
  }

  fs.mkdirSync(out, { recursive: true });
  for (const source of sources.length > 0 ? sources : ['avenir-eco']) {
    if (!SOURCE_RE.test(source)) {
      process.stderr.write(`Source invalide ignorée : « ${source} » (minuscules, chiffres et tirets, 40 caractères max).\n`);
      continue;
    }
    const target = new URL(base);
    target.searchParams.set('src', source);
    const url = target.toString();
    // Niveau M + marge de 4 modules (zone de silence imposée par la norme) : fiable même imprimé petit.
    const options = { errorCorrectionLevel: 'M', margin: 4 };
    fs.writeFileSync(path.join(out, `${source}.svg`), await QRCode.toString(url, { ...options, type: 'svg' }));
    await QRCode.toFile(path.join(out, `${source}.png`), url, { ...options, width: 1200 });
    process.stdout.write(`${source} -> ${url}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
