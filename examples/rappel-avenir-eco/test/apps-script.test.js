'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleEnvironment } = require('../scripts/gas-harness');

/** Environnement prêt à l'emploi : setup() exécuté, Sheet créé. */
function ready(options) {
  const gas = createGoogleEnvironment(options);
  gas.call('setup');
  return gas;
}

const lead = (extra = {}) => ({
  firstName: 'Julie', lastName: 'Martin', phone: '06 12 34 56 78', email: 'julie@example.test',
  slot: 'afternoon', consent: true, source: 'avenir-eco', website: '', ...extra
});

const mailsTo = (gas, address) => gas.state.sent.filter(m => m.to.split(',').includes(address));

// --- validation -------------------------------------------------------------

test('normalizePhone accepte les formats français et étrangers plausibles', () => {
  const gas = createGoogleEnvironment();
  for (const [input, expected] of [
    ['06 12 34 56 78', '+33612345678'], ['06.12.34.56.78', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'], ['0033612345678', '+33612345678'],
    ['+32 470 12 34 56', '+32470123456']
  ]) assert.equal(gas.call('normalizePhone', input), expected, input);
});

test('normalizePhone refuse les numéros invalides', () => {
  const gas = createGoogleEnvironment();
  for (const bad of ['', '123', '0012', '06 12 34', 'abcdefghij', '+330612345678', null, 42]) {
    assert.equal(gas.call('normalizePhone', bad), null, `devrait refuser ${bad}`);
  }
});

test('formatPhone met en forme un numéro français', () => {
  const gas = createGoogleEnvironment();
  assert.equal(gas.call('formatPhone', '+33685740141'), '06 85 74 01 41');
  assert.equal(gas.call('formatPhone', '+32470123456'), '+32470123456');
});

test('validateLead accepte une demande minimale et normalise les champs', () => {
  const gas = createGoogleEnvironment();
  const result = gas.call('validateLead', { firstName: ' Ju\nlie\u0000 ', phone: '06 12 34 56 78', consent: true, slot: 'hack', email: ' Julie@Exemple.FR ' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    firstName: 'Ju lie', lastName: '', phone: '+33612345678', email: 'julie@exemple.fr', slot: 'asap', source: 'direct'
  });
});

test('validateLead exige prénom, téléphone valide et consentement (booléen true uniquement)', () => {
  const gas = createGoogleEnvironment();
  const result = gas.call('validateLead', { firstName: '  ', phone: '12', consent: false });
  assert.deepEqual(Object.keys(result.errors).sort(), ['consent', 'firstName', 'phone']);
  for (const consent of ['true', 1, 'on', undefined]) {
    assert.equal(gas.call('validateLead', { firstName: 'A', phone: '0612345678', consent }).ok, false);
  }
  assert.equal(gas.call('validateLead', null).ok, false);
  assert.equal(gas.call('validateLead', { firstName: 'A', phone: '0612345678', consent: true, email: 'pas-un-email' }).errors.email !== undefined, true);
});

test('normalizeSource ne garde que des slugs sûrs', () => {
  const gas = createGoogleEnvironment();
  assert.equal(gas.call('normalizeSource', 'Avenir-Eco'), 'avenir-eco');
  for (const bad of ['<script>', '../etc', undefined, 'a'.repeat(41)]) assert.equal(gas.call('normalizeSource', bad), 'direct');
});

// --- traitement d'une demande ----------------------------------------------

test('un lead Avenir Eco est écrit dans le Sheet et notifie le conseiller ET le partenaire', () => {
  const gas = ready();
  assert.deepEqual(gas.call('submitCallback', lead()), { ok: true });

  const [header, row] = gas.leadsSheet().rows;
  assert.equal(header[0], 'Reçu le');
  assert.equal(row[1], 'Julie');
  assert.equal(row[3], '+33612345678');
  assert.equal(row[5], 'Cet après-midi (14h–17h)');
  assert.equal(row[7], 'avenir-eco');
  assert.deepEqual([row[9], row[10]], ['sent', 'sent']);
  assert.match(row[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);

  const owner = mailsTo(gas, 'allan@example.test')[0];
  const partner = mailsTo(gas, 'contact@avenir.test')[0];
  assert.match(owner.body, /06 12 34 56 78/);
  assert.equal(owner.replyTo, 'julie@example.test');
  assert.match(partner.subject, /Un client de votre stand veut être rappelé · Julie/);
  assert.equal(partner.replyTo, 'allan@example.test');
});

test('le partenaire ne reçoit ni téléphone ni e-mail ni nom du client par défaut', () => {
  const gas = ready();
  gas.call('submitCallback', lead());
  const partner = mailsTo(gas, 'contact@avenir.test')[0];
  for (const part of [partner.body, partner.htmlBody]) assert.doesNotMatch(part, /06 12 34 56 78|julie@example\.test|Martin/);
  assert.match(partner.body, /Julie/);
});

test('PARTNER_SHARE_CONTACT=1 ajoute téléphone et e-mail dans le mail du partenaire', () => {
  const gas = ready({ props: { PARTNER_SHARE_CONTACT: '1' } });
  gas.call('submitCallback', lead());
  assert.match(mailsTo(gas, 'contact@avenir.test')[0].body, /06 12 34 56 78/);
});

test('plusieurs adresses partenaire sont toutes destinataires du même message', () => {
  const gas = ready({ props: { AVENIR_ECO_EMAIL: 'a@avenir.test, b@avenir.test' } });
  gas.call('submitCallback', lead());
  assert.equal(gas.state.sent.find(m => m.to.includes('a@avenir.test')).to, 'a@avenir.test,b@avenir.test');
});

test('une source sans lien partenaire ne notifie pas Avenir Eco (et « avenir-economie » non plus)', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ source: 'direct', phone: '0611111111' }));
  gas.call('submitCallback', lead({ source: 'avenir-economie', phone: '0622222222' }));
  gas.call('submitCallback', lead({ source: 'avenir-eco-rennes', phone: '0633333333' }));
  assert.equal(mailsTo(gas, 'contact@avenir.test').length, 1);
  assert.equal(mailsTo(gas, 'allan@example.test').length, 3);
});

