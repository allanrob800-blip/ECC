#!/usr/bin/env node
'use strict';

/**
 * Génère le présentoir (recto avec QR code, verso avec le numéro du conseiller).
 *
 * Usage : node display/build.js "<url-du-QR>" [--out dossier] [--chrome /chemin/chrome]
 * Préparer d'abord les images : python3 display/prepare_assets.py <recto.jpg> <verso.jpg>
 * Sorties :
 *  - presentoir.pdf : 2 pages de 111 x 156 mm (105 x 150 mm + 3 mm de fond perdu), pour un imprimeur ;
 *  - presentoir-maison-A4.pdf : 2 pages A4, la carte à l'échelle 1:1 centrée, avec repères de coupe
 *    et une règle de contrôle de 10 cm, pour une impression à la maison ;
 *  - apercu-recto.png, apercu-verso.png (format fini 105 x 150 mm) et qr.svg.
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

// Géométrie de la version A4 (en mm) : carte de 111 x 156 mm (fond perdu inclus) centrée sur 210 x 297.
const A4 = { w: 210, h: 297, bleed: 3, trimW: 105, trimH: 150 };

function homeSheetHtml(html) {
  const left = (A4.w - (A4.trimW + 2 * A4.bleed)) / 2; // 49,5
  const top = (A4.h - (A4.trimH + 2 * A4.bleed)) / 2; // 70,5
  const x1 = left + A4.bleed; // bord gauche du format fini
  const x2 = x1 + A4.trimW;
  const y1 = top + A4.bleed;
  const y2 = y1 + A4.trimH;
  const gap = 4; // distance entre le repère et le format fini (le fond perdu occupe les 3 premiers mm)
  const len = 5;
  const marks = [
    // verticaux (au-dessus et au-dessous)
    [x1, y1 - gap - len, 0.3, len], [x2, y1 - gap - len, 0.3, len],
    [x1, y2 + gap, 0.3, len], [x2, y2 + gap, 0.3, len],
    // horizontaux (à gauche et à droite)
    [x1 - gap - len, y1, len, 0.3], [x2 + gap, y1, len, 0.3],
    [x1 - gap - len, y2, len, 0.3], [x2 + gap, y2, len, 0.3]
  ].map(([x, y, w, h]) => `<i class="mark" style="left:${(x - (w < h ? 0.15 : 0)).toFixed(2)}mm;top:${(y - (h < w ? 0.15 : 0)).toFixed(2)}mm;width:${w}mm;height:${h}mm"></i>`).join('');
  const scaleX = (A4.w - 100) / 2;
  const ruler = `<div class="ruler" style="left:${scaleX}mm;top:${y2 + 24}mm"></div><p class="note" style="top:${y2 + 28}mm">Contrôle d’échelle : ce trait doit mesurer exactement 10 cm (100 mm) sur votre impression.</p>`;
  const css = `
@page { size: ${A4.w}mm ${A4.h}mm; margin: 0; }
html, body { width: ${A4.w}mm; }
.sheet { position: relative; width: ${A4.w}mm; height: ${A4.h}mm; background: #fff; overflow: hidden; page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.sheet .page { position: absolute; left: ${left}mm; top: ${top}mm; page-break-after: auto; break-after: auto; }
.mark { position: absolute; background: #000; display: block; }
.note { position: absolute; left: 0; right: 0; text-align: center; font: 500 2.7mm "Poppins", sans-serif; color: #222; }
.ruler { position: absolute; width: 100mm; height: 0.3mm; background: #000; }
.ruler::before, .ruler::after { content: ""; position: absolute; top: -1.5mm; width: 0.3mm; height: 3.3mm; background: #000; }
.ruler::before { left: 0; } .ruler::after { right: 0; }
`;
  let index = 0;
  const wrapped = html.replace(/<section class="page (front|back)">([\s\S]*?)<\/section>/g, (_m, kind, inner) => {
    const label = kind === 'front' ? 'RECTO' : 'VERSO';
    const header = `<p class="note" style="top:14mm"><b>${label}</b> · Présentoir ${A4.trimW} × ${A4.trimH} mm · Imprimer à 100 % (taille réelle), sans « ajuster à la page » · Découper sur les repères</p>`;
    const duplex = index === 1 ? '<p class="note" style="top:19mm">Recto-verso : retourner la feuille sur le bord long. Sinon, coller les deux faces dos à dos.</p>' : '';
    index += 1;
    return `<div class="sheet">${header}${duplex}<section class="page ${kind}">${inner}</section>${marks}${ruler}</div>`;
  });
  return wrapped.replace('</style>', `${css}</style>`);
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
    const homePath = path.join(__dirname, '.build-home.html');
    fs.writeFileSync(homePath, homeSheetHtml(html));
    try {
      const home = await browser.newPage();
      await home.goto(`file://${homePath}`);
      await home.evaluate(() => document.fonts.ready);
      await home.pdf({ path: path.join(args.out, 'presentoir-maison-A4.pdf'), width: '210mm', height: '297mm', printBackground: true, preferCSSPageSize: true });
    } finally {
      fs.rmSync(homePath, { force: true });
    }
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
