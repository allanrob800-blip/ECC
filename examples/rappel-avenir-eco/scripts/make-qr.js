#!/usr/bin/env node
'use strict';

/**
 * Génère les QR codes (SVG vectoriel pour l'imprimeur + PNG) d'une page de rappel.
 *
 * Usage : node scripts/make-qr.js <url-de-base> [source ...] [--out dossier]
 * Exemple : node scripts/make-qr.js https://rappel.exemple.fr avenir-eco avenir-eco-rennes
 *
 * Sans source, génère « avenir-eco ». L'URL encodée est <url-de-base>/?src=<source>.
 */

const fs = require('fs');
const path = require('path');
const { normalizeSource } = require('../lib/validate');

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
  return { baseUrl: positional[0], sources: positional.slice(1), out };
}

async function main() {
  const { baseUrl, sources, out } = parseArgs(process.argv.slice(2));
  if (!baseUrl) {
    process.stderr.write('Usage : node scripts/make-qr.js <url-de-base> [source ...] [--out dossier]\n');
    process.exit(1);
  }

  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    process.stderr.write('Refus : l\'URL doit être en https:// (un QR imprimé ne doit pas pointer vers du http).\n');
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
  for (const raw of sources.length > 0 ? sources : ['avenir-eco']) {
    const source = normalizeSource(raw);
    if (source === 'direct' && raw !== 'direct') {
      process.stderr.write(`Source invalide ignorée : « ${raw} » (minuscules, chiffres et tirets, 40 caractères max).\n`);
      continue;
    }
    const target = new URL('/', base);
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