test('le contenu saisi est échappé dans le HTML des e-mails', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ firstName: '<img src=x onerror=alert(1)>' }));
  const html = gas.state.sent.map(m => m.htmlBody).join('');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('une valeur du type « =1+1 » est écrite dans une cellule au format texte (jamais évaluée)', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ firstName: '=HYPERLINK("http://x")' }));
  const sheet = gas.leadsSheet();
  assert.equal(sheet.rows[1][1], '=HYPERLINK("http://x")');
  assert.equal(sheet.formats[1], '@');
});

test('le champ piège donne un faux succès sans rien enregistrer ni envoyer', () => {
  const gas = ready();
  assert.deepEqual(gas.call('submitCallback', lead({ website: 'http://spam.test' })), { ok: true });
  assert.equal(gas.leadsSheet().rows.length, 1);
  assert.equal(gas.state.sent.length, 0);
});

test('une demande invalide renvoie les erreurs par champ sans rien envoyer', () => {
  const gas = ready();
  const result = gas.call('submitCallback', lead({ phone: '12', consent: false }));
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['consent', 'phone']);
  assert.equal(gas.state.sent.length, 0);
});

test('un double envoi du même numéro dans les 5 minutes ne crée qu\'un lead', () => {
  const gas = ready();
  assert.equal(gas.call('submitCallback', lead()).ok, true);
  assert.equal(gas.call('submitCallback', lead()).ok, true);
  assert.equal(gas.leadsSheet().rows.length, 2);
  assert.equal(mailsTo(gas, 'allan@example.test').length, 1);
});

test('plafond anti-flood : la 31e demande de la tranche de 10 minutes est refusée', () => {
  const gas = ready();
  for (let i = 0; i < 30; i += 1) {
    const phone = `06${String(10000000 + i)}`;
    assert.equal(gas.call('submitCallback', lead({ phone })).ok, true, `demande ${i + 1}`);
  }
  const refused = gas.call('submitCallback', lead({ phone: '0699999999' }));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Trop de demandes/);
});

// --- pannes -----------------------------------------------------------------

