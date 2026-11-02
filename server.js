'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// Load a local .env file if present (hosting platforms set real environment variables instead).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const db = openDatabase(path.join(dataDir, 'restaurant.db'));

const server = http.createServer(createApp({ db }));
server.listen(port, '0.0.0.0', () => {
  console.log(`Restaurant app running on http://localhost:${port}`);
  console.log(`Database: ${path.join(dataDir, 'restaurant.db')}`);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
