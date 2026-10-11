'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLead, normalizePhone, formatPhone, normalizeSource } = require('../lib/validate');

const valid = { firstName: 'Julie', phone: '06 12 34 56 78', consent: true };

test('normalizePhone accepte les formats français et les met en E.164', () => {
  assert.equal(normalizePhone('06 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('06.12.34.56.78'), '+33612345678');
  assert.equal(normalizePhone('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('0033612345678'), '+33612345678');
});

test('normalizePhone accepte un numéro étranger plausible', () => {
  assert.equal(normalizePhone('+32 470 12 34 56'), '+32470123456');
});

test('normalizePhone refuse les numéros invalides', () => {
  for (const bad of ['', '123', '0012', '06 12 34', 'abcdefghij', '+330612345678', null, 42]) {
    assert.equal(normalizePhone(bad), null, `devrait refuser ${bad}`);
  }
});

test('formatPhone met en forme un numéro français', () => {
  assert.equal(formatPhone('+33685740141'), '06 85 74 01 41');
  assert.equal(formatPhone('+32470123456'), '+32470123456');
});

test('validateLead accepte une demande minimale', () => {
  const result = validateLead(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    firstName: 'Julie', lastName: '', phone: '+33612345678', email: '', slot: 'asap', source: 'direct'
  });
});

test('validateLead exige prénom, téléphone valide et consentement', () => {
  const result = validateLead({ firstName: '  ', phone: '12', consent: false });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['consent', 'firstName', 'phone']);
});

test('validateLead refuse un consentement qui n\'est pas le booléen true', () => {
  for (const consent of ['true', 1, 'on', undefined]) {
    assert.equal(validateLead({ ...valid, consent }).ok, false);
  }
});

test('validateLead refuse un e-mail invalide mais accepte un e-mail absent', () => {
  assert.equal(validateLead({ ...valid, email: 'pas-un-email' }).errors.email !== undefined, true);
  assert.equal(validateLead({ ...valid, email: '  Julie@Exemple.FR ' }).value.email, 'julie@exemple.fr');
});

test('validateLead ignore un créneau inconnu et nettoie les caractères de contrôle', () => {
  const result = validateLead({ ...valid, slot: 'hack', firstName: 'Ju\nlie\u0000' });
  assert.equal(result.value.slot, 'asap');
  assert.equal(result.value.firstName, 'Ju lie');
});

test('validateLead tolère un corps non objet', () => {
  assert.equal(validateLead(null).ok, false);
  assert.equal(validateLead('texte').ok, false);
});

test('normalizeSource ne garde que des slugs sûrs', () => {
  assert.equal(normalizeSource('Avenir-Eco'), 'avenir-eco');
  assert.equal(normalizeSource('avenir-eco-rennes'), 'avenir-eco-rennes');
  assert.equal(normalizeSource('<script>'), 'direct');
  assert.equal(normalizeSource('../etc'), 'direct');
  assert.equal(normalizeSource(undefined), 'direct');
  assert.equal(normalizeSource('a'.repeat(41)), 'direct');
});