test('si le mail du partenaire échoue, le lead est gardé, le client a un succès et le statut est noté', () => {
  const gas = ready({ failMailFor: m => m.to.includes('contact@avenir.test') });
  assert.equal(gas.call('submitCallback', lead()).ok, true);
  const row = gas.leadsSheet().rows[1];
  assert.deepEqual([row[9], row[10]], ['sent', 'failed']);
  assert.equal(gas.state.logs.some(([level]) => level === 'error'), true);
});

test('si le Sheet est inaccessible mais que le mail au conseiller part, c\'est un succès', () => {
  const gas = ready();
  gas.state.failSheet = true;
  assert.equal(gas.call('submitCallback', lead()).ok, true);
  assert.equal(mailsTo(gas, 'allan@example.test').length, 1);
});

test('si le Sheet ET le mail au conseiller échouent : erreur claire pour le client', () => {
  const gas = ready({ failMailFor: () => true });
  gas.state.failSheet = true;
  const result = gas.call('submitCallback', lead());
  assert.equal(result.ok, false);
  assert.match(result.error, /Appelez-moi/);
});

test('quota d\'e-mails épuisé : lead enregistré, statut « failed », client informé du succès', () => {
  const gas = ready({ quota: 0 });
  assert.equal(gas.call('submitCallback', lead()).ok, true);
  assert.deepEqual([gas.leadsSheet().rows[1][9], gas.leadsSheet().rows[1][10]], ['failed', 'failed']);
});

test('adresse partenaire absente : lead enregistré, statut « no-address », pas d\'erreur', () => {
  const gas = ready({ props: { AVENIR_ECO_EMAIL: '' } });
  assert.equal(gas.call('submitCallback', lead()).ok, true);
  assert.equal(gas.leadsSheet().rows[1][10], 'no-address');
});

test('submitCallback ne lève jamais d\'exception vers la page (setup non lancé)', () => {
  const gas = createGoogleEnvironment();
  assert.equal(gas.call('submitCallback', lead()).ok, true, 'le mail au conseiller suffit');
  const broken = createGoogleEnvironment({ failMailFor: () => true });
  assert.equal(broken.call('submitCallback', lead()).ok, false);
});

// --- installation et maintenance ------------------------------------------------

test('setup() crée le Sheet une seule fois et refuse un OWNER_EMAIL manquant', () => {
  const gas = createGoogleEnvironment();
  gas.call('setup');
  const id = gas.state.props.SHEET_ID;
  assert.ok(id);
  assert.equal(gas.leadsSheet().name, 'Leads');
  assert.equal(gas.leadsSheet().rows[0].length, 12);
  gas.call('setup');
  assert.equal(gas.state.props.SHEET_ID, id);
  assert.equal(gas.state.spreadsheets.size, 1);

  const empty = createGoogleEnvironment({ props: { OWNER_EMAIL: '' } });
  assert.throws(() => empty.call('setup'), /OWNER_EMAIL/);
});

test('purgeOldLeads supprime les leads de plus de 12 mois et les lignes illisibles', () => {
  const gas = ready();
  const sheet = gas.leadsSheet();
  const recent = new Date(Date.now() - 30 * 86400000).toISOString();
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  sheet.rows.push([old, 'Vieux'], [recent, 'Récent'], ['pas une date', 'Illisible']);
  assert.equal(gas.call('purgeOldLeads'), 2);
  assert.deepEqual(sheet.rows.map(r => r[1]), ['Prénom', 'Récent']);
});

test('installPurgeTrigger est idempotent', () => {
  const gas = ready();
  gas.call('installPurgeTrigger');
  gas.call('installPurgeTrigger');
  assert.equal(gas.state.triggers.length, 1);
  assert.deepEqual(gas.state.triggers[0].spec, { everyDays: 1, atHour: 3 });
});

test('sendTestEmails envoie des mails [TEST] au conseiller et au partenaire', () => {
  const gas = ready();
  gas.call('sendTestEmails');
  assert.equal(mailsTo(gas, 'allan@example.test')[0].subject.startsWith('[TEST]'), true);
  assert.equal(mailsTo(gas, 'contact@avenir.test')[0].subject.startsWith('[TEST]'), true);
});

