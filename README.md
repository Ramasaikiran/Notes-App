# Notes App

> Thoughtful note-taking for focused minds.

A full-stack multi-user notes application with a clean light-theme UI. Built with Node.js, Express, SQLite, and a zero-dependency vanilla HTML/CSS/JS frontend no build tools required.
---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Database Schema](#-database-schema)
- [Prerequisites](#-prerequisites)
- [Installation & Running Locally](#-installation--running-locally)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Deploy to Railway (Recommended)](#-deploy-to-railway-recommended)
- [Deploy to Vercel](#-deploy-to-vercel)
- [UI Overview](#-ui-overview)

---

## ✨ Features

### Core Features
- 🔐 **Authentication** — Register & login with JWT tokens (7-day expiry, bcrypt password hashing)
- 🚪 **Secure Logout** — Server-side token blacklisting via `revoked_tokens` table
- 📝 **Full CRUD** — Create, read, update, and delete notes
- 📌 **Pin Notes** — Toggle pin on any note; pinned notes always float to the top
- ↗️ **Share Notes** — Share any note with another registered user by email
- 🔍 **Full-Text Search** — Search across titles and content of all owned + shared notes
- 📄 **Pagination** — Notes list supports `?page=&limit=` query params
- 🕓 **Version History** — Every edit auto-saves a snapshot; browse and preview old versions

### Developer Features
- 📖 **OpenAPI Spec** — Full OpenAPI 3.0 JSON at `GET /openapi.json`
- ℹ️ **About Endpoint** — `GET /about` returns developer info and feature descriptions
- 🔒 **WAL Mode** — SQLite configured with Write-Ahead Logging for better concurrency
- 🧹 **Token Cleanup** — Auto-purges revoked tokens older than 7 days on every logout

---

## 🛠 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 18+ |
| Framework | Express | 4.x |
| Database | SQLite via `better-sqlite3` | 9.x |
| Auth | `jsonwebtoken` + `bcryptjs` | — |
| CORS | `cors` middleware | — |
| Frontend | Vanilla HTML / CSS / JS | — |
| Fonts | Fraunces, Instrument Sans, Fira Code | Google Fonts |

---

## 🗂 Project Structure

```
notes-app/
│
├── server.js              # Main Express app — all API routes & DB logic
├── package.json           # Dependencies and npm scripts
├── notes.db               # SQLite database (auto-created on first run)
│
└── public/
    └── index.html         # Full SPA frontend (auth + app in one file)
```

### What lives where

| File | Responsibility |
|---|---|
| `server.js` | Express setup, SQLite schema, all REST endpoints, JWT middleware |
| `public/index.html` | Auth screens, notes grid, modals, search, all client-side JS |
| `notes.db` | Auto-generated SQLite file — do not commit to Git |

---

## 📐 Database Schema

```
┌─────────────────────────────────────────────────────────┐
│  users                                                   │
│  id · email (UNIQUE) · password · created_at            │
└──────────────────────┬──────────────────────────────────┘
                       │ 1
                       │
                       │ N
┌──────────────────────▼──────────────────────────────────┐
│  notes                                                   │
│  id · user_id(FK) · title · content                     │
│  is_pinned · created_at · updated_at                    │
└──────┬──────────────────────────┬───────────────────────┘
       │ 1                        │ 1
       │                          │
       │ N                        │ N
┌──────▼──────────────┐  ┌────────▼──────────────────────┐
│  note_shares        │  │  note_versions                │
│  id · note_id(FK)   │  │  id · note_id(FK)             │
│  shared_with_       │  │  title · content              │
│  user_id(FK)        │  │  created_at                   │
│  created_at         │  └───────────────────────────────┘
└─────────────────────┘

┌───────────────────────────┐
│  revoked_tokens           │
│  jti (PK) · revoked_at   │
└───────────────────────────┘
```

### Tables

**`users`** — Registered accounts
```sql
id         INTEGER PRIMARY KEY AUTOINCREMENT
email      TEXT UNIQUE NOT NULL
password   TEXT NOT NULL              -- bcrypt hash
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`notes`** — User notes
```sql
id         INTEGER PRIMARY KEY AUTOINCREMENT
user_id    INTEGER NOT NULL           -- FK → users.id
title      TEXT NOT NULL
content    TEXT NOT NULL
is_pinned  INTEGER DEFAULT 0          -- 0 = false, 1 = true
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`note_shares`** — Sharing relationships
```sql
id                  INTEGER PRIMARY KEY AUTOINCREMENT
note_id             INTEGER NOT NULL  -- FK → notes.id
shared_with_user_id INTEGER NOT NULL  -- FK → users.id
created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
UNIQUE(note_id, shared_with_user_id)
```

**`note_versions`** — Edit history snapshots
```sql
id         INTEGER PRIMARY KEY AUTOINCREMENT
note_id    INTEGER NOT NULL           -- FK → notes.id
title      TEXT NOT NULL
content    TEXT NOT NULL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`revoked_tokens`** — Logout blacklist
```sql
jti        TEXT PRIMARY KEY           -- JWT unique ID
revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

---

## ✅ Prerequisites

- **Node.js** v18 or higher — [Download](https://nodejs.org)
- **npm** v8+ (comes with Node.js)
- A terminal (Mac/Linux Terminal, Windows CMD or PowerShell)

Check your versions:
```bash
node -v   # should show v18.x.x or higher
npm -v    # should show 8.x.x or higher
```

---

## 💻 Installation & Running Locally

### 1. Extract the project

```bash
unzip notes-app.zip
cd notes-app
```

### 2. Install dependencies

```bash
npm install
```

This installs: `express`, `better-sqlite3`, `bcryptjs`, `jsonwebtoken`, `cors`, `nodemon`

### 3. Start the server

```bash
# Production mode
npm start

# Development mode (auto-restarts on file changes)
npm run dev
```

### 4. Open in browser

```
http://localhost:3000
```

### 5. Register and start using

1. Click **Create account** → enter email + password (min 6 chars)
2. Sign in → you'll land on the notes dashboard
3. Click **+ New note** → add a title and content → **Save note**

---

## ⚙️ Environment Variables

Create a `.env` file in the project root (optional — defaults work for local dev):

```env
PORT=3000
JWT_SECRET=change-this-to-a-long-random-string-in-production
DB_PATH=notes.db
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `JWT_SECRET` | `notes-app-secret-change-in-prod-2024` | Secret for signing JWTs — **always change in production** |
| `DB_PATH` | `notes.db` | Path to the SQLite database file |

> 💡 To use `.env` files locally, install `dotenv`: `npm install dotenv` and add `require('dotenv').config()` at the top of `server.js`.

---

## 📡 API Reference

### Authentication

#### Register
```
POST /register
Content-Type: application/json

{ "email": "you@example.com", "password": "yourpassword" }
```
Response `201`:
```json
{ "message": "User registered successfully" }
```

#### Login
```
POST /login
Content-Type: application/json

{ "email": "you@example.com", "password": "yourpassword" }
```
Response `200`:
```json
{ "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

#### Logout 🔒
```
POST /logout
Authorization: Bearer <token>
```
Response `200`:
```json
{ "message": "Logged out successfully" }
```

---

### Notes 🔒 *(All require `Authorization: Bearer <token>`)*

#### Get all notes (paginated)
```
GET /notes?page=1&limit=20
```
Response `200`:
```json
{
  "data": [
    {
      "id": "1",
      "title": "My Note",
      "content": "Hello world",
      "is_pinned": false,
      "owner_id": "1",
      "created_at": "2026-05-15T10:00:00",
      "updated_at": "2026-05-15T10:00:00"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

#### Get single note
```
GET /notes/:id
```

#### Create note
```
POST /notes
Content-Type: application/json

{ "title": "My Note", "content": "Note content here" }
```
Response `201`: returns the created note object.

#### Update note
```
PUT /notes/:id
Content-Type: application/json

{ "title": "Updated title", "content": "Updated content", "is_pinned": true }
```
All fields optional. Auto-saves a version snapshot before updating.

#### Delete note
```
DELETE /notes/:id
```
Response `204 No Content`

#### Toggle pin
```
PATCH /notes/:id/pin
```
Response `200`: returns updated note with toggled `is_pinned`.

#### Share note
```
POST /notes/:id/share
Content-Type: application/json

{ "share_with_email": "friend@example.com" }
```
Response `200`:
```json
{ "message": "Note shared successfully" }
```

#### Get version history
```
GET /notes/:id/versions
```
Response `200`:
```json
[
  {
    "id": 1,
    "note_id": 1,
    "title": "Old title",
    "content": "Old content",
    "created_at": "2026-05-14T09:00:00"
  }
]
```

---

### Search & Meta

#### Full-text search 🔒
```
GET /search?q=keyword
```
Searches title + content across all owned and shared notes.

#### About
```
GET /about
```
Returns developer info and custom feature descriptions.

#### OpenAPI Spec
```
GET /openapi.json
```
Returns full OpenAPI 3.0 specification.

---

## 🚂 Deploy to Railway (Recommended — Easiest)

Railway supports persistent filesystem so **SQLite works as-is** — no database changes needed.

### Step 1 — Push to GitHub

```bash
cd notes-app

# Initialize git
git init
git add .

# Create a .gitignore first
echo "node_modules/\nnotes.db\n.env" > .gitignore
git add .gitignore
git commit -m "Initial commit — Notis app"
```

Go to [github.com/new](https://github.com/new) → create a new repo named `notis-app`

```bash
git remote add origin https://github.com/YOUR_USERNAME/notis-app.git
git branch -M main
git push -u origin main
```

### Step 2 — Sign up on Railway

Go to [railway.app](https://railway.app) → click **Login with GitHub** → authorize

### Step 3 — Create new project

1. Click **New Project**
2. Click **Deploy from GitHub repo**
3. Select your `notis-app` repository
4. Railway auto-detects Node.js → click **Deploy Now**
5. Wait ~60 seconds for the build to complete ✅

### Step 4 — Set environment variables

1. Click on your service (the card in the dashboard)
2. Go to **Variables** tab
3. Click **New Variable** and add:

| Key | Value |
|---|---|
| `JWT_SECRET` | `notis-super-secret-replace-this-xyz-2024` |
| `NODE_ENV` | `production` |

> Railway auto-sets `PORT` — do not override it.

### Step 5 — Generate a public URL

1. Click **Settings** tab → **Networking** section
2. Click **Generate Domain**
3. Copy your URL — looks like `https://notis-app-production-abc.up.railway.app`

### Step 6 — Test your live app

Open the URL in browser → register → create notes → share → all features work live! 🎉

### Updating the app

Any future `git push` to `main` automatically triggers a redeploy on Railway.

```bash
# Make changes, then:
git add .
git commit -m "Update: description of changes"
git push
# Railway redeploys automatically
```

---

## ▲ Deploy to Vercel

> ⚠️ Vercel has an ephemeral filesystem — SQLite data won't persist. You need a hosted database. Turso is the easiest option (hosted SQLite, minimal code change).

### Step 1 — Add `vercel.json`

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

### Step 2 — Set up Turso (hosted SQLite)

```bash
# Install Turso CLI
npm install -g @turso/cli

# Login
turso auth login

# Create database
turso db create notis-db

# Get your URL and auth token
turso db show notis-db --url
turso db tokens create notis-db
```

### Step 3 — Update server.js for Turso

```bash
npm uninstall better-sqlite3
npm install @libsql/client
```

Replace DB initialization in `server.js`:
```js
// Remove: const Database = require('better-sqlite3');
// Remove: const db = new Database(...);

const { createClient } = require('@libsql/client');
const db = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});
```

### Step 4 — Deploy via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel

# Add environment variables
vercel env add JWT_SECRET
vercel env add TURSO_URL
vercel env add TURSO_TOKEN

# Deploy to production
vercel --prod
```

---

## 🎨 UI Overview

### Auth Screen
- Split layout — sage green brand panel (left) + clean login form (right)
- Floating decorative note preview cards on the green panel
- Tab switcher between Sign in / Create account

### Dashboard
- Sticky header with logo, search bar, user pill, sign out button
- Filter tabs — All notes / Pinned / Shared with me
- Masonry card grid with hover lift effect
- Gold bookmark ribbon on pinned notes
- Blue left border on shared notes
- Green accent strip appears on card hover

### Modals
- **New/Edit Note** — title + textarea with Fira Code monospace font
- **View Note** — full content with badges (pinned/shared), action buttons
- **Share Note** — email input with shared-with chips
- **Version History** — list of snapshots, click to preview any version
- **Delete Confirm** — two-step confirmation

### Design Tokens
```
Background:  #F6F4EE (warm cream)
Surface:     #FFFFFF (white cards)
Primary:     #3A6B4F (sage green)
Text:        #1C1A16 (near black)
Muted:       #928D84 (warm grey)
Danger:      #C0392B (red)
Info:        #2563EB (blue, shared notes)
```

---

## 🔒 Security Notes

- Passwords hashed with **bcrypt** (salt rounds: 10)
- JWTs signed with `HS256`, expire in **7 days**
- Each token has a unique `jti` (JWT ID) — revoked on logout
- Revoked tokens stored in DB, checked on every authenticated request
- Old revoked tokens auto-purged after 7 days
- SQL injection protected via parameterized queries throughout
- Foreign keys enforced at DB level (`PRAGMA foreign_keys = ON`)

---

## 📜 Scripts

```bash
npm start      # Start server (node server.js)
npm run dev    # Start with nodemon (auto-restart on changes)
```
