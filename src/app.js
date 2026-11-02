'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { metaGet, metaSet, seedDefaults } = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken, createRateLimiter } = require('./security');
const store = require('./store');

const { HttpError } = store;
const MAX_BODY_BYTES = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

/** Creates the first accounts. Runs at every start but only inserts users that do not exist yet. */
function ensureUsers(db, env) {
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
  const add = (username, role, name, password) => {
    db.prepare(
      'INSERT OR IGNORE INTO users (username, display_name, role, password_hash, builtin, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(username.toLowerCase(), name, role, hashPassword(password), Date.now());
  };
  if (count === 0) {
    const username = env.OWNER_USERNAME || 'owner';
    const password = env.OWNER_PASSWORD || 'admin123';
    add(username, 'owner', env.OWNER_NAME || 'Owner', password);
    if (!env.OWNER_PASSWORD) {
      console.warn('[security] OWNER_PASSWORD is not set, so the owner account uses the default password "admin123". Set OWNER_PASSWORD (or change it) before going live.');
    }
  }
  if (String(env.SEED_DEMO_USERS).toLowerCase() === 'true') {
    add('cashier', 'cashier', 'Asha', 'cashier123');
    add('waiter', 'waiter', 'Arjun', 'waiter123');
    add('chef', 'chef', 'Ravi', 'chef123');
    console.warn('[security] Demo accounts (cashier/waiter/chef) are enabled. Turn off SEED_DEMO_USERS in production.');
  }
}

function getSecret(db, env) {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 16) return env.SESSION_SECRET;
  let secret = metaGet(db, 'session_secret');
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    metaSet(db, 'session_secret', secret);
  }
  return secret;
}

function createApp({ db, env = process.env, publicDir = path.join(__dirname, '..', 'public') }) {
  seedDefaults(db);
  ensureUsers(db, env);
  const secret = getSecret(db, env);
  const trustProxy = String(env.TRUST_PROXY).toLowerCase() === 'true';
  const corsOrigin = (env.CORS_ORIGIN || '').trim().replace(/\/$/, '');

  const loginFailuresByIp = createRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
  const loginFailuresByUser = createRateLimiter({ max: 6, windowMs: 15 * 60 * 1000 });
  const ordersByIp = createRateLimiter({ max: 30, windowMs: 60 * 60 * 1000 });
  const ratingsByIp = createRateLimiter({ max: 120, windowMs: 60 * 60 * 1000 });
  const dummyHash = hashPassword('not-a-real-password');

  const clientIp = req => {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  function send(req, res, status, payload, extraHeaders = {}) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new HttpError(413, 'Request is too large.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new HttpError(400, 'Request body must be valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  /** Works out who is calling from the Authorization header. Returns null for anonymous visitors. */
  function currentUser(req) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return null;
    const payload = verifyToken(secret, header.slice(7));
    if (!payload) return null;
    const row = db.prepare('SELECT username, display_name, role FROM users WHERE username = ?').get(payload.u);
    if (!row || row.role !== payload.r) return null; // removed or re-assigned accounts lose access immediately
    return { username: row.username, role: row.role, name: row.display_name };
  }

  function parseKnown(value) {
    const known = {};
    String(value || '').split(',').forEach(pair => {
      const [key, version] = pair.split(':');
      if (key && version !== undefined && Number.isFinite(Number(version))) known[key] = Number(version);
    });
    return known;
  }

  function parseMine(value) {
    return String(value || '').split(',').map(id => id.trim()).filter(id => /^\d{1,15}$/.test(id)).slice(0, 200);
  }

  async function handleApi(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    const user = currentUser(req);

    if (route === 'GET /api/health') return send(req, res, 200, { ok: true, time: Date.now() });

    if (route === 'POST /api/auth/login') {
      const ip = clientIp(req);
      const body = await readBody(req);
      const username = String(body.username || '').trim().toLowerCase().slice(0, 60);
      const password = String(body.password || '').slice(0, 200);
      const role = String(body.role || '');
      if (loginFailuresByIp.blocked(ip) || loginFailuresByUser.blocked(username)) {
        throw new HttpError(429, 'Too many failed sign-in attempts. Please wait 15 minutes and try again.');
      }
      const row = db.prepare('SELECT username, display_name, role, password_hash FROM users WHERE username = ?').get(username);
      const passwordOk = verifyPassword(password, row ? row.password_hash : dummyHash);
      if (!row || !passwordOk || row.role !== role) {
        loginFailuresByIp.take(ip);
        loginFailuresByUser.take(username);
        throw new HttpError(401, 'Username, password, or selected role is incorrect.');
      }
      loginFailuresByUser.reset(username);
      const token = signToken(secret, { u: row.username, r: row.role });
      return send(req, res, 200, { token, user: { username: row.username, role: row.role, name: row.display_name } });
    }

    if (route === 'GET /api/auth/me') {
      if (!user) throw new HttpError(401, 'Not signed in.');
      return send(req, res, 200, { user });
    }

    if (route === 'GET /api/store') {
      const state = store.readState(db, user, {
        known: parseKnown(url.searchParams.get('known')),
        mine: parseMine(url.searchParams.get('mine'))
      });
      return send(req, res, 200, state);
    }

    const storeMatch = url.pathname.match(/^\/api\/store\/([a-z0-9_]+)$/);
    if (storeMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
      const key = storeMatch[1];
      const body = await readBody(req);
      let result;
      if (req.method === 'PATCH') {
        result = key === 'rb_staff_users' ? store.patchStaff(db, user, body) : store.patchCollection(db, key, user, body);
      } else {
        result = store.putCollection(db, key, user, body);
      }
      return send(req, res, 200, result);
    }

    if (route === 'POST /api/orders') {
      if (!ordersByIp.take(clientIp(req))) throw new HttpError(429, 'Too many orders from this device. Please ask a staff member for help.');
      const result = store.createCustomerOrder(db, await readBody(req));
      return send(req, res, 201, result);
    }

    if (route === 'POST /api/ratings') {
      if (!ratingsByIp.take(clientIp(req))) throw new HttpError(429, 'Too many ratings. Please try again later.');
      return send(req, res, 200, store.rateDish(db, await readBody(req)));
    }

    throw new HttpError(404, 'Not found.');
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = '/'; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.normalize(path.join(publicDir, pathname));
    const relative = path.relative(publicDir, filePath);
    const hidden = relative.split(path.sep).some(part => part.startsWith('.'));
    if (relative.startsWith('..') || path.isAbsolute(relative) || hidden) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const ext = path.extname(filePath).toLowerCase();
      const isCode = ['.html', '.js', '.css', '.json'].includes(ext);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Cache-Control': isCode ? 'no-cache' : 'public, max-age=86400'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const url = new URL(req.url, 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');

    if (isApi && corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    }
    if (isApi && req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (!isApi) return serveStatic(req, res, url);

    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (error instanceof HttpError) return send(req, res, error.status, { error: error.message });
      console.error('Unexpected error:', error);
      return send(req, res, 500, { error: 'Something went wrong on the server.' });
    }
  };
}

module.exports = { createApp };