test('les dates des e-mails sont en français, fuseau Paris', () => {
  const gas = createGoogleEnvironment();
  const mail = gas.call('buildOwnerMail', {
    firstName: 'A', lastName: '', phone: '+33612345678', email: '', slot: 'asap', source: 'direct',
    createdAt: '2026-10-11T12:37:00+02:00'
  }, null);
  assert.match(mail.text, /Reçu le : dimanche 11 octobre 2026 à 12:37/);
});

// --- page ---------------------------------------------------------------------

test('la page contient « Me faire rappeler », le lien vCard direct et plus rien d\'Octopus-annexe', () => {
  const gas = createGoogleEnvironment();
  const page = gas.page('avenir-eco');
  assert.equal(page.title, 'Octopus Energy · Allan Fix');
  assert.equal(page.meta.viewport, 'width=device-width, initial-scale=1');
  assert.match(page.html, /Me faire rappeler/);
  assert.match(page.html, /name="source" value="avenir-eco"/);
  assert.match(page.html, /href="https:\/\/api\.vkard\.io\/vcf\/serve\/44146dc1-7140-4653-b44b-bc7b1e1e5289\/627b0e5c74"/);
  for (const banned of [/chèque énergie/i, /fan club/i, /je recommande/i, />\s*App\s*</, /typeform/i, /cagnotte/i, /40 €/, /souscri/i, /<\?/]) {
    assert.doesNotMatch(page.html, banned);
  }
});

test('format téléphone : bouton principal collé en bas, créneaux en gros boutons, champs facultatifs repliés', () => {
  const gas = createGoogleEnvironment();
  const { html } = gas.page();
  assert.match(html, /<div class="bar" id="bar">\s*<button class="btn btn-primary" type="submit" form="callback-form"/);
  assert.equal([...html.matchAll(/<input type="radio" name="slot"/g)].length, 4);
  assert.match(html, /<details class="more" id="more">/);
  assert.match(html, /<input id="phone"[^>]*type="tel"[^>]*inputmode="tel"/);
  assert.match(html, /position: sticky;\s*bottom: 0;/);
  assert.doesNotMatch(html, /<select/);
});

test('tous les liens de la page ont une cible compatible avec le bac à sable (_top ou _blank)', () => {
  const gas = createGoogleEnvironment();
  const { html } = gas.page();
  assert.match(html, /<base target="_top">/);
  for (const [tag] of html.matchAll(/<a\s[^>]*>/g)) assert.match(tag, /target="_(top|blank)"/, tag);
});

test('un src malveillant est neutralisé et VCARD_URL remplace le lien par défaut', () => {
  const gas = createGoogleEnvironment({ props: { VCARD_URL: 'https://exemple.test/ma-fiche.vcf' } });
  const { html } = gas.page('"><script>alert(1)</script>');
  assert.match(html, /name="source" value="direct"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /href="https:\/\/exemple\.test\/ma-fiche\.vcf"/);
});

// --- partenaire : logo et mention ---------------------------------------------

const EMBEDDED_LOGO = /<img id="partner-logo" src="data:image\/jpeg;base64,[A-Za-z0-9+/=]{2000,}" alt="Avenir Eco">/;

test('sur un QR Avenir Eco : logo intégré, mention « En partenariat avec » et nom cité dans le texte d\'introduction', () => {
  const { html } = createGoogleEnvironment().page('avenir-eco');
  assert.match(html, /En partenariat avec/);
  assert.match(html, EMBEDDED_LOGO);
  assert.match(html, /<p class="lead">Vous êtes chez <strong>Avenir Eco<\/strong>\. Je ne suis pas disponible/);
  assert.match(html, /Avenir Eco, chez qui vous avez scanné ce code, est informé/);
});

test('une source préfixée (avenir-eco-rennes) affiche aussi le partenaire', () => {
  assert.match(createGoogleEnvironment().page('avenir-eco-rennes').html, /En partenariat avec/);
});

