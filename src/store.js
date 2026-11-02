'use strict';

const { kvGet, kvSet, transaction } = require('./db');
const { hashPassword } = require('./security');
const { PRIZES } = require('./defaults');
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ROLES = ['owner', 'cashier', 'waiter', 'chef'];
const PAYMENT_METHODS = ['after-delivery', 'UPI', 'Card'];

/* ---------- small validators ---------- */

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function text(value, label, { min = 0, max = 200, required = false } = {}) {
  const str = value === undefined || value === null ? '' : String(value).trim();
  if (required && !str) throw new HttpError(400, `${label} is required.`);
  if (str.length < min || str.length > max) throw new HttpError(400, `${label} must be ${min}-${max} characters.`);
  return str;
}

function number(value, label, { min = 0, max = 1e7, integer = false } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max || (integer && !Number.isInteger(num))) {
    throw new HttpError(400, `${label} must be a ${integer ? 'whole ' : ''}number between ${min} and ${max}.`);
  }
  return num;
}

function sizeLimit(value, bytes, label) {
  if (Buffer.byteLength(JSON.stringify(value)) > bytes) throw new HttpError(400, `${label} is too large.`);
}

function safeUrl(value) {
  const url = text(value, 'Image', { max: 2000 });
  if (!url) return '';
  if (!/^(https?:\/\/|\/|images\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(url)) {
    throw new HttpError(400, 'Image must be an http(s) link or an uploaded image.');
  }
  return url;
}

/* ---------- per-item validators for each collection ---------- */

function validateMenuItem(raw) {
  if (!isPlainObject(raw)) throw new HttpError(400, 'Menu item must be an object.');
  const item = {
    id: number(raw.id, 'Menu item id', { min: 1, max: 1e15 }),
    n: text(raw.n, 'Dish name', { min: 1, max: 80, required: true }),
    c: text(raw.c, 'Category', { min: 1, max: 40, required: true }),
    p: number(raw.p, 'Price', { min: 0, max: 100000 }),
    e: text(raw.e, 'Emoji', { max: 16 })
  };
  const img = safeUrl(raw.img);
  if (img) item.img = img;
  sizeLimit(item, 400000, 'Menu item');
  return item;
}

function validateOrder(raw) {
  if (!isPlainObject(raw)) throw new HttpError(400, 'Order must be an object.');
  number(raw.id, 'Order id', { min: 1, max: 1e15 });
  text(raw.table, 'Table', { min: 1, max: 10, required: true });
  if (!Array.isArray(raw.items) || raw.items.length > 100) throw new HttpError(400, 'Order items are invalid.');
  raw.items.forEach(line => {
    if (!isPlainObject(line)) throw new HttpError(400, 'Order item is invalid.');
    number(line.p, 'Item price', { min: 0, max: 100000 });
    number(line.q, 'Item quantity', { min: 1, max: 999, integer: true });
    text(line.n, 'Item name', { min: 1, max: 80, required: true });
  });
  sizeLimit(raw, 30000, 'Order');
  return raw;
}

function validateTable(raw) {
  if (!isPlainObject(raw)) throw new HttpError(400, 'Table must be an object.');
  const status = raw.status === 'occupied' ? 'occupied' : 'free';
  return { number: text(raw.number, 'Table number', { min: 1, max: 10, required: true }), status };
}

function validateSplitBill(raw) {
  if (!isPlainObject(raw) || !raw.id || raw.orderId === undefined || !Array.isArray(raw.invoices) || !raw.invoices.length) {
    throw new HttpError(400, 'Split bill is missing its order or invoices.');
  }
  sizeLimit(raw, 100000, 'Split bill');
  return raw;
}

function validateContact(raw) {
  if (!isPlainObject(raw)) throw new HttpError(400, 'Contact details must be an object.');
  const walk = (value, depth = 0) => {
    if (depth > 3) throw new HttpError(400, 'Contact details are too deeply nested.');
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [text(k, 'Field', { max: 40 }), walk(v, depth + 1)]));
    return text(value, 'Contact value', { max: 300 });
  };
  return walk(raw);
}

