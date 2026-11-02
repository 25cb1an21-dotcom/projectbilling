'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;

test.before(async () => {
  const db = openDatabase(':memory:');
  const handler = createApp({ db, env: { OWNER_PASSWORD: 'owner-pass-1', SEED_DEMO_USERS: 'true' } });
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function api(method, path, { token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

async function login(username, password, role) {
  const res = await api('POST', '/api/auth/login', { body: { username, password, role } });
  assert.equal(res.status, 200, `login as ${username} failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

test('serves the frontend and a health check', async () => {
  const page = await fetch(`${base}/login.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Staff Login/);
  assert.equal((await api('GET', '/api/health')).body.ok, true);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
});

test('login accepts the right role and password only', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'owner', password: 'wrong', role: 'owner' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'owner', password: 'owner-pass-1', role: 'chef' } })).status, 401);
  const token = await login('owner', 'owner-pass-1', 'owner');
  const me = await api('GET', '/api/auth/me', { token });
  assert.equal(me.body.user.role, 'owner');
  assert.equal((await api('GET', '/api/auth/me', { token: token + 'x' })).status, 401);
});

test('anonymous visitors see the menu but not staff data', async () => {
  const state = (await api('GET', '/api/store')).body;
  assert.equal(state.data.rb_menu.length, 12);
  assert.ok(state.data.rb_contact_details);
  assert.equal('rb_staff_users' in state.data, false);
  assert.equal('rb_split_bills_v1' in state.data, false);
  assert.equal('rb_tables' in state.data, false);
  assert.deepEqual(state.data.rb_orders, []);
});

test('customers cannot write shared data directly', async () => {
  assert.equal((await api('PATCH', '/api/store/rb_menu', { body: { upsert: [{ id: 99, n: 'Free', c: 'x', p: 0 }], created: [99] } })).status, 401);
  assert.equal((await api('PATCH', '/api/store/rb_orders', { body: { remove: [1] } })).status, 401);
  assert.equal((await api('PUT', '/api/store/rb_set', { body: { value: { name: 'Hacked', gst: 0 } } })).status, 401);
});

test('customer orders use server prices, get a server order number and a server prize', async () => {
  const placed = await api('POST', '/api/orders', {
    body: { table: '5', name: 'Meera', phone: '9876543210', paymentMethod: 'UPI', items: [{ id: 1, q: 2, p: 1, n: 'Cheap' }, { id: 4, q: 1 }] }
  });
  assert.equal(placed.status, 201);
  const { order, prizeIndex } = placed.body;
  assert.equal(order.items[0].p, 220); // price from the menu, not from the request
  assert.equal(order.items[0].n, 'Paneer Butter Masala');
  assert.ok(order.id > 1000);
  assert.ok(prizeIndex >= 0 && prizeIndex < 4);

  const second = await api('POST', '/api/orders', { body: { table: '6', items: [{ id: 2, q: 1 }] } });
  assert.equal(second.body.order.id, order.id + 1);

  // A customer only sees the orders they ask for.
  const mine = (await api('GET', `/api/store?mine=${order.id}`)).body.data.rb_orders;
  assert.deepEqual(mine.map(o => o.id), [order.id]);
  assert.deepEqual((await api('GET', '/api/store')).body.data.rb_orders, []);
});

test('order validation rejects bad input', async () => {
  const bad = body => api('POST', '/api/orders', { body });
  assert.equal((await bad({ table: '', items: [{ id: 1, q: 1 }] })).status, 400);
  assert.equal((await bad({ table: '2', items: [] })).status, 400);
  assert.equal((await bad({ table: '2', items: [{ id: 9999, q: 1 }] })).status, 400);
  assert.equal((await bad({ table: '2', items: [{ id: 1, q: 0 }] })).status, 400);
  assert.equal((await bad({ table: '2', phone: '123', items: [{ id: 1, q: 1 }] })).status, 400);
});

