# Neel Tarang – Restaurant Ordering & Staff Dashboards

Customer ordering page plus owner, cashier, waiter and chef dashboards. The frontend is the original
HTML/CSS/JS project; this repository adds a Node.js + SQLite backend so orders, menu, staff accounts and
bills are shared between devices instead of living in one browser.

- **No dependencies to install.** The server uses only Node's built-in modules (`node:http`, `node:sqlite`, `node:crypto`).
- **One service.** The server also serves the frontend, so there is nothing to configure for CORS.

## Run it locally

Requires **Node.js 22.13 or newer**.

```bash
cp .env.example .env      # then edit OWNER_PASSWORD
npm start
```

Open <http://localhost:3000>. Staff sign in at `/login.html`.

For quick local testing set `SEED_DEMO_USERS=true` in `.env`. This also creates `cashier`, `waiter` and
`chef` accounts (passwords `cashier123`, `waiter123`, `chef123`). **Never enable it on a live site.**

```bash
npm test        # API tests
```

## Accounts

| Role    | Can do                                                                      |
| ------- | --------------------------------------------------------------------------- |
| Owner   | Everything: menu, staff accounts, contact details, settings, delete orders  |
| Cashier | See and update orders, record payments, create split bills                  |
| Waiter  | See and update orders, place orders for tables                              |
| Chef    | See orders and move them through pending → cooking → ready → served         |
| Customer (not signed in) | Browse the menu, place orders, see their own orders, rate dishes |

The first owner account is created from `OWNER_USERNAME` / `OWNER_PASSWORD` when the database is empty.
After that the owner adds staff from the **Staff** tab of the owner dashboard. Passwords are stored hashed (scrypt).

## Configuration

| Variable          | Purpose                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `PORT`            | Port to listen on (hosts usually set this for you)                                            |
| `DATA_DIR`        | Folder for the SQLite file. **Must be on persistent storage in production.**                  |
| `SESSION_SECRET`  | Signs login tokens. Set a long random value. If empty, one is generated and kept in the DB.   |
| `OWNER_USERNAME`, `OWNER_PASSWORD`, `OWNER_NAME` | First owner account                                            |
| `SEED_DEMO_USERS` | `true` creates demo cashier/waiter/chef accounts. Keep `false` in production.                 |
| `TRUST_PROXY`     | `true` when behind a proxy/load balancer, so rate limiting uses the real visitor IP           |
| `CORS_ORIGIN`     | Only if the frontend is hosted on a different domain (see below)                              |

## Deploy

GitHub itself can only host static files (GitHub Pages), so the backend needs a host that runs Node.
Push this repository to GitHub, then connect it to one of these:

**Render** – "New → Blueprint", pick the repo. `render.yaml` sets up the service and a persistent disk;
enter `OWNER_PASSWORD` when asked. SQLite needs that disk, otherwise data is lost on every deploy.

**Railway / Fly.io / any Docker host** – a `Dockerfile` is included. Mount a volume at `/data`, set
`OWNER_PASSWORD` and `SESSION_SECRET`, and expose port 3000.

**Frontend on GitHub Pages + backend elsewhere (optional)** – put the contents of `public/` on Pages, set
`window.RB_API_BASE = 'https://your-backend.example.com'` in `public/config.js`, and set the backend's
`CORS_ORIGIN` to your Pages address (for example `https://yourname.github.io`).

Always serve the site over HTTPS (all of the hosts above do this by default).

## How the frontend is connected

The original pages read and write `localStorage` directly. Rather than rewrite them, `public/api-client.js`
keeps those keys in sync with the server:

1. On page load it fetches the latest data from the server.
2. When a page saves, only the *changes* (added, edited or removed orders/items) are sent. Two staff members
   changing different orders at the same time do not overwrite each other, and a duplicate order number from
   another device is re-numbered by the server.
3. It checks for updates every 3 seconds, so a new order shows up on the chef's screen without refreshing.

The server decides what each visitor may read or change; the browser is never trusted.
Customer orders are created through `POST /api/orders`, where the server takes dish names and prices from
its own menu, assigns the order number and draws the prize.

### Files changed from the original frontend

- `auth.js` – signs in through the server instead of checking passwords in the browser.
- `order.html` – placing orders and rating dishes go through the server; the old "Owner password" setting was removed.
- `login.html` – the demo-credentials box was removed so passwords are not shown publicly.
- All pages – load `config.js` and `api-client.js` first.
- New: `api-client.js`, `config.js`.

## API (summary)

| Method & path                  | Who            | Purpose                                              |
| ------------------------------ | -------------- | ---------------------------------------------------- |
| `POST /api/auth/login`         | anyone         | `{username, password, role}` → token                 |
| `GET /api/store`               | anyone         | Data the caller may read (filtered by role)          |
| `PATCH /api/store/:key`        | by role        | Add/edit/remove items in a collection                |
| `PUT /api/store/:key`          | owner          | Replace contact details or settings                  |
| `POST /api/orders`             | anyone         | Place a customer order                               |
| `POST /api/ratings`            | anyone         | Rate a dish                                          |
| `GET /api/health`              | anyone         | Health check                                         |

## Limitations to know about

- **One server instance.** SQLite lives on one disk, so run a single instance (plenty for one restaurant).
- **Updates use polling** (every 3 seconds), not websockets.
- Login tokens last 12 hours; the dashboard also signs staff out after 15 minutes of inactivity, as before.
- Online payments are not processed; staff record payments, as in the original.
- Back up the `DATA_DIR/restaurant.db` file regularly.