function validateSettings(raw) {
  if (!isPlainObject(raw)) throw new HttpError(400, 'Settings must be an object.');
  // The old "owner password" setting is intentionally dropped: logins are handled by the server now.
  return {
    name: text(raw.name, 'Restaurant name', { min: 1, max: 80, required: true }),
    gst: number(raw.gst === undefined ? 5 : raw.gst, 'GST rate', { min: 0, max: 50 }),
    gstin: text(raw.gstin, 'GSTIN', { max: 30 })
  };
}

/* ---------- collection definitions ---------- */

const STAFF_ROLES = ROLES;

const COLLECTIONS = {
  rb_menu: { kind: 'array', idField: 'id', read: 'public', write: ['owner'], remove: ['owner'], validate: validateMenuItem },
  // Anyone may read orders, but visitors who are not signed in only receive the orders they ask for by number (see readCollection).
  rb_orders: { kind: 'array', idField: 'id', read: 'public', write: STAFF_ROLES, remove: ['owner'], validate: validateOrder },
  rb_tables: { kind: 'array', idField: 'number', read: STAFF_ROLES, write: STAFF_ROLES, remove: STAFF_ROLES, validate: validateTable },
  rb_split_bills_v1: { kind: 'array', idField: 'id', read: ['owner', 'cashier'], write: ['owner', 'cashier'], remove: ['owner'], validate: validateSplitBill },
  rb_contact_details: { kind: 'object', read: 'public', write: ['owner'], validate: validateContact },
  rb_set: { kind: 'object', read: 'public', write: ['owner'], validate: validateSettings },
  rb_food_ratings: { kind: 'object', read: 'public', write: [] }, // changed only through /api/ratings
  rb_staff_users: { kind: 'staff', read: ['owner'], write: ['owner'] }
};

const roleAllowed = (rule, user) => rule === 'public' || (!!user && rule.includes(user.role));

/* ---------- reading ---------- */

function staffList(db) {
  return db.prepare('SELECT username, display_name, role FROM users WHERE builtin = 0 ORDER BY created_at')
    .all()
    .map(row => ({ username: row.username, role: row.role, name: row.display_name }));
}

function builtinUsernames(db) {
  return db.prepare('SELECT username FROM users WHERE builtin = 1').all().map(row => row.username);
}

/** Returns { version, value } for a key as the given user may see it, or null if they may not read it. */
function readCollection(db, key, user, mine = []) {
  const def = COLLECTIONS[key];
  if (!def || !roleAllowed(def.read, user)) return null;
  const row = kvGet(db, key) || { value: def.kind === 'array' ? [] : {}, version: 0 };
  let value = row.value;
  if (key === 'rb_orders' && !user) {
    const ids = new Set(mine.map(String));
    value = value.filter(order => ids.has(String(order.id)));
  }
  if (key === 'rb_staff_users') value = staffList(db);
  if (key === 'rb_set') { value = { ...value }; delete value.pass; }
  return { version: row.version, value };
}

/** Everything the caller may read. Values are left out when the caller already has the current version. */
function readState(db, user, { known = {}, mine = [] } = {}) {
  const versions = {};
  const data = {};
  for (const key of Object.keys(COLLECTIONS)) {
    const view = readCollection(db, key, user, mine);
    if (!view) continue;
    versions[key] = view.version;
    if (known[key] !== view.version) data[key] = view.value;
  }
  return {
    versions,
    data,
    builtinUsernames: user ? builtinUsernames(db) : [],
    user: user ? { username: user.username, role: user.role, name: user.name } : null
  };
}

/* ---------- writing ---------- */

function requireWrite(def, user, what) {
  if (!user) throw new HttpError(401, 'Please sign in.');
  if (!roleAllowed(def.write, user)) throw new HttpError(403, `Your role cannot change ${what}.`);
}

function nextNumericId(items, idField, floor = 1000) {
  return Math.max(floor, ...items.map(item => Number(item[idField]) || 0)) + 1;
}

