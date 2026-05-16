const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'notes-app-secret-change-in-prod-2024';
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database Setup ─────────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || 'notes.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    email     TEXT    UNIQUE NOT NULL,
    password  TEXT    NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    is_pinned  INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS note_shares (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id             INTEGER NOT NULL,
    shared_with_user_id INTEGER NOT NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(note_id, shared_with_user_id),
    FOREIGN KEY (note_id)             REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS note_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT    PRIMARY KEY,
    revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Helpers ────────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatNote = (n) => ({
  id:         String(n.id),
  title:      n.title,
  content:    n.content,
  is_pinned:  Boolean(n.is_pinned),
  owner_id:   String(n.user_id),
  created_at: n.created_at,
  updated_at: n.updated_at,
});

const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token required' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    // Check if token has been revoked
    if (decoded.jti) {
      const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(decoded.jti);
      if (revoked) return res.status(401).json({ message: 'Token has been revoked. Please log in again.' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const canAccessNote = (noteId, userId) =>
  db.prepare(`
    SELECT n.* FROM notes n
    LEFT JOIN note_shares ns ON n.id = ns.note_id
    WHERE n.id = ? AND (n.user_id = ? OR ns.shared_with_user_id = ?)
    LIMIT 1
  `).get(noteId, userId, userId);

const ownsNote = (noteId, userId) =>
  db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(noteId, userId);

// ── Auth Routes ────────────────────────────────────────────────────────────────

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ message: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email.trim().toLowerCase(), hashed);
    return res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const access_token = jwt.sign(
    { id: user.id, email: user.email, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  return res.status(200).json({ access_token });
});

// POST /logout
app.post('/logout', authenticate, (req, res) => {
  try {
    const jti = req.user.jti;
    if (jti) {
      db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti) VALUES (?)').run(jti);
    }
    // Periodically clean up expired tokens (older than 7 days)
    db.prepare(`DELETE FROM revoked_tokens WHERE revoked_at < datetime('now', '-7 days')`).run();
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch {
    return res.status(500).json({ message: 'Logout failed' });
  }
});

// GET /notes  (paginated)
app.get('/notes', authenticate, (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
    SELECT DISTINCT n.* FROM notes n
    LEFT JOIN note_shares ns ON n.id = ns.note_id
    WHERE n.user_id = ? OR ns.shared_with_user_id = ?
    ORDER BY n.is_pinned DESC, n.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, req.user.id, limit, offset);

  const { total } = db.prepare(`
    SELECT COUNT(DISTINCT n.id) AS total FROM notes n
    LEFT JOIN note_shares ns ON n.id = ns.note_id
    WHERE n.user_id = ? OR ns.shared_with_user_id = ?
  `).get(req.user.id, req.user.id);

  return res.status(200).json({
    data: rows.map(formatNote),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// GET /notes/:id
app.get('/notes/:id', authenticate, (req, res) => {
  if (isNaN(req.params.id)) return res.status(400).json({ message: 'Invalid note id' });
  const note = canAccessNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ message: 'Note not found' });
  return res.status(200).json(formatNote(note));
});

// POST /notes
app.post('/notes', authenticate, (req, res) => {
  const { title, content } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'Content is required' });
  }
  if (title.length > 255) {
    return res.status(400).json({ message: 'Title must be under 255 characters' });
  }

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)'
  ).run(req.user.id, title.trim(), content.trim());

  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(lastInsertRowid);
  return res.status(201).json(formatNote(note));
});

