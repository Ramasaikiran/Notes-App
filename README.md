# Notis — Multi-User Notes App

> Thoughtful note-taking for focused minds.

Full-stack notes app built with **Node.js + Express + SQLite** and a zero-dependency vanilla HTML/CSS/JS frontend.

---

## ✨ Features

| Feature | Endpoint |
|---|---|
| Register & Login (JWT + bcrypt) | `POST /register` · `POST /login` |
| Server-side Logout (token blacklist) | `POST /logout` |
| Create / Read / Update / Delete notes | `GET·POST /notes` · `GET·PUT·DELETE /notes/:id` |
| Pin notes (floats to top) | `PATCH /notes/:id/pin` |
| Share notes by email | `POST /notes/:id/share` |
| Full-text search | `GET /search?q=keyword` |
| Version history (auto-snapshot on edit) | `GET /notes/:id/versions` |
| Pagination | `?page=&limit=` on `GET /notes` |
| OpenAPI spec | `GET /openapi.json` |

---

## 🚀 Run Locally

### Prerequisites
- Node.js v18+
- npm

```bash
# 1. Unzip
unzip notes-app.zip
cd notes-app

# 2. Install
npm install

# 3. Start
npm start
# → http://localhost:3000

# Dev mode (auto-restart)
npm run dev
```

### Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | `notes-app-secret-...` | **Change in production** |
| `DB_PATH` | `notes.db` | SQLite file path |

```bash
PORT=8080 JWT_SECRET=your-strong-secret npm start
```

---

## ☁️ Deploy to Vercel

> ⚠️ **Important:** Vercel runs on a serverless/ephemeral filesystem — SQLite data won't persist between deployments or function invocations. You must swap SQLite for a hosted database. The two easiest free options are **Turso** (SQLite-compatible, zero config change) or **Neon** (PostgreSQL).

---

### Option A — Vercel + Turso (Recommended, SQLite-compatible)

Turso is a hosted libSQL database — almost identical API to SQLite. Minimal code change.

#### Step 1 — Create a Turso database

```bash
# Install Turso CLI
npm install -g @turso/cli

# Login
turso auth login

# Create DB
turso db create notis-db

# Get connection URL and token
turso db show notis-db --url
turso db tokens create notis-db
```

Save the **URL** and **token** — you'll need them in Step 4.

#### Step 2 — Swap `better-sqlite3` for `@libsql/client`

```bash
npm uninstall better-sqlite3
npm install @libsql/client
```

Update the top of `server.js`:

```js
// REMOVE:
// const Database = require('better-sqlite3');
// const db = new Database(process.env.DB_PATH || 'notes.db');

// ADD:
const { createClient } = require('@libsql/client');
const db = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});
```

> Note: `@libsql/client` is async — all `db.prepare(...).run/get/all()` calls become `await db.execute(...)`. See [libsql docs](https://docs.turso.tech/sdk/ts/reference) for the migration.

#### Step 3 — Add `vercel.json`

Create `vercel.json` in the project root:

```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "server.js" }
  ]
}
```

#### Step 4 — Deploy

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy (follow prompts)
vercel

# Set environment variables
vercel env add JWT_SECRET
vercel env add TURSO_URL
vercel env add TURSO_TOKEN

# Deploy to production
vercel --prod
```

Your app is live at `https://your-project.vercel.app` 🎉

---

### Option B — Vercel + Neon (PostgreSQL)

If you prefer PostgreSQL:

#### Step 1 — Create a Neon database

1. Go to [neon.tech](https://neon.tech) → New Project → Copy the **connection string**

#### Step 2 — Swap to PostgreSQL

```bash
npm install pg
```

Replace the DB setup in `server.js`:

```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
```

Update queries from `better-sqlite3` sync style → `await pool.query(sql, params)` style. Also change `?` placeholders to `$1, $2, $3...`.

#### Step 3 — Add `vercel.json` (same as Option A above)

#### Step 4 — Deploy

```bash
vercel
vercel env add JWT_SECRET
vercel env add DATABASE_URL   # paste your Neon connection string
vercel --prod
```

---

### Option C — Deploy to Railway (Easiest, SQLite works as-is)

If you want zero database changes, use **Railway** — it provides a persistent filesystem.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login & deploy
railway login
railway init
railway up
railway domain   # get your public URL
```

Set env vars in the Railway dashboard under **Variables**:
- `JWT_SECRET`
- `PORT` (Railway sets this automatically)

---

## 🏗 Project Structure

```
notes-app/
├── server.js          # Express API (all routes)
├── package.json
├── vercel.json        # Add this for Vercel deploy
├── notes.db           # SQLite (local only)
└── public/
    └── index.html     # Full SPA frontend
```

---

## 🛠 Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | SQLite (`better-sqlite3`) → Turso/Neon for prod |
| Auth | JWT + bcrypt, server-side token revocation |
| Frontend | Vanilla HTML · Instrument Sans · Fraunces · Fira Code |

---

## 📐 Database Schema

```sql
users         (id, email, password, created_at)
notes         (id, user_id, title, content, is_pinned, created_at, updated_at)
note_shares   (id, note_id, shared_with_user_id, created_at)
note_versions (id, note_id, title, content, created_at)
revoked_tokens(jti, revoked_at)
```

---

## 🔑 API Auth

All `/notes`, `/search`, and `/logout` routes require:

```
Authorization: Bearer <access_token>
```

Get the token from `POST /login` → `{ "access_token": "..." }`.

---

## 👤 Built by

**Kiran** · AI With RSK Newsletter · Building in Public on LinkedIn