/**
 * Applies {upsert, remove, created} to an array collection.
 * - upsert: items to add or replace (matched by id)
 * - remove: ids to delete
 * - created: ids the client believes are brand new; if another device already used one, the server hands out a fresh id
 * Because only the differences are sent, two people editing different orders never overwrite each other.
 */
function patchCollection(db, key, user, body) {
  const def = COLLECTIONS[key];
  if (!def || def.kind !== 'array') throw new HttpError(404, 'Unknown collection.');
  requireWrite(def, user, key);
  if (!isPlainObject(body)) throw new HttpError(400, 'Invalid request body.');
  const upsert = Array.isArray(body.upsert) ? body.upsert : [];
  const remove = Array.isArray(body.remove) ? body.remove : [];
  const created = new Set((Array.isArray(body.created) ? body.created : []).map(String));
  if (upsert.length > 500 || remove.length > 500) throw new HttpError(400, 'Too many changes in one request.');
  if (remove.length && !roleAllowed(def.remove, user)) throw new HttpError(403, `Your role cannot delete from ${key}.`);

  return transaction(db, () => {
    const current = kvGet(db, key) || { value: [], version: 0 };
    const byId = new Map(current.value.map(item => [String(item[def.idField]), item]));
    remove.forEach(id => byId.delete(String(id)));

    for (const raw of upsert) {
      const item = def.validate(raw);
      let id = String(item[def.idField]);
      if (created.has(id) && byId.has(id) && def.idField === 'id' && typeof item.id === 'number') {
        item.id = nextNumericId([...byId.values(), ...upsert], 'id', key === 'rb_orders' ? 1000 : 0);
        id = String(item.id);
      } else if (!created.has(id) && !byId.has(id)) {
        continue; // an edit to something another device already deleted; do not bring it back
      }
      byId.set(id, item);
    }
    const value = [...byId.values()];
    return { version: kvSet(db, key, value), value: readCollection(db, key, user).value };
  });
}

/** Replaces an object collection (contact details, settings). */
function putCollection(db, key, user, body) {
  const def = COLLECTIONS[key];
  if (!def || def.kind !== 'object') throw new HttpError(404, 'Unknown collection.');
  requireWrite(def, user, key);
  if (!def.validate) throw new HttpError(403, 'This collection cannot be written directly.');
  const value = def.validate(isPlainObject(body) ? body.value : undefined);
  return transaction(db, () => {
    const version = kvSet(db, key, value);
    return { version, value: readCollection(db, key, user).value };
  });
}

/* ---------- staff accounts ---------- */

function patchStaff(db, user, body) {
  const def = COLLECTIONS.rb_staff_users;
  requireWrite(def, user, 'staff accounts');
  const upsert = Array.isArray(body?.upsert) ? body.upsert : [];
  const remove = Array.isArray(body?.remove) ? body.remove : [];
  if (upsert.length > 50 || remove.length > 50) throw new HttpError(400, 'Too many changes in one request.');

  return transaction(db, () => {
    for (const raw of remove) {
      const username = String(raw).trim().toLowerCase();
      const row = db.prepare('SELECT builtin FROM users WHERE username = ?').get(username);
      if (!row) continue;
      if (row.builtin) throw new HttpError(400, 'Built-in accounts cannot be removed.');
      if (username === user.username) throw new HttpError(400, 'You cannot remove your own account.');
      db.prepare('DELETE FROM users WHERE username = ?').run(username);
    }
    for (const raw of upsert) {
      if (!isPlainObject(raw)) throw new HttpError(400, 'Staff account must be an object.');
      const username = String(raw.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, 'Username must be 3-30 letters, numbers, dots, dashes or underscores.');
      if (!ROLES.includes(raw.role)) throw new HttpError(400, 'Choose a valid role.');
      const name = text(raw.name, 'Name', { max: 60 }) || username;
      const existing = db.prepare('SELECT builtin FROM users WHERE username = ?').get(username);
      const password = raw.password === undefined ? undefined : String(raw.password);
      if (password !== undefined && (password.length < 6 || password.length > 200)) {
        throw new HttpError(400, 'Password must be at least 6 characters.');
      }
      if (existing) {
        if (existing.builtin) throw new HttpError(409, 'That username is already taken.');
        db.prepare('UPDATE users SET role = ?, display_name = ? WHERE username = ?').run(raw.role, name, username);
        if (password !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword(password), username);
      } else {
        if (password === undefined) throw new HttpError(400, 'A password is required for new staff accounts.');
        db.prepare('INSERT INTO users (username, display_name, role, password_hash, builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)')
          .run(username, name, raw.role, hashPassword(password), Date.now());
      }
    }
    const value = staffList(db);
    return { version: kvSet(db, 'rb_staff_users', value), value };
  });
}