// PUT /notes/:id
app.put('/notes/:id', authenticate, (req, res) => {
  if (isNaN(req.params.id)) return res.status(400).json({ message: 'Invalid note id' });

  const note = ownsNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ message: 'Note not found or access denied' });

  const { title, content, is_pinned } = req.body ?? {};
  if (title === undefined && content === undefined && is_pinned === undefined) {
    return res.status(400).json({ message: 'At least one field (title, content, is_pinned) required' });
  }
  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ message: 'Title must be a string' });
  }
  if (title && title.length > 255) {
    return res.status(400).json({ message: 'Title must be under 255 characters' });
  }

  // Save version history before update
  db.prepare(
    'INSERT INTO note_versions (note_id, title, content) VALUES (?, ?, ?)'
  ).run(note.id, note.title, note.content);

  const newTitle   = (title   !== undefined ? title.trim()   : note.title);
  const newContent = (content !== undefined ? content.trim() : note.content);
  const newPinned  = (is_pinned !== undefined ? (is_pinned ? 1 : 0) : note.is_pinned);

  if (!newTitle) return res.status(400).json({ message: 'Title cannot be empty' });
  if (!newContent) return res.status(400).json({ message: 'Content cannot be empty' });

  db.prepare(
    'UPDATE notes SET title = ?, content = ?, is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(newTitle, newContent, newPinned, note.id);

  return res.status(200).json(formatNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id)));
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticate, (req, res) => {
  if (isNaN(req.params.id)) return res.status(400).json({ message: 'Invalid note id' });

  const note = ownsNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ message: 'Note not found or access denied' });

  db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
  return res.status(204).send();
});

// POST /notes/:id/share
app.post('/notes/:id/share', authenticate, (req, res) => {
  if (isNaN(req.params.id)) return res.status(400).json({ message: 'Invalid note id' });

  const note = ownsNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ message: 'Note not found or you are not the owner' });

  const { share_with_email } = req.body ?? {};
  if (!share_with_email || typeof share_with_email !== 'string' || !EMAIL_RE.test(share_with_email.trim())) {
    return res.status(400).json({ message: 'Valid share_with_email is required' });
  }

  const target = db.prepare('SELECT * FROM users WHERE email = ?').get(share_with_email.trim().toLowerCase());
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ message: 'Cannot share a note with yourself' });

  try {
    db.prepare('INSERT INTO note_shares (note_id, shared_with_user_id) VALUES (?, ?)').run(note.id, target.id);
    return res.status(200).json({ message: 'Note shared successfully' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ message: 'Note already shared with this user' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Custom Features ────────────────────────────────────────────────────────────

// PATCH /notes/:id/pin  →  toggle pin
app.patch('/notes/:id/pin', authenticate, (req, res) => {
  if (isNaN(req.params.id)) return res.status(400).json({ message: 'Invalid note id' });

  const note = ownsNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ message: 'Note not found or access denied' });

  const newPinned = note.is_pinned ? 0 : 1;
  db.prepare('UPDATE notes SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPinned, note.id);
  return res.status(200).json(formatNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id)));
});

// GET /notes/:id/versions  →  version history
app.get('/notes/:id/versions', authenticate, (req, res) => {
  if (isNaN(req.params.id)) return res.status(400).json({ message: 'Invalid note id' });

  const note = ownsNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ message: 'Note not found or access denied' });

  const versions = db.prepare(
    'SELECT id, note_id, title, content, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC'
  ).all(note.id);

  return res.status(200).json(versions);
});

// ── Stretch Goals ──────────────────────────────────────────────────────────────

// GET /search?q=keyword
app.get('/search', authenticate, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ message: 'Query parameter q is required' });

  const kw = `%${q}%`;
  const rows = db.prepare(`
    SELECT DISTINCT n.* FROM notes n
    LEFT JOIN note_shares ns ON n.id = ns.note_id
    WHERE (n.user_id = ? OR ns.shared_with_user_id = ?)
      AND (n.title LIKE ? OR n.content LIKE ?)
    ORDER BY n.is_pinned DESC, n.updated_at DESC
  `).all(req.user.id, req.user.id, kw, kw);

  return res.status(200).json(rows.map(formatNote));
});

// ── Meta Routes ────────────────────────────────────────────────────────────────

