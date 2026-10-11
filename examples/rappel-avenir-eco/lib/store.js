'use strict';

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

async function append(file, record) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/**
 * Supprime les lignes plus anciennes que `days` (conservation limitée, RGPD).
 * Réécriture atomique : fichier temporaire puis rename.
 */
async function purgeOlderThan(file, days, now = Date.now()) {
  let content;
  try {
    content = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const cutoff = now - days * DAY_MS;
  const kept = [];
  let removed = 0;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let at = NaN;
    try {
      at = Date.parse(JSON.parse(line).createdAt);
    } catch (_error) {
      // ligne illisible : on la supprime plutôt que de la conserver indéfiniment
    }
    if (Number.isFinite(at) && at >= cutoff) kept.push(line);
    else removed += 1;
  }
  if (removed === 0) return 0;
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 });
  await fs.promises.rename(tmp, file);
  return removed;
}

module.exports = { append, purgeOlderThan };