test('ratings add up on the server and can be changed', async () => {
  let entry = (await api('POST', '/api/ratings', { body: { itemId: 3, rating: 5 } })).body;
  assert.deepEqual(entry, { sum: 5, count: 1 });
  entry = (await api('POST', '/api/ratings', { body: { itemId: 3, rating: 3 } })).body;
  assert.deepEqual(entry, { sum: 8, count: 2 });
  entry = (await api('POST', '/api/ratings', { body: { itemId: 3, rating: 4, previous: 3 } })).body;
  assert.deepEqual(entry, { sum: 9, count: 2 });
  assert.equal((await api('POST', '/api/ratings', { body: { itemId: 3, rating: 9 } })).status, 400);
  assert.equal((await api('POST', '/api/ratings', { body: { itemId: 777, rating: 3 } })).status, 404);
});

test('staff roles: chef can move an order along but cannot edit the menu or delete orders', async () => {
  const chef = await login('chef', 'chef123', 'chef');
  const orders = (await api('GET', '/api/store', { token: chef })).body.data.rb_orders;
  assert.ok(orders.length >= 2);
  const target = { ...orders[0], stage: 'cooking' };
  const updated = await api('PATCH', '/api/store/rb_orders', { token: chef, body: { upsert: [target] } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.value.find(o => o.id === target.id).stage, 'cooking');

  assert.equal((await api('PATCH', '/api/store/rb_orders', { token: chef, body: { remove: [target.id] } })).status, 403);
  assert.equal((await api('PATCH', '/api/store/rb_menu', { token: chef, body: { upsert: [{ id: 1, n: 'x', c: 'y', p: 1 }] } })).status, 403);
  assert.equal((await api('GET', '/api/store', { token: chef })).body.data.rb_staff_users, undefined);
  assert.equal((await api('PATCH', '/api/store/rb_staff_users', { token: chef, body: { upsert: [{ username: 'evil', password: 'secret1', role: 'owner' }] } })).status, 403);
});

test('two people editing different orders at once do not overwrite each other', async () => {
  const chef = await login('chef', 'chef123', 'chef');
  const waiter = await login('waiter', 'waiter123', 'waiter');
  const orders = (await api('GET', '/api/store', { token: chef })).body.data.rb_orders;
  const [a, b] = orders;
  await Promise.all([
    api('PATCH', '/api/store/rb_orders', { token: chef, body: { upsert: [{ ...a, stage: 'ready' }] } }),
    api('PATCH', '/api/store/rb_orders', { token: waiter, body: { upsert: [{ ...b, stage: 'served' }] } })
  ]);
  const after = (await api('GET', '/api/store', { token: chef })).body.data.rb_orders;
  assert.equal(after.find(o => o.id === a.id).stage, 'ready');
  assert.equal(after.find(o => o.id === b.id).stage, 'served');
});

test('a staff order that reuses a number another device already took gets a new number', async () => {
  const waiter = await login('waiter', 'waiter123', 'waiter');
  const existing = (await api('GET', '/api/store', { token: waiter })).body.data.rb_orders;
  const clash = { id: existing[0].id, table: '9', name: '', phone: '', items: [{ id: 1, n: 'Paneer Butter Masala', p: 220, q: 1 }], status: 'new', stage: 'pending', time: Date.now() };
  const res = await api('PATCH', '/api/store/rb_orders', { token: waiter, body: { upsert: [clash], created: [clash.id] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.value.length, existing.length + 1);
  assert.equal(new Set(res.body.value.map(o => o.id)).size, res.body.value.length);
});

test('menu changes: owner only, validated, and visible to everyone', async () => {
  const owner = await login('owner', 'owner-pass-1', 'owner');
  const item = { id: 5001, n: 'Rasmalai', c: 'Desserts', p: 90, e: '🍨' };
  const res = await api('PATCH', '/api/store/rb_menu', { token: owner, body: { upsert: [item], created: [5001] } });
  assert.equal(res.status, 200);
  assert.equal((await api('GET', '/api/store')).body.data.rb_menu.some(m => m.id === 5001), true);
  assert.equal((await api('PATCH', '/api/store/rb_menu', { token: owner, body: { upsert: [{ ...item, p: -5 }] } })).status, 400);
  assert.equal((await api('PATCH', '/api/store/rb_menu', { token: owner, body: { upsert: [{ ...item, img: 'javascript:alert(1)' }] } })).status, 400);
  assert.equal((await api('PATCH', '/api/store/rb_menu', { token: owner, body: { remove: [5001] } })).status, 200);
});

test('staff accounts: passwords are hashed, never returned, and new staff can sign in', async () => {
  const owner = await login('owner', 'owner-pass-1', 'owner');
  const add = await api('PATCH', '/api/store/rb_staff_users', {
    token: owner, body: { upsert: [{ username: 'Meena', password: 'tasty-123', role: 'waiter', name: 'Meena' }] }
  });
  assert.equal(add.status, 200);
  assert.deepEqual(add.body.value, [{ username: 'meena', role: 'waiter', name: 'Meena' }]);
  assert.equal(JSON.stringify(add.body).includes('tasty-123'), false);
  await login('meena', 'tasty-123', 'waiter');

  const state = (await api('GET', '/api/store', { token: owner })).body;
  assert.deepEqual(state.data.rb_staff_users.map(u => u.username), ['meena']);
  assert.ok(state.builtinUsernames.includes('owner'));

  assert.equal((await api('PATCH', '/api/store/rb_staff_users', { token: owner, body: { upsert: [{ username: 'chef', password: 'abcdef', role: 'chef' }] } })).status, 409);
  assert.equal((await api('PATCH', '/api/store/rb_staff_users', { token: owner, body: { upsert: [{ username: 'x', password: 'abcdef', role: 'chef' }] } })).status, 400);
  assert.equal((await api('PATCH', '/api/store/rb_staff_users', { token: owner, body: { remove: ['owner'] } })).status, 400);

  const meena = await login('meena', 'tasty-123', 'waiter');
  assert.equal((await api('PATCH', '/api/store/rb_staff_users', { token: owner, body: { remove: ['meena'] } })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: meena })).status, 401); // removed staff lose access at once
});

test('settings drop the old owner-password field and hide it from visitors', async () => {
  const owner = await login('owner', 'owner-pass-1', 'owner');
  const res = await api('PUT', '/api/store/rb_set', { token: owner, body: { value: { name: 'Neel Tarang', gst: 12, gstin: 'X', pass: 'leak' } } });
  assert.equal(res.status, 200);
  assert.equal('pass' in res.body.value, false);
  assert.equal((await api('GET', '/api/store')).body.data.rb_set.gst, 12);
});

test('split bills are for the owner and cashier only', async () => {
  const cashier = await login('cashier', 'cashier123', 'cashier');
  const waiter = await login('waiter', 'waiter123', 'waiter');
  const record = { id: 'SPLIT-1', orderId: 9902, invoices: [{ invoiceNo: 'A', totalPaise: 100 }] };
  assert.equal((await api('PATCH', '/api/store/rb_split_bills_v1', { token: cashier, body: { upsert: [record], created: ['SPLIT-1'] } })).status, 200);
  assert.equal((await api('PATCH', '/api/store/rb_split_bills_v1', { token: waiter, body: { upsert: [record] } })).status, 403);
  assert.equal((await api('GET', '/api/store', { token: waiter })).body.data.rb_split_bills_v1, undefined);
});

test('only changed collections are returned when the caller knows the version', async () => {
  const first = (await api('GET', '/api/store')).body;
  const known = Object.entries(first.versions).map(([k, v]) => `${k}:${v}`).join(',');
  const second = (await api('GET', `/api/store?known=${encodeURIComponent(known)}`)).body;
  assert.deepEqual(second.data, {});
});

test('too many failed logins are blocked', async () => {
  let last;
  for (let i = 0; i < 8; i += 1) last = await api('POST', '/api/auth/login', { body: { username: 'ghost', password: 'nope', role: 'owner' } });
  assert.equal(last.status, 429);
});
