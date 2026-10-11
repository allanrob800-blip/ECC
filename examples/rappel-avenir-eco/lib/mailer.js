'use strict';

const RESEND_URL = 'https://api.resend.com/emails';

function createResendMailer({ apiKey, from, timeoutMs = 8000, fetchImpl = fetch }) {
  return {
    name: 'resend',
    async send({ to, subject, text, html, replyTo }) {
      const response = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text, html, reply_to: replyTo }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`Resend HTTP ${response.status} ${detail}`);
      }
    }
  };
}

/** Mode développement : écrit l'e-mail sur la sortie standard, n'envoie rien. */
function createLogMailer(write = line => process.stdout.write(`${line}\n`)) {
  return {
    name: 'log',
    async send({ to, subject, text }) {
      write(`[mail:log] À: ${[].concat(to).join(', ')} | Objet: ${subject}\n${text}`);
    }
  };
}

function createMailer(config) {
  if (config.mailer === 'resend') {
    return createResendMailer({ apiKey: config.resendApiKey, from: config.mailFrom });
  }
  return createLogMailer();
}

/** Une nouvelle tentative après 1 s, puis abandon (l'erreur remonte). */
async function sendWithRetry(mailer, message, delayMs = 1000) {
  try {
    await mailer.send(message);
  } catch (_firstError) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await mailer.send(message);
  }
}

module.exports = { createMailer, createResendMailer, createLogMailer, sendWithRetry };
