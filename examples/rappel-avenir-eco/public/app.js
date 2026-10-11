/* global document */
(function () {
  'use strict';

  var form = document.getElementById('callback-form');
  var formPanel = document.getElementById('form-panel');
  var successPanel = document.getElementById('success-panel');
  var submit = document.getElementById('submit');
  var formError = document.getElementById('err-form');
  var mascot = document.getElementById('mascot');

  // Si l'image de la mascotte (hébergée par Octopus) est indisponible, on la masque proprement.
  mascot.addEventListener('error', function () { mascot.hidden = true; });

  var FIELDS = ['firstName', 'phone', 'email', 'consent'];

  function setError(name, message) {
    var node = document.getElementById('err-' + name);
    var input = form.elements[name];
    node.textContent = message || '';
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearErrors() {
    FIELDS.forEach(function (name) { setError(name, ''); });
    formError.textContent = '';
  }

  function showErrors(errors) {
    var first = null;
    FIELDS.forEach(function (name) {
      if (errors[name]) {
        setError(name, errors[name]);
        if (!first) first = form.elements[name];
      }
    });
    if (first) first.focus();
  }

  function clientCheck(data) {
    var errors = {};
    if (!data.firstName.trim()) errors.firstName = 'Indiquez votre prénom.';
    if (data.phone.replace(/[^\d+]/g, '').length < 9) errors.phone = 'Numéro de téléphone invalide.';
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.email = 'Adresse e-mail invalide.';
    if (!data.consent) errors.consent = 'Votre accord est nécessaire pour être rappelé(e).';
    return errors;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearErrors();

    var data = {
      firstName: form.elements.firstName.value,
      lastName: form.elements.lastName.value,
      phone: form.elements.phone.value,
      email: form.elements.email.value,
      slot: form.elements.slot.value,
      consent: form.elements.consent.checked,
      source: form.elements.source.value,
      website: form.elements.website.value
    };

    var errors = clientCheck(data);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Envoi en cours…';

    fetch('/api/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 201) {
          formPanel.hidden = true;
          successPanel.hidden = false;
          successPanel.focus();
          return;
        }
        if (result.body.errors) showErrors(result.body.errors);
        else formError.textContent = result.body.error || 'Une erreur est survenue. Réessayez ou appelez-moi directement.';
      })
      .catch(function () {
        formError.textContent = 'Connexion impossible. Vérifiez votre réseau ou appelez-moi directement.';
      })
      .then(function () {
        submit.disabled = false;
        submit.textContent = 'Me faire rappeler';
      });
  });
})();
