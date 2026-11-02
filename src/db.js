'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_MENU, DEFAULT_TABLES, DEFAULT_CONTACT, DEFAULT_SETTINGS } = require('./defaults');

/**
 * Opens (and creates, if needed) the SQLite database.
 * Pass ':memory:' as the file for tests.
 */
function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS kv (
      key     TEXT PRIMARY KEY,
      value   TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS users (
      username      TEXT PRIMARY KEY,           -- stored lower-case
      display_name  TEXT NOT NULL,              -- the name shown in the UI
      role          TEXT NOT NULL CHECK (role IN ('owner','cashier','waiter','chef')),
      password_hash TEXT NOT NULL,
      builtin       INTEGER NOT NULL DEFAULT 0, -- 1 = created by the server at startup, cannot be removed in the UI
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function kvGet(db, key) {
  const row = db.prepare('SELECT value, version FROM kv WHERE key = ?').get(key);
  return row ? { value: JSON.parse(row.value), version: Number(row.version) } : null;
}

function kvSet(db, key, value) {
  const existing = db.prepare('SELECT version FROM kv WHERE key = ?').get(key);
  const version = existing ? Number(existing.version) + 1 : 1;
  db.prepare(
    'INSERT INTO kv (key, value, version) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version'
  ).run(key, JSON.stringify(value), version);
  return version;
}

function metaGet(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

/** Runs fn inside a transaction; rolls back if it throws. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Writes the default menu, tables and contact details the first time the server runs. */
function seedDefaults(db) {
  const seed = (key, value) => { if (!kvGet(db, key)) kvSet(db, key, value); };
  seed('rb_menu', DEFAULT_MENU);
  seed('rb_orders', []);
  seed('rb_tables', DEFAULT_TABLES);
  seed('rb_split_bills_v1', []);
  seed('rb_contact_details', DEFAULT_CONTACT);
  seed('rb_set', DEFAULT_SETTINGS);
  seed('rb_food_ratings', {});
}

module.exports = { openDatabase, kvGet, kvSet, metaGet, metaSet, transaction, seedDefaults };