test('accès direct, source inconnue ou « avenir-economie » : aucune trace d\'Avenir Eco sur la page', () => {
  for (const src of [undefined, 'direct', 'autre-stand', 'avenir-economie', '"><b>']) {
    const { html: full } = createGoogleEnvironment().page(src);
    const html = full.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(html, /Avenir Eco|partner-logo|En partenariat/, `src=${src}`);
    assert.match(html, /<p class="lead">Je ne suis pas disponible pour l'instant/);
    assert.doesNotMatch(html, /est informé qu'une demande/);
  }
});

test('AVENIR_ECO_LOGO_URL remplace le logo ; une valeur non https ou dangereuse est ignorée', () => {
  const good = createGoogleEnvironment({ props: { AVENIR_ECO_LOGO_URL: 'https://exemple.test/logo.png' } });
  assert.match(good.page('avenir-eco').html, /<img id="partner-logo" src="https:\/\/exemple\.test\/logo\.png" alt="Avenir Eco">/);
  for (const bad of ['http://exemple.test/logo.png', 'javascript:alert(1)', 'https://x.test/a" onerror="alert(1)', 'data:image/svg+xml,<svg>']) {
    const html = createGoogleEnvironment({ props: { AVENIR_ECO_LOGO_URL: bad } }).page('avenir-eco').html;
    assert.match(html, EMBEDDED_LOGO, bad);
    assert.doesNotMatch(html, /onerror=/);
  }
});

test('le logo intégré est léger (page rapide en 4G) et l\'image est un vrai JPEG', () => {
  const gas = createGoogleEnvironment();
  const data = require('node:vm').runInContext('AVENIR_ECO_LOGO_DATA_URI', gas.context);
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  assert.ok(bytes.length < 20000, `${bytes.length} octets`);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test('le partenaire reste notifié par e-mail (la page affichée n\'a pas changé la logique)', () => {
  const gas = ready();
  gas.call('submitCallback', lead());
  assert.equal(mailsTo(gas, 'contact@avenir.test').length, 1);
});

test('aucun lien ne pousse le client à souscrire seul : ni sur la page, ni dans la confirmation (le lead doit rester attribué)', () => {
  for (const src of [undefined, 'avenir-eco']) {
    const { html } = createGoogleEnvironment().page(src);
    assert.doesNotMatch(html, /souscri|octopusenergy\.fr\/(souscription|offre)|minutes chrono/i, `src=${src}`);
    const success = html.slice(html.indexOf('id="success-panel"'), html.indexOf('<div class="bar"'));
    assert.equal([...success.matchAll(/<a\s/g)].length, 0, 'la confirmation ne contient aucun lien');
  }
});

// --- e-mails : fond et forme --------------------------------------------------

const ownerOf = gas => gas.state.sent.find(m => m.to.includes('allan@example.test'));
const partnerOf = gas => gas.state.sent.find(m => m.to.includes('contact@avenir.test'));
const keys = images => JSON.parse(JSON.stringify(Object.keys(images || {}))).sort();

test('objets et noms d\'expéditeur : le prénom et le créneau se lisent avant d\'ouvrir', () => {
  const gas = ready();
  gas.call('submitCallback', lead());
  gas.call('submitCallback', lead({ source: 'direct', phone: '0611111111', slot: 'asap' }));
  const [viaPartner, direct] = gas.state.sent.filter(m => m.to.includes('allan@example.test'));
  assert.equal(viaPartner.subject, '🔥 Nouveau lead via Avenir Eco · Julie · cet après-midi');
  assert.equal(direct.subject, '🔥 Nouveau lead · Julie · dès que possible');
  assert.equal(viaPartner.name, 'Octopus Rappel');
  assert.equal(partnerOf(gas).name, 'Allan Fix · Octopus Energy');
});

test('e-mail du conseiller : créneau en évidence, numéro cliquable, boutons Appeler / SMS / Écrire', () => {
  const gas = ready();
  gas.call('submitCallback', lead());
  const { htmlBody, body } = ownerOf(gas);
  assert.match(htmlBody, /À RAPPELER/);
  assert.match(htmlBody, /Cet après-midi · 14h–17h/);
  assert.match(htmlBody, /href="tel:\+33612345678"[^>]*>06 12 34 56 78</);
  assert.match(htmlBody, /Appeler Julie/);
  assert.match(htmlBody, /href="mailto:julie@example\.test"/);
  const sms = /href="(sms:\+33612345678\?&body=[^"]+)"/.exec(htmlBody);
  assert.ok(sms, 'lien SMS présent');
  assert.equal(decodeURIComponent(sms[1].split('&body=')[1]),
    'Bonjour Julie, c\'est Allan d\'Octopus Energy. Je viens d\'essayer de vous joindre suite à votre demande de rappel. Quand puis-je vous appeler ?');
  assert.match(htmlBody, /via le stand/);
  assert.match(body, /À rappeler : Cet après-midi · 14h–17h/);
  assert.match(body, /Julie Martin : 06 12 34 56 78/);
  assert.doesNotMatch(htmlBody + body, /Référence|Réf\./);
});

test('sans e-mail du client : pas de ligne E-mail ni de bouton « Écrire », le SMS reste', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ email: '' }));
  const { htmlBody, body } = ownerOf(gas);
  assert.doesNotMatch(htmlBody, /mailto:|Écrire/);
  assert.match(htmlBody, /SMS prérempli/);
  assert.match(body, /E-mail : non renseigné/);
});

