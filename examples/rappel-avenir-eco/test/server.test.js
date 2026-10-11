'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../lib/config');
const { createApp, resolvePartner } = require('../server');
const store = require('../lib/store');

const ENV = {
  OWNER_EMAIL: 'allan@example.test',
  AVENIR_ECO_EMAIL: 'contact@avenir.test, second@avenir.test',
  MAILER: 'log'
};

function setup(envOverrides = {}, mailerOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rappel-'));
  const config = loadConfig({ ...ENV, DATA_FILE: path.join(dir, 'leads.jsonl'), ...envOverrides });
  const sent = [];
  const mailer = {
    async send(message) {
      if (mailerOverrides.failFor && mailerOverrides.failFor(message)) throw new Error('smtp down');
      sent.push(message);
    }
  };
  const server = createApp(config, { mailer });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, config, sent, dir, close: () => new Promise(done => server.close(done)) });
    });
  });
}

/** Chemin impossible à écrire : le « dossier » parent est un fichier ordinaire (ENOTDIR, immédiat). */
function unwritablePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rappel-ro-'));
  const blocker = path.join(dir, 'fichier');
  fs.writeFileSync(blocker, 'x');
  return path.join(blocker, 'leads.jsonl');
}

const lead = (extra = {}) => ({
  firstName: 'Julie', lastName: 'Martin', phone: '06 12 34 56 78', email: 'julie@example.test',
  slot: 'afternoon', consent: true, source: 'avenir-eco', website: '', ...extra
});

const post = (base, body, headers = {}) => fetch(`${base}/api/callback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

const readLines = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));

test('resolvePartner reconnaît la clé exacte et le préfixe, pas le reste', () => {
  const partners = { 'avenir-eco': { key: 'avenir-eco' } };
  assert.equal(resolvePartner('avenir-eco', partners).key, 'avenir-eco');
  assert.equal(resolvePartner('avenir-eco-rennes', partners).key, 'avenir-eco');
  assert.equal(resolvePartner('avenir-economie', partners), null);
  assert.equal(resolvePartner('direct', partners), null);
});

test('un lead Avenir Eco est enregistré et notifie le conseiller ET le partenaire', async () => {
  const ctx = await setup();
  try {
    const res = await post(ctx.base, lead());
    assert.equal(res.status, 201);

    const records = readLines(ctx.config.dataFile);
    assert.equal(records[0].type, 'lead');
    assert.equal(records[0].phone, '+33612345678');
    assert.equal(records[0].partner, 'avenir-eco');
    assert.deepEqual({ owner: records[1].owner, partner: records[1].partner }, { owner: 'sent', partner: 'sent' });

    const ownerMsg = ctx.sent.find(m => m.to.includes('allan@example.test'));
    const partnerMsg = ctx.sent.find(m => m.to.includes('contact@avenir.test'));
    assert.deepEqual(partnerMsg.to, ['contact@avenir.test', 'second@avenir.test']);
    assert.match(ownerMsg.text, /06 12 34 56 78/);
    assert.match(partnerMsg.text, /Julie/);
    assert.match(partnerMsg.subject, /Nouveau lead/);
  } finally {
    await ctx.close();
  }
});

test('le partenaire ne reçoit ni téléphone ni e-mail du client par défaut', async () => {
  const ctx = await setup();
  try {
    await post(ctx.base, lead());
    const partnerMsg = ctx.sent.find(m => m.to.includes('contact@avenir.test'));
    for (const part of [partnerMsg.text, partnerMsg.html]) {
      assert.doesNotMatch(part, /06 12 34 56 78|julie@example\.test|Martin/);
    }
  } finally {
    await ctx.close();
  }
});

test('PARTNER_SHARE_CONTACT=1 ajoute le téléphone dans le mail du partenaire', async () => {
  const ctx = await setup({ PARTNER_SHARE_CONTACT: '1' });
  try {
    await post(ctx.base, lead());
    const partnerMsg = ctx.sent.find(m => m.to.includes('contact@avenir.test'));
    assert.match(partnerMsg.text, /06 12 34 56 78/);
  } finally {
    await ctx.close();
  }
});

test('un lead sans origine partenaire ne notifie pas Avenir Eco', async () => {
  const ctx = await setup();
  try {
    assert.equal((await post(ctx.base, lead({ source: 'direct' }))).status, 201);
    assert.equal((await post(ctx.base, lead({ source: 'autre-stand' }))).status, 201);
    assert.equal(ctx.sent.filter(m => m.to.includes('contact@avenir.test')).length, 0);
    assert.equal(ctx.sent.length, 2);
  } finally {
    await ctx.close();
  }
});

test('le contenu saisi est échappé dans le HTML des e-mails', async () => {
  const ctx = await setup();
  try {
    await post(ctx.base, lead({ firstName: '<img src=x onerror=alert(1)>' }));
    const html = ctx.sent.map(m => m.html).join('');
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  } finally {
    await ctx.close();
  }
});

test('le champ piège renvoie un faux succès sans rien enregistrer ni envoyer', async () => {
  const ctx = await setup();
  try {
    const res = await post(ctx.base, lead({ website: 'http://spam.test' }));
    assert.equal(res.status, 201);
    assert.equal(fs.existsSync(ctx.config.dataFile), false);
    assert.equal(ctx.sent.length, 0);
  } finally {
    await ctx.close();
  }
});

test('une demande invalide renvoie 400 avec les erreurs par champ', async () => {
  const ctx = await setup();
  try {
    const res = await post(ctx.base, lead({ phone: '12', consent: false }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.deepEqual(Object.keys(body.errors).sort(), ['consent', 'phone']);
    assert.equal(ctx.sent.length, 0);
  } finally {
    await ctx.close();
  }
});

test('JSON invalide : 400 ; corps trop gros : 413 ; mauvaise méthode : 405', async () => {
  const ctx = await setup();
  try {
    assert.equal((await post(ctx.base, '{pas du json')).status, 400);
    assert.equal((await post(ctx.base, 'x'.repeat(20 * 1024)).catch(() => ({ status: 413 }))).status, 413);
    assert.equal((await fetch(`${ctx.base}/api/callback`)).status, 405);
  } finally {
    await ctx.close();
  }
});

test('limitation de débit : 429 après RATE_LIMIT_MAX demandes', async () => {
  const ctx = await setup({ RATE_LIMIT_MAX: '2' });
  try {
    assert.equal((await post(ctx.base, lead())).status, 201);
    assert.equal((await post(ctx.base, lead())).status, 201);
    assert.equal((await post(ctx.base, lead())).status, 429);
  } finally {
    await ctx.close();
  }
});

test('X-Forwarded-For n\'est pas pris en compte sans TRUST_PROXY (pas de contournement)', async () => {
  const ctx = await setup({ RATE_LIMIT_MAX: '1' });
  try {
    assert.equal((await post(ctx.base, lead(), { 'X-Forwarded-For': '1.1.1.1' })).status, 201);
    assert.equal((await post(ctx.base, lead(), { 'X-Forwarded-For': '2.2.2.2' })).status, 429);
  } finally {
    await ctx.close();
  }
});

test('si le mail du partenaire échoue, le lead reste enregistré et le client a un succès', async () => {
  const ctx = await setup({}, { failFor: m => m.to.includes('contact@avenir.test') });
  try {
    const res = await post(ctx.base, lead());
    assert.equal(res.status, 201);
    const status = readLines(ctx.config.dataFile)[1];
    assert.deepEqual({ owner: status.owner, partner: status.partner }, { owner: 'sent', partner: 'failed' });
  } finally {
    await ctx.close();
  }
});

test('si le stockage échoue mais que le mail au conseiller part, c\'est un succès', async () => {
  const ctx = await setup({ DATA_FILE: unwritablePath() });
  try {
    assert.equal((await post(ctx.base, lead())).status, 201);
    assert.equal(ctx.sent.some(m => m.to.includes('allan@example.test')), true);
  } finally {
    await ctx.close();
  }
});

test('si le stockage ET le mail au conseiller échouent : 500', async () => {
  const ctx = await setup({ DATA_FILE: unwritablePath() }, { failFor: () => true });
  try {
    assert.equal((await post(ctx.base, lead())).status, 500);
  } finally {
    await ctx.close();
  }
});

test('la page ne contient plus App, Chèque énergie, Fan club ni Je recommande', async () => {
  const ctx = await setup();
  try {
    const html = await (await fetch(`${ctx.base}/?src=avenir-eco`)).text();
    for (const banned of [/chèque énergie/i, /fan club/i, /je recommande/i, />\s*App\s*</, /typeform/i, /cagnotte/i, /40 €/]) {
      assert.doesNotMatch(html, banned);
    }
    assert.match(html, /Me faire rappeler/);
    assert.match(html, /name="source" value="avenir-eco"/);
    assert.match(html, /href="\/contact"/);
  } finally {
    await ctx.close();
  }
});

test('un src malveillant est neutralisé dans la page', async () => {
  const ctx = await setup();
  try {
    const html = await (await fetch(`${ctx.base}/?src=%22%3E%3Cscript%3Ealert(1)%3C/script%3E`)).text();
    assert.match(html, /name="source" value="direct"/);
    assert.doesNotMatch(html, /<script>alert/);
  } finally {
    await ctx.close();
  }
});

test('/contact redirige vers le lien vkard', async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.base}/contact`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://api.vkard.io/vcf/serve/44146dc1-7140-4653-b44b-bc7b1e1e5289/627b0e5c74');
  } finally {
    await ctx.close();
  }
});