// GET /about
app.get('/about', (_req, res) => {
  res.status(200).json({
    name:  'Kiran',
    email: 'kiran@example.com',
    'my features': {
      'Note Pinning':
        'PATCH /notes/:id/pin toggles a pin on any owned note. ' +
        'Pinned notes always appear at the top of GET /notes results, ' +
        'making high-priority notes instantly accessible without searching.',
      'Note Version History':
        'GET /notes/:id/versions returns the full edit history for a note. ' +
        'Every PUT automatically snapshots the previous state, protecting ' +
        'users from accidental overwrites or data loss.',
      'Full-Text Search':
        'GET /search?q=keyword searches across titles and content of all ' +
        'owned and shared notes simultaneously, enabling fast discovery ' +
        'without browsing through every note.',
    },
  });
});

// GET /openapi.json
app.get('/openapi.json', (_req, res) => {
  res.status(200).json({
    openapi: '3.0.3',
    info: { title: 'Notes API', version: '1.0.0', description: 'Multi-user notes service REST API' },
    servers: [{ url: process.env.BASE_URL || `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Note: {
          type: 'object',
          properties: {
            id:         { type: 'string' },
            title:      { type: 'string' },
            content:    { type: 'string' },
            is_pinned:  { type: 'boolean' },
            owner_id:   { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
    paths: {
      '/register': {
        post: {
          summary: 'Register a new user',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['email','password'], properties: { email: { type: 'string' }, password: { type: 'string', minLength: 6 } } } } },
          },
          responses: {
            '201': { description: 'User created' },
            '400': { description: 'Validation error' },
            '409': { description: 'Email already registered' },
          },
        },
      },
      '/login': {
        post: {
          summary: 'Authenticate user and get JWT',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['email','password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
          },
          responses: {
            '200': { description: 'JWT token', content: { 'application/json': { schema: { type: 'object', properties: { access_token: { type: 'string' } } } } } },
            '401': { description: 'Invalid credentials' },
          },
        },
      },
      '/notes': {
        get: {
          summary: 'Get all notes (owned + shared), paginated',
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: 'query', name: 'page',  schema: { type: 'integer', default: 1 } },
            { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': { description: 'List of notes with pagination metadata' },
            '401': { description: 'Unauthorized' },
          },
        },
        post: {
          summary: 'Create a new note',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['title','content'], properties: { title: { type: 'string' }, content: { type: 'string' } } } } },
          },
          responses: {
            '201': { description: 'Note created', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Note' } } } },
            '400': { description: 'Validation error' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/notes/{id}': {
        get: {
          summary: 'Get a specific note',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Note data' }, '404': { description: 'Not found' }, '401': { description: 'Unauthorized' } },
        },
        put: {
          summary: 'Update a note',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, is_pinned: { type: 'boolean' } } } } } },
          responses: { '200': { description: 'Updated note' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' } },
        },
        delete: {
          summary: 'Delete a note',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } },
        },
      },
      '/notes/{id}/share': {
        post: {
          summary: 'Share a note with another user',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['share_with_email'], properties: { share_with_email: { type: 'string', format: 'email' } } } } } },
          responses: { '200': { description: 'Note shared' }, '404': { description: 'Note or user not found' } },
        },
      },
      '/notes/{id}/pin': {
        patch: {
          summary: 'Toggle pin status on a note',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated note' }, '404': { description: 'Not found' } },
        },
      },
      '/notes/{id}/versions': {
        get: {
          summary: 'Get edit history of a note',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'List of previous versions' }, '404': { description: 'Not found' } },
        },
      },
      '/search': {
        get: {
          summary: 'Full-text search across notes',
          security: [{ bearerAuth: [] }],
          parameters: [{ in: 'query', name: 'q', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Matching notes' }, '400': { description: 'Query required' } },
        },
      },
      '/about': {
        get: {
          summary: 'Info about the developer and custom features',
          responses: { '200': { description: 'About info' } },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI specification',
          responses: { '200': { description: 'OpenAPI 3.0 JSON' } },
        },
      },
    },
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Notes API running → http://localhost:${PORT}`);
});
