'use strict';

/** Fenêtre glissante en mémoire : `max` requêtes par `windowMs` et par clé. */
function createRateLimiter({ max, windowMs }) {
  const hits = new Map();

  function allow(key, now = Date.now()) {
    if (hits.size > 1000) sweep(now);
    const recent = (hits.get(key) || []).filter(at => now - at < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  }

  function sweep(now = Date.now()) {
    for (const [key, list] of hits) {
      if (list.every(at => now - at >= windowMs)) hits.delete(key);
    }
  }

  return { allow, sweep };
}

module.exports = { createRateLimiter };
