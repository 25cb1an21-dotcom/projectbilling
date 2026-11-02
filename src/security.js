'use strict';

const crypto = require('node:crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours; the UI also signs users out after 15 minutes of inactivity

/* ---------- passwords (scrypt, per-user random salt) ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------- signed tokens (HMAC-SHA256, similar to a minimal JWT) ---------- */

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function signToken(secret, payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(secret, token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

/* ---------- tiny in-memory rate limiter ---------- */

function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    /** Returns true if the action is allowed and counts it. */
    take(key) {
      const now = Date.now();
      const recent = (hits.get(key) || []).filter(time => now - time < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (!v.some(time => now - time < windowMs)) hits.delete(k);
      }
      return true;
    },
    /** True if the key is already at the limit, without counting. */
    blocked(key) {
      const now = Date.now();
      return (hits.get(key) || []).filter(time => now - time < windowMs).length >= max;
    },
    reset(key) { hits.delete(key); }
  };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, createRateLimiter, TOKEN_TTL_MS };