test('accès direct : pas de mention « via le stand » ni de logo partenaire dans l\'e-mail du conseiller', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ source: 'direct' }));
  const message = ownerOf(gas);
  assert.doesNotMatch(message.htmlBody, /via le stand|cid:avenir/);
  assert.match(message.htmlBody, /Accès direct/);
  assert.deepEqual(keys(message.inlineImages), ['mascot']);
});

test('e-mail du partenaire : prénom et créneau, jamais les coordonnées du client, numéro d\'Allan pour le joindre', () => {
  const gas = ready();
  gas.call('submitCallback', lead());
  const { htmlBody, body } = partnerOf(gas);
  for (const text of [htmlBody, body]) {
    assert.doesNotMatch(text, /06 12 34 56 78|\+33612345678|julie@example\.test|Martin/);
    assert.match(text, /Julie/);
    assert.match(text, /Cet après-midi \(14h–17h\)/);
  }
  assert.match(htmlBody, /href="tel:\+33685740141"/);
  assert.match(htmlBody, /06 85 74 01 41/);
  assert.match(htmlBody, /Rien à faire de votre côté/);
  assert.match(htmlBody, /ses coordonnées ne sont pas transmises/);
  assert.doesNotMatch(htmlBody + body, /Référence|Réf\./);
});

test('PARTNER_SHARE_CONTACT=1 : téléphone et e-mail du client ajoutés, la mention de confidentialité disparaît', () => {
  const gas = ready({ props: { PARTNER_SHARE_CONTACT: '1' } });
  gas.call('submitCallback', lead());
  const { htmlBody } = partnerOf(gas);
  assert.match(htmlBody, /06 12 34 56 78/);
  assert.match(htmlBody, /julie@example\.test/);
  assert.doesNotMatch(htmlBody, /ne sont pas transmises/);
});