/* ---------- customer actions (no login needed) ---------- */

/** Creates an order from a customer. Prices and names always come from the server's menu, never from the browser. */
function createCustomerOrder(db, body) {
  if (!isPlainObject(body)) throw new HttpError(400, 'Invalid order.');
  const table = text(body.table, 'Table number', { min: 1, max: 10, required: true });
  if (!/^[A-Za-z0-9 -]+$/.test(table)) throw new HttpError(400, 'Table number can only contain letters, numbers, spaces and dashes.');
  const name = text(body.name, 'Name', { max: 60 });
  const phone = text(body.phone, 'Phone', { max: 15 });
  if (phone && !/^\d{10}$/.test(phone)) throw new HttpError(400, 'Phone number must be 10 digits.');
  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : 'after-delivery';
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 60) throw new HttpError(400, 'Add at least one dish.');

  return transaction(db, () => {
    const menu = (kvGet(db, 'rb_menu') || { value: [] }).value;
    const lines = new Map();
    for (const raw of body.items) {
      const menuItem = menu.find(item => String(item.id) === String(raw && raw.id));
      if (!menuItem) throw new HttpError(400, 'One of the dishes is no longer on the menu.');
      const q = number(raw.q, 'Quantity', { min: 1, max: 50, integer: true });
      const existing = lines.get(menuItem.id);
      lines.set(menuItem.id, { id: menuItem.id, n: menuItem.n, p: menuItem.p, q: Math.min(50, (existing ? existing.q : 0) + q) });
    }
    const orders = (kvGet(db, 'rb_orders') || { value: [] }).value;
    const id = nextNumericId(orders, 'id');
    const prizeIndex = crypto.randomInt(PRIZES.length);
    const order = {
      id, table, name, phone, paymentMethod,
      items: [...lines.values()],
      status: 'new', stage: 'pending', prize: PRIZES[prizeIndex], time: Date.now()
    };
    kvSet(db, 'rb_orders', [...orders, order]);
    return { order, prizeIndex };
  });
}

/** Records or changes a star rating. `previous` is the customer's earlier rating on this device, if any. */
function rateDish(db, body) {
  const itemId = String(body && body.itemId);
  const rating = number(body && body.rating, 'Rating', { min: 1, max: 5, integer: true });
  const previous = body && body.previous ? number(body.previous, 'Previous rating', { min: 1, max: 5, integer: true }) : 0;
  return transaction(db, () => {
    const menu = (kvGet(db, 'rb_menu') || { value: [] }).value;
    if (!menu.some(item => String(item.id) === itemId)) throw new HttpError(404, 'Dish not found.');
    const ratings = (kvGet(db, 'rb_food_ratings') || { value: {} }).value;
    const entry = ratings[itemId] || { sum: 0, count: 0 };
    const hadPrevious = previous > 0 && entry.count > 0;
    ratings[itemId] = {
      sum: Math.max(0, entry.sum - (hadPrevious ? previous : 0) + rating),
      count: entry.count + (hadPrevious ? 0 : 1)
    };
    kvSet(db, 'rb_food_ratings', ratings);
    return ratings[itemId];
  });
}

module.exports = {
  HttpError, ROLES, COLLECTIONS, readCollection, readState, patchCollection, putCollection,
  patchStaff, createCustomerOrder, rateDish
};
