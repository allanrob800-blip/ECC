#!/usr/bin/env node
'use strict';

/**
 * Génère le présentoir (recto avec QR code, verso avec le numéro du conseiller).
 *
 * Usage : node display/build.js "<url-du-QR>" [--out dossier] [--chrome /chemin/chrome]
 * Préparer d'abord les images : python3 display/prepare_assets.py <recto.jpg> <verso.jpg>
 * Sorties : presentoir.pdf (2 pages, 111 x 156 mm avec 3 mm de fond perdu), apercu-recto.png,
 * apercu-verso.png (format fini 105 x 150 mm) et qr.svg.
 * Dépendances : qrcode (déjà dans ce dossier) et playwright-core.
 */

const fs = require('fs');
const path = require('path');

const profile = { first: 'Allan', full: 'Allan Fix', title: 'Conseiller commercial', phone: '06 85 74 01 41' };

function parseArgs(argv) {
  const out = { url: null, out: path.join(__dirname, 'out'), chrome: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') { out.out = path.resolve(argv[i + 1]); i += 1; }
    else if (argv[i] === '--chrome') { out.chrome = argv[i + 1]; i += 1; }
    else out.url = argv[i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) throw new Error('Usage : node display/build.js "<url-du-QR>" [--out dossier]');
  const url = new URL(args.url);
  if (url.protocol !== 'https:') throw new Error('Le QR doit pointer vers une URL https://');

  const QRCode = require('qrcode');
  const { chromium } = require('playwright-core');

  // Modules noirs sur fond blanc, zone de silence de 4 modules (norme) intégrée au SVG.
  const qr = QRCode.create(url.toString(), { errorCorrectionLevel: 'M' });
  const svg = await QRCode.toString(url.toString(), {
    type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#0d0640', light: '#ffffff' }
  });
  const boxMm = 42; // doit rester égal à la largeur de .qrbox dans template.html
  const moduleMm = boxMm / (qr.modules.size + 8);
  process.stdout.write(`QR : ${qr.modules.size}x${qr.modules.size} modules, ${moduleMm.toFixed(2)} mm par module (minimum conseillé : 0,40 mm)\n`);
  if (moduleMm < 0.4) throw new Error('QR trop dense pour cette taille : raccourcir l\'URL.');

  const html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
    .replace('{{QR_SVG}}', svg.replace(/<\?xml[^>]*\?>/, ''))
    .replace('{{FIRST_NAME}}', profile.first)
    .replace('{{FULL_NAME}}', profile.full)
    .replace('{{TITLE}}', profile.title)
    .replace('{{PHONE_DISPLAY}}', profile.phone);

  fs.mkdirSync(args.out, { recursive: true });
  const htmlPath = path.join(__dirname, '.build.html');
  fs.writeFileSync(htmlPath, html);

  const browser = await chromium.launch({ executablePath: args.chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 590 }, deviceScaleFactor: 4 });
    await page.goto(`file://${htmlPath}`);
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: path.join(args.out, 'presentoir.pdf'), width: '111mm', height: '156mm', printBackground: true, preferCSSPageSize: true });
    // Aperçus recadrés au format fini (on retire les 3 mm de fond perdu).
    const mm = 96 / 25.4;
    for (const [index, name] of ['recto', 'verso'].entries()) {
      await page.screenshot({
        path: path.join(args.out, `apercu-${name}.png`),
        clip: { x: 3 * mm, y: index * 156 * mm + 3 * mm, width: 105 * mm, height: 150 * mm },
        fullPage: true
      });
    }
  } finally {
    await browser.close();
    fs.rmSync(htmlPath, { force: true });
  }
  fs.writeFileSync(path.join(args.out, 'qr.svg'), svg);
  process.stdout.write(`Fichiers écrits dans ${args.out}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