test('images : jamais d\'URI « data: » dans l\'e-mail (Gmail les bloque), et chaque cid: a son image JPEG ou PNG', () => {
  const gas = ready();
  gas.call('submitCallback', lead());
  for (const message of [ownerOf(gas), partnerOf(gas)]) {
    assert.doesNotMatch(message.htmlBody, /src="data:/);
    const used = [...message.htmlBody.matchAll(/src="cid:([a-z]+)"/g)].map(m => m[1]);
    assert.ok(used.length > 0);
    for (const cid of used) {
      const blob = message.inlineImages[cid];
      assert.ok(blob, `image ${cid} fournie`);
      const head = [...blob.bytes.subarray(0, 4)];
      assert.ok((head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50), `${cid} est un JPEG ou un PNG`);
      assert.ok(blob.bytes.length < 40000, `${cid} reste légère`);
    }
  }
  assert.deepEqual(keys(ownerOf(gas).inlineImages), ['avenir', 'mascot']);
  assert.deepEqual(keys(partnerOf(gas).inlineImages), ['avenir', 'wordmark']);
});

test('sans le fichier OctopusAssets.gs : pas d\'image cassée, « Octopus Energy » en texte, le logo partenaire reste', () => {
  const gas = createGoogleEnvironment({ skipFiles: ['OctopusAssets.gs'] });
  gas.call('setup');
  gas.call('submitCallback', lead());
  const owner = ownerOf(gas);
  const partner = partnerOf(gas);
  assert.doesNotMatch(owner.htmlBody, /cid:mascot/);
  assert.doesNotMatch(partner.htmlBody, /cid:wordmark/);
  assert.match(partner.htmlBody, />Octopus Energy</);
  assert.deepEqual(keys(owner.inlineImages), ['avenir']);
  assert.deepEqual(keys(partner.inlineImages), ['avenir']);
});

test('tout ce qui vient du client est échappé dans les e-mails (nom, e-mail)', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ firstName: '<img src=x onerror=alert(1)>', lastName: '"><script>x</script>' }));
  for (const message of gas.state.sent) {
    assert.doesNotMatch(message.htmlBody, /<img src=x|<script>x/);
  }
  assert.match(ownerOf(gas).htmlBody, /&lt;img src=x/);
});

// --- conseiller Avenir Eco cité par le client (facultatif) ---------------------------

const advisorChips = html => [...html.matchAll(/<input type="radio" name="advisor" value="([^"]*)"/g)].map(m => m[1]);

test('sur un QR Avenir Eco : le champ propose Nicolas, Thierry, Julien, « Un autre conseiller » et « Non », ce dernier par défaut', () => {
  const { html } = createGoogleEnvironment().page('avenir-eco');
  assert.deepEqual(advisorChips(html), ['Nicolas', 'Thierry', 'Julien', 'autre', '']);
  assert.match(html, /Un conseiller Avenir Eco vous en a parlé \?/);
  assert.match(html, /<input type="radio" name="advisor" value="" checked>/);
});

test('accès direct ou autre source : aucun champ « conseiller »', () => {
  for (const src of [undefined, 'direct', 'autre-stand']) {
    assert.deepEqual(advisorChips(createGoogleEnvironment().page(src).html), [], `src=${src}`);
  }
});

test('AVENIR_ECO_REPS remplace la liste ; doublons, vides et mot réservé « autre » écartés, noms échappés', () => {
  const gas = createGoogleEnvironment({ props: { AVENIR_ECO_REPS: ' Marc, sophie ,Marc,, AUTRE, <b>Léa</b> ' } });
  const html = gas.page('avenir-eco').html;
  assert.deepEqual(advisorChips(html), ['Marc', 'sophie', '&lt;b&gt;Léa&lt;/b&gt;', 'autre', '']);
  assert.doesNotMatch(html, /<b>Léa<\/b>/);
});

test('liste vide dans AVENIR_ECO_REPS : retour à la liste par défaut', () => {
  const gas = createGoogleEnvironment({ props: { AVENIR_ECO_REPS: ' , ,' } });
  assert.deepEqual(advisorChips(gas.page('avenir-eco').html), ['Nicolas', 'Thierry', 'Julien', 'autre', '']);
});

test('conseiller choisi : écrit dans le Sheet, cité dans l\'e-mail du conseiller et dans celui du partenaire', () => {
  const gas = ready();
  assert.equal(gas.call('submitCallback', lead({ advisor: 'Thierry' })).ok, true);
  const row = gas.leadsSheet().rows[1];
  assert.equal(gas.leadsSheet().rows[0][8], 'Conseiller cité');
  assert.equal(row[8], 'Thierry');
  const owner = ownerOf(gas);
  assert.match(owner.htmlBody, /A échangé avec<\/td>[^]*?Thierry \(Avenir Eco\)/);
  assert.match(owner.body, /A échangé avec : Thierry \(Avenir Eco\)/);
  const partner = partnerOf(gas);
  assert.match(partner.htmlBody, /Conseiller cité<\/td>[^]*?>Thierry</);
  assert.match(partner.htmlBody, /indique avoir échangé avec <b>Thierry<\/b>, de votre équipe/);
  assert.match(partner.body, /indique avoir échangé avec Thierry, de votre équipe/);
});

