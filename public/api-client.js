/*
 * api-client.js - connects the existing pages to the backend.
 *
 * The pages were written to read and write browser storage (localStorage). Instead of rewriting every
 * page, this file keeps that storage in sync with the server:
 *   1. On page load it fetches the latest data from the server (once, before the page scripts run).
 *   2. Whenever a page saves one of the shared keys, only the CHANGES are sent to the server.
 *   3. Every few seconds it asks the server for updates, so a chef sees a waiter's new order
 *      without refreshing.
 * The server decides who is allowed to read or change what; this file only moves data around.
 *
 * Load this file BEFORE data.js / auth.js / the page's own scripts, and without "defer".
 */
(() => {
    'use strict';

    const BASE = String(window.RB_API_BASE || '').replace(/\/$/, '');
    const AUTH_KEY = 'rb_auth_user';
    const POLL_MS = 3000;

    // Shared keys. Array collections are matched by the given id field.
    const ARRAY_KEYS = { rb_menu: 'id', rb_orders: 'id', rb_tables: 'number', rb_split_bills_v1: 'id', rb_staff_users: 'username' };
    const OBJECT_KEYS = ['rb_contact_details', 'rb_set'];
    const READ_ONLY_KEYS = ['rb_food_ratings']; // changed only through /api/ratings
    const ALL_KEYS = [...Object.keys(ARRAY_KEYS), ...OBJECT_KEYS, ...READ_ONLY_KEYS];

    const nativeSet = Storage.prototype.setItem;
    const nativeGet = Storage.prototype.getItem;

    const versions = {};   // last version number seen per key
    const mirror = {};     // last value known to be on the server, used to work out what changed
    let applying = false;  // true while this file itself is writing to storage
    let pending = 0;       // number of saves waiting to be sent
    let queue = Promise.resolve();
    let redirecting = false;

    /* ---------- login token ---------- */

    function getSession() {
        for (const store of [sessionStorage, localStorage]) {
            try {
                const session = JSON.parse(nativeGet.call(store, AUTH_KEY) || 'null');
                if (session && session.token) return session;
            } catch (error) {
                console.error('Could not read the saved login.', error);
            }
        }
        return null;
    }

    const getToken = () => (getSession() || {}).token || '';

    function expireSession() {
        if (redirecting) return;
        redirecting = true;
        try {
            sessionStorage.removeItem(AUTH_KEY);
            localStorage.removeItem(AUTH_KEY);
            sessionStorage.removeItem('rb_adm');
        } catch (error) {
            console.error('Could not clear the login.', error);
        }
        window.location.replace('login.html?reason=session');
    }

    /* ---------- small message banner ---------- */

    let bannerTimer = 0;
    function notify(message) {
        const show = () => {
            let banner = document.getElementById('rb-sync-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'rb-sync-banner';
                banner.setAttribute('role', 'alert');
                banner.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:min(92vw,480px);' +
                    'background:#7a1f1f;color:#fff;padding:12px 18px;border-radius:10px;font:600 14px/1.4 system-ui,sans-serif;' +
                    'box-shadow:0 8px 24px rgba(0,0,0,.3);z-index:2147483647;text-align:center';
                document.body.append(banner);
            }
            banner.textContent = message;
            banner.hidden = false;
            clearTimeout(bannerTimer);
            bannerTimer = setTimeout(() => { banner.hidden = true; }, 7000);
        };
        if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
    }

    /* ---------- requests ---------- */

    function myOrderIds() {
        try {
            const ids = JSON.parse(nativeGet.call(localStorage, 'rb_customer_orders') || '[]');
            return Array.isArray(ids) ? ids.filter(id => /^\d{1,15}$/.test(String(id))) : [];
        } catch (error) {
            return [];
        }
    }

    function storeUrl() {
        const known = Object.entries(versions).map(([key, version]) => `${key}:${version}`).join(',');
        const mine = myOrderIds().join(',');
        return `${BASE}/api/store?known=${encodeURIComponent(known)}&mine=${encodeURIComponent(mine)}`;
    }

    async function request(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        let response;
        try {
            response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        } catch (error) {
            const failure = new Error('Cannot reach the server. Check your internet connection.');
            failure.network = true;
            throw failure;
        }
        let payload = null;
        try { payload = await response.json(); } catch (error) { /* empty body */ }
        if (!response.ok) {
            const failure = new Error((payload && payload.error) || `Server error (${response.status}).`);
            failure.status = response.status;
            throw failure;
        }
        return payload;
    }

    /* ---------- applying server data to local storage ---------- */

    const json = value => JSON.stringify(value);

    function writeLocal(key, value) {
        applying = true;
        try { nativeSet.call(localStorage, key, json(value)); } finally { applying = false; }
    }

    /** Stores what the server sent. Returns the keys whose local value actually changed. */
    function applyState(state, { fillMissing = false } = {}) {
        const changed = [];
        for (const key of ALL_KEYS) {
            if (state.data && key in state.data) {
                const value = state.data[key];
                versions[key] = state.versions[key];
                mirror[key] = value;
                if (nativeGet.call(localStorage, key) !== json(value)) {
                    writeLocal(key, value);
                    changed.push(key);
                }
            } else if (state.versions && key in state.versions) {
                versions[key] = state.versions[key];
            } else if (fillMissing) {
                // This visitor may not read this key (for example a customer and the staff list).
                // Empty it so data left behind by an earlier staff login on this device is not shown.
                delete versions[key];
                mirror[key] = ARRAY_KEYS[key] ? [] : {};
                const empty = ARRAY_KEYS[key] ? '[]' : '{}';
                if (nativeGet.call(localStorage, key) !== empty) {
                    applying = true;
                    try { nativeSet.call(localStorage, key, empty); } finally { applying = false; }
                }
            }
        }
        window.RB_BUILTIN_USERS = Array.isArray(state.builtinUsernames) ? state.builtinUsernames : [];
        return changed;
    }

    function announce(keys) {
        keys.forEach(key => {
            let newValue = null;
            try { newValue = nativeGet.call(localStorage, key); } catch (error) { /* ignore */ }
            window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
        });
    }

    /* ---------- 1. first load (synchronous, so page scripts see server data immediately) ---------- */

    function firstLoad() {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', storeUrl(), false);
            const token = getToken();
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send();
            if (xhr.status !== 200) throw new Error(`Server answered ${xhr.status}`);
            const state = JSON.parse(xhr.responseText);
            if (token && !state.user) { expireSession(); return; }
            applyState(state, { fillMissing: true });
        } catch (error) {
            console.error('Could not load data from the server. Showing the last saved copy.', error);
            window.RB_BUILTIN_USERS = [];
            notify('Cannot reach the server right now. You are seeing saved data and changes will not be stored.');
        }
    }

    /* ---------- 2. sending changes ---------- */

    function diffArray(key, nextList) {
        const idField = ARRAY_KEYS[key];
        const before = new Map((mirror[key] || []).map(item => [String(item[idField]), item]));
        const after = new Map(nextList.map(item => [String(item[idField]), item]));
        const upsert = [];
        const created = [];
        const remove = [];
        after.forEach((item, id) => {
            if (!before.has(id)) { upsert.push(item); created.push(item[idField]); }
            else if (json(before.get(id)) !== json(item)) upsert.push(item);
        });
        before.forEach((item, id) => { if (!after.has(id)) remove.push(item[idField]); });
        return { upsert, remove, created };
    }

    async function push(key) {
        let local;
        try { local = JSON.parse(nativeGet.call(localStorage, key)); } catch (error) { local = null; }
        try {
            if (READ_ONLY_KEYS.includes(key)) throw Object.assign(new Error('read-only'), { silent: true });
            let result;
            if (ARRAY_KEYS[key]) {
                if (!Array.isArray(local)) throw new Error('Saved data has an unexpected format.');
                const changes = diffArray(key, local);
                if (!changes.upsert.length && !changes.remove.length) return;
                result = await request('PATCH', `/api/store/${key}`, changes);
            } else {
                if (json(local) === json(mirror[key])) return;
                result = await request('PUT', `/api/store/${key}`, { value: local });
            }
            versions[key] = result.version;
            mirror[key] = result.value;
            if (json(result.value) !== nativeGet.call(localStorage, key)) {
                writeLocal(key, result.value); // the server's merged copy (for example a re-numbered order)
                announce([key]);
            }
        } catch (error) {
            if (error.status === 401 && getToken()) { expireSession(); return; }
            if (!error.silent) notify(error.status === 403 ? 'Your role is not allowed to make that change.' : error.message);
            // Put the screen back to what the server has.
            if (key in mirror) { writeLocal(key, mirror[key]); announce([key]); }
        }
    }

    function schedulePush(key) {
        pending += 1;
        queue = queue.then(() => push(key)).catch(error => console.error('Sync failed.', error)).finally(() => { pending -= 1; });
    }

    Storage.prototype.setItem = function (key, value) {
        nativeSet.call(this, key, value);
        if (this === window.localStorage && !applying && ALL_KEYS.includes(key)) schedulePush(key);
    };

    /* ---------- 3. keeping other devices up to date ---------- */

    async function poll() {
        if (pending > 0 || document.hidden || redirecting) return;
        try {
            const headers = {};
            const token = getToken();
            if (token) headers.Authorization = `Bearer ${token}`;
            const response = await fetch(storeUrl(), { headers });
            if (!response.ok) return;
            const state = await response.json();
            if (token && !state.user) { expireSession(); return; }
            if (pending > 0) return; // the user saved something while we were waiting; do not overwrite it
            const changed = applyState(state);
            if (changed.length) announce(changed);
        } catch (error) {
            // Temporary network problem; try again on the next tick.
        }
    }

    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('online', poll);

    firstLoad();

    /**
     * Stores a value that the server has already accepted through a dedicated endpoint (for example a new
     * customer order), without sending it to the server a second time.
     */
    function adopt(key, value) {
        mirror[key] = value;
        writeLocal(key, value);
    }

    window.RBApi = { request, getToken, adopt, base: BASE, notify };
})();