test('en-têtes de sécurité, assets statiques, 404 et pas de traversée de répertoire', async () => {
  const ctx = await setup();
  try {
    const page = await fetch(ctx.base);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(`${ctx.base}/style.css`)).status, 200);
    assert.equal((await fetch(`${ctx.base}/app.js`)).status, 200);
    assert.equal((await fetch(`${ctx.base}/nimporte-quoi`)).status, 404);
    assert.equal((await fetch(`${ctx.base}/healthz`)).status, 200);
    const raw = await new Promise(resolve => {
      require('http').get({ host: '127.0.0.1', port: new URL(ctx.base).port, path: '/../server.js' }, res => resolve(res.statusCode));
    });
    assert.equal(raw, 404);
  } finally {
    await ctx.close();
  }
});

test('purgeOlderThan supprime les lignes de plus de N jours', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rappel-purge-'));
  const file = path.join(dir, 'leads.jsonl');
  const now = Date.parse('2026-10-11T12:00:00Z');
  await store.append(file, { type: 'lead', id: 'vieux', createdAt: '2025-01-01T00:00:00Z' });
  await store.append(file, { type: 'lead', id: 'recent', createdAt: '2026-09-01T00:00:00Z' });
  fs.appendFileSync(file, 'ligne illisible\n');
  assert.equal(await store.purgeOlderThan(file, 365, now), 2);
  assert.deepEqual(readLines(file).map(r => r.id), ['recent']);
  assert.equal(await store.purgeOlderThan(path.join(dir, 'absent.jsonl'), 365, now), 0);
});