test('« Un autre conseiller » : libellé neutre partout, sans nom inventé', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ advisor: 'autre' }));
  assert.equal(gas.leadsSheet().rows[1][8], 'Un autre conseiller');
  assert.match(ownerOf(gas).htmlBody, /Un conseiller Avenir Eco/);
  assert.match(partnerOf(gas).htmlBody, /indique avoir échangé avec un conseiller, de votre équipe/);
});

test('sans conseiller cité : ni ligne ni phrase supplémentaire dans les e-mails, cellule vide', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ advisor: '' }));
  assert.equal(gas.leadsSheet().rows[1][8], '');
  assert.doesNotMatch(ownerOf(gas).htmlBody + ownerOf(gas).body, /A échangé avec/);
  assert.doesNotMatch(partnerOf(gas).htmlBody + partnerOf(gas).body, /Conseiller cité|indique avoir échangé/);
});

test('le conseiller cité est validé côté serveur : texte libre, nom hors liste et source directe sont ignorés', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ advisor: '<script>alert(1)</script>', phone: '0611111111' }));
  gas.call('submitCallback', lead({ advisor: 'Marc', phone: '0622222222' }));
  gas.call('submitCallback', lead({ advisor: 'Thierry', source: 'direct', phone: '0633333333' }));
  gas.call('submitCallback', lead({ advisor: { nom: 'Thierry' }, phone: '0644444444' }));
  const rows = gas.leadsSheet().rows.slice(1);
  assert.deepEqual(rows.map(r => r[8]), ['', '', '', '']);
  assert.doesNotMatch(gas.state.sent.map(m => m.htmlBody).join(''), /<script>alert|A échangé avec|Conseiller cité/);
});

test('un conseiller cité ne change pas ce que reçoit le partenaire : toujours aucune coordonnée du client', () => {
  const gas = ready();
  gas.call('submitCallback', lead({ advisor: 'Julien' }));
  const partner = partnerOf(gas);
  for (const text of [partner.htmlBody, partner.body]) assert.doesNotMatch(text, /06 12 34 56 78|julie@example\.test|Martin/);
});

test('page : le choix du conseiller est envoyé avec le formulaire', () => {
  const { html } = createGoogleEnvironment().page('avenir-eco');
  assert.match(html, /advisor: form\.elements\.advisor \? form\.elements\.advisor\.value : ''/);
});

test('setup() met à jour un ancien Sheet : colonne « Conseiller cité » insérée, leads existants conservés, idempotent', () => {
  const gas = createGoogleEnvironment();
  const old = gas.context.SpreadsheetApp.create('ancien');
  old.sheet.setName('Leads');
  old.sheet.rows.push(
    ['Reçu le', 'Prénom', 'Nom', 'Téléphone', 'E-mail', 'Créneau', 'Source', 'Partenaire', 'Mail conseiller', 'Mail partenaire', 'ID'],
    ['2026-10-11T12:37:00+02:00', 'Julie', 'Martin', '+33612345678', '', 'Dès que possible', 'avenir-eco', 'avenir-eco', 'sent', 'sent', 'abc']
  );
  gas.state.props.SHEET_ID = old.getId();
  gas.call('setup');
  const [header, lead] = old.sheet.rows;
  assert.equal(header.length, 12);
  assert.equal(header[8], 'Conseiller cité');
  assert.equal(header[9], 'Mail conseiller');
  assert.deepEqual([lead[1], lead[8], lead[9], lead[10], lead[11]], ['Julie', '', 'sent', 'sent', 'abc']);
  gas.call('setup');
  assert.equal(old.sheet.rows[0].length, 12, 'une seconde exécution ne change rien');
  assert.equal(gas.call('submitCallback', { firstName: 'Paul', phone: '0644444444', consent: true, source: 'avenir-eco', advisor: 'Julien' }).ok, true);
  assert.equal(old.sheet.rows[2][8], 'Julien');
  assert.deepEqual([old.sheet.rows[2][9], old.sheet.rows[2][10]], ['sent', 'sent']);
});
