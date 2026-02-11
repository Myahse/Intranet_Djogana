const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const multer = require('multer')
const cors = require('cors')
const { Pool } = require('pg')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const admin = require('firebase-admin')

// ---------- Firebase Admin SDK ----------
// Initialize using a service account JSON key.
// Set GOOGLE_APPLICATION_CREDENTIALS env var to the path of the JSON file,
// or set FIREBASE_SERVICE_ACCOUNT_JSON env var to the JSON content as a string.
;(() => {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (raw) {
      const serviceAccount = JSON.parse(raw)
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      })
      console.log('[firebase] initialized from FIREBASE_SERVICE_ACCOUNT_JSON')
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      })
      console.log('[firebase] initialized from GOOGLE_APPLICATION_CREDENTIALS')
    } else {
      console.warn(
        '[firebase] WARNING: No Firebase credentials found. Push notifications will NOT work.\n' +
        '  Set FIREBASE_SERVICE_ACCOUNT_JSON (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (file path).'
      )
      admin.initializeApp() // no-op init so admin.messaging() doesn't crash
    }
  } catch (err) {
    console.error('[firebase] initialization error:', err.message)
  }
})()

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set')
}
const DEVICE_REQUEST_EXPIRY_MINUTES = 15
const DEVICE_CODE_LENGTH = 6

const app = express()
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
app.use(express.json())

const BASE_URL = process.env.PUBLIC_BASE_URL
if (!BASE_URL) {
  throw new Error('PUBLIC_BASE_URL is not set')
}
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

// Use verify-full to match current pg behavior and silence the sslmode deprecation warning
const connectionString =
  DATABASE_URL.replace(/sslmode=require(?=&|$)/i, 'sslmode=verify-full') ||
  DATABASE_URL

const pool = new Pool({
  connectionString,
})

async function initDb() {
  // Directions: admin creates directions; each has a code (3-4 chars, uppercase) for file naming
  await pool.query(`
    CREATE TABLE IF NOT EXISTS directions (
      id uuid PRIMARY KEY,
      name text UNIQUE NOT NULL,
      code text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  try {
    await pool.query(`
      ALTER TABLE directions ADD COLUMN IF NOT EXISTS code text UNIQUE;
    `)
  } catch (_) { /* ignore */ }

  // Seed default direction for migration (existing folders/files get this)
  const defaultDirId = uuidv4()
  await pool.query(
    `
      INSERT INTO directions (id, name, code)
      VALUES ($1, 'Default', 'DEF')
      ON CONFLICT (name) DO NOTHING
    `,
    [defaultDirId]
  )
  await pool.query(
    `UPDATE directions SET code = 'DEF' WHERE code IS NULL AND name = 'Default'`
  )
  await pool.query(
    `UPDATE directions SET code = COALESCE(code, UPPER(LEFT(name, 4))) WHERE code IS NULL`
  )
  try {
    await pool.query(`ALTER TABLE directions ALTER COLUMN code SET NOT NULL`)
  } catch (_) { /* ignore */ }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      identifiant text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      direction_id uuid REFERENCES directions(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  // Add direction_id to users if missing (migration)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS direction_id uuid REFERENCES directions(id) ON DELETE SET NULL;
    `)
  } catch (_) { /* column may already exist */ }

  // Device login requests (GitHub-style: request access → approve on mobile → grant session)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_requests (
      id uuid PRIMARY KEY,
      user_identifiant text NOT NULL,
      code text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
      session_payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      approved_at timestamptz
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_login_requests_user_status
    ON login_requests (user_identifiant, status)
    WHERE status = 'pending';
  `)

  // FCM device push tokens per user (so notifications survive server restarts)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      user_identifiant text NOT NULL,
      expo_push_token text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_identifiant, expo_push_token)
    );
  `)
  // Migration: add fcm_token column for Firebase Cloud Messaging
  try {
    await pool.query(`ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS fcm_token text`)
  } catch (_) { /* column may already exist */ }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  try {
    await pool.query(`
      ALTER TABLE folders ADD COLUMN IF NOT EXISTS direction_id uuid REFERENCES directions(id) ON DELETE CASCADE;
    `)
  } catch (_) { /* ignore */ }
  // Backfill folders without direction_id to default direction
  const defaultDir = await pool.query("SELECT id FROM directions WHERE name = 'Default' LIMIT 1")
  if (defaultDir.rows.length > 0) {
    await pool.query('UPDATE folders SET direction_id = $1 WHERE direction_id IS NULL', [
      defaultDir.rows[0].id,
    ])
    try {
      await pool.query('ALTER TABLE folders ALTER COLUMN direction_id SET NOT NULL')
    } catch (_) { /* already not null or constraint */ }
    try {
      await pool.query('ALTER TABLE folders DROP CONSTRAINT IF EXISTS folders_name_key')
    } catch (_) { /* ignore */ }
    try {
      await pool.query(
        'ALTER TABLE folders ADD CONSTRAINT folders_direction_name_key UNIQUE (direction_id, name)'
      )
    } catch (_) { /* ignore if exists */ }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      mime_type text NOT NULL,
      size bigint NOT NULL,
      folder text NOT NULL,
      direction_id uuid REFERENCES directions(id) ON DELETE CASCADE,
      uploaded_by uuid,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_uploaded_by
        FOREIGN KEY (uploaded_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );
  `)

  try {
    await pool.query(`
      ALTER TABLE files ADD COLUMN IF NOT EXISTS direction_id uuid REFERENCES directions(id) ON DELETE CASCADE;
    `)
  } catch (_) { /* column may already exist */ }

  // Links (URLs: websites, GitHub repos, etc.) per folder/direction
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id uuid PRIMARY KEY,
      folder text NOT NULL,
      direction_id uuid NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
      url text NOT NULL,
      label text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  // ---- Roles & permissions (RBAC) ----
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id uuid PRIMARY KEY,
      name text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id uuid PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
      can_create_folder boolean NOT NULL DEFAULT false,
      can_upload_file boolean NOT NULL DEFAULT false,
      can_delete_file boolean NOT NULL DEFAULT false,
      can_delete_folder boolean NOT NULL DEFAULT false,
      can_create_user boolean NOT NULL DEFAULT false,
      can_delete_user boolean NOT NULL DEFAULT false,
      can_create_direction boolean NOT NULL DEFAULT false,
      can_delete_direction boolean NOT NULL DEFAULT false,
      can_view_activity_log boolean NOT NULL DEFAULT false
    );
  `)
  try {
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_create_user boolean NOT NULL DEFAULT false')
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_delete_user boolean NOT NULL DEFAULT false')
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_create_direction boolean NOT NULL DEFAULT false')
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_delete_direction boolean NOT NULL DEFAULT false')
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_view_activity_log boolean NOT NULL DEFAULT false')
  } catch (_) { /* ignore */ }

  // Activity / audit log: who did what, when (per direction for access control)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id uuid PRIMARY KEY,
      action text NOT NULL,
      actor_identifiant text,
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      direction_id uuid REFERENCES directions(id) ON DELETE SET NULL,
      entity_type text,
      entity_id text,
      details jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at DESC);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_direction_id ON activity_log (direction_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folder_role_visibility (
      folder_name text NOT NULL,
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      can_view boolean NOT NULL DEFAULT true,
      PRIMARY KEY (folder_name, role_id)
    );
  `)

  // Seed default roles & permissions (admin, user)
  const adminRoleId = uuidv4()
  await pool.query(
    `
      INSERT INTO roles (id, name)
      VALUES ($1, 'admin')
      ON CONFLICT (name) DO NOTHING
    `,
    [adminRoleId]
  )

  const userRoleId = uuidv4()
  await pool.query(
    `
      INSERT INTO roles (id, name)
      VALUES ($1, 'user')
      ON CONFLICT (name) DO NOTHING
    `,
    [userRoleId]
  )

  // Give admin full permissions by default (including activity log)
  await pool.query(
    `
      INSERT INTO role_permissions (role_id, can_create_folder, can_upload_file, can_delete_file, can_delete_folder, can_create_user, can_delete_user, can_create_direction, can_delete_direction, can_view_activity_log)
      SELECT id, true, true, true, true, true, true, true, true, true
      FROM roles
      WHERE name = 'admin'
      ON CONFLICT (role_id)
      DO UPDATE SET
        can_create_folder = EXCLUDED.can_create_folder,
        can_upload_file = EXCLUDED.can_upload_file,
        can_delete_file = EXCLUDED.can_delete_file,
        can_delete_folder = EXCLUDED.can_delete_folder,
        can_create_user = EXCLUDED.can_create_user,
        can_delete_user = EXCLUDED.can_delete_user,
        can_create_direction = EXCLUDED.can_create_direction,
        can_delete_direction = EXCLUDED.can_delete_direction,
        can_view_activity_log = COALESCE(role_permissions.can_view_activity_log, true)
    `
  )

  // Regular "user" has no special permissions by default (all false)
  await pool.query(
    `
      INSERT INTO role_permissions (role_id)
      SELECT id
      FROM roles
      WHERE name = 'user'
      ON CONFLICT (role_id) DO NOTHING
    `
  )
}

const upload = multer({ storage: multer.memoryStorage() })

// ---------- Activity log (audit trail) ----------
async function insertActivityLog(pool, opts) {
  const {
    action,
    actorIdentifiant = null,
    actorId = null,
    directionId = null,
    entityType = null,
    entityId = null,
    details = null,
  } = opts || {}
  if (!action) return
  const id = uuidv4()
  await pool.query(
    `INSERT INTO activity_log (id, action, actor_identifiant, actor_id, direction_id, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      String(action),
      actorIdentifiant || null,
      actorId || null,
      directionId || null,
      entityType || null,
      entityId != null ? String(entityId) : null,
      details != null ? JSON.stringify(details) : null,
    ]
  )
}

// ---------- JWT helpers (for device-approval flow: mobile uses token to list/approve) ----------
function signToken(identifiant) {
  return jwt.sign(
    { identifiant, type: 'auth' },
    JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  )
}

function getOptionalAuthUser(req) {
  const authHeader = req.headers && req.headers.authorization
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.slice(7)
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    return decoded && decoded.identifiant ? decoded.identifiant : null
  } catch (_) {
    return null
  }
}

function requireAuth(req, res, next) {
  const identifiant = getOptionalAuthUser(req)
  if (!identifiant) {
    return res.status(401).json({ error: 'Authentification requise.' })
  }
  req.authIdentifiant = identifiant
  next()
}

function randomCode(len) {
  const digits = '0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += digits[Math.floor(Math.random() * digits.length)]
  return s
}

// ---------- Auth ----------

// ---------- Directions (admin creates; users/folders belong to one) ----------

// Direction code: 3–4 letters or digits, uppercase (used as prefix for file names, e.g. SUM_)
function validateDirectionCode(raw) {
  const s = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s.length < 3 || s.length > 4) return null
  return s
}

app.get('/api/directions', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, code, created_at FROM directions ORDER BY name'
    )
    return res.json(result.rows)
  } catch (err) {
    console.error('list directions error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des directions.' })
  }
})

app.post('/api/directions', async (req, res) => {
  try {
    const { name, code: rawCode, identifiant } = req.body || {}
    const trimmed = (name || '').trim()
    if (!trimmed) {
      return res.status(400).json({ error: 'Nom de la direction requis.' })
    }
    const code = validateDirectionCode(rawCode)
    if (!code) {
      return res.status(400).json({
        error: 'Code requis : 3 à 4 caractères (lettres ou chiffres), ex. 02 ou SUM.',
      })
    }
    if (identifiant) {
      const perms = await getPermissionsForIdentifiant(identifiant)
      if (perms && !perms.can_create_direction) {
        return res.status(403).json({ error: 'Vous n’avez pas le droit de créer des directions.' })
      }
    }
    const id = uuidv4()
    await pool.query(
      'INSERT INTO directions (id, name, code) VALUES ($1, $2, $3)',
      [id, trimmed, code]
    )
    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'create_direction',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId: id,
      entityType: 'direction',
      entityId: id,
      details: { name: trimmed, code },
    })
    return res.status(201).json({ id, name: trimmed, code })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Une direction avec ce nom ou ce code existe déjà.' })
    }
    console.error('create direction error', err)
    return res.status(500).json({ error: 'Erreur lors de la création de la direction.' })
  }
})

app.delete('/api/directions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const callerIdentifiant = req.query.identifiant || req.body?.identifiant
    if (callerIdentifiant) {
      const perms = await getPermissionsForIdentifiant(callerIdentifiant)
      if (perms && !perms.can_delete_direction) {
        return res.status(403).json({ error: 'Vous n’avez pas le droit de supprimer des directions.' })
      }
    }

    const dirRow = await pool.query('SELECT id, name, code FROM directions WHERE id = $1', [id])
    if (dirRow.rows.length === 0) {
      return res.status(404).json({ error: 'Direction introuvable.' })
    }
    let actorId = null
    if (callerIdentifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'delete_direction',
      actorIdentifiant: callerIdentifiant || null,
      actorId,
      directionId: id,
      entityType: 'direction',
      entityId: id,
      details: { name: dirRow.rows[0].name, code: dirRow.rows[0].code },
    })

    const result = await pool.query('DELETE FROM directions WHERE id = $1 RETURNING id', [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Direction introuvable.' })
    }
    return res.status(204).send()
  } catch (err) {
    if (err && err.code === '23503') {
      return res.status(400).json({ error: 'Impossible de supprimer : des utilisateurs ou dossiers utilisent cette direction.' })
    }
    console.error('delete direction error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression de la direction.' })
  }
})

app.get('/api/users', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.identifiant, u.role, u.direction_id, u.created_at,
             d.name AS direction_name
      FROM users u
      LEFT JOIN directions d ON d.id = u.direction_id
      ORDER BY u.created_at DESC
    `)
    return res.json(
      result.rows.map((r) => ({
        id: r.id,
        identifiant: r.identifiant,
        role: r.role,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        created_at: r.created_at,
      }))
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('list users error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' })
  }
})

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const callerIdentifiant = req.query.identifiant || req.body?.identifiant
    if (callerIdentifiant) {
      const perms = await getPermissionsForIdentifiant(callerIdentifiant)
      if (perms && !perms.can_delete_user) {
        return res.status(403).json({ error: 'Vous n’avez pas le droit de supprimer des utilisateurs.' })
      }
    }

    const userRow = await pool.query(
      'SELECT id, identifiant, role, direction_id FROM users WHERE id = $1',
      [id]
    )
    if (userRow.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const deletedUser = userRow.rows[0]
    let actorId = null
    if (callerIdentifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'delete_user',
      actorIdentifiant: callerIdentifiant || null,
      actorId,
      directionId: deletedUser.direction_id,
      entityType: 'user',
      entityId: id,
      details: { identifiant: deletedUser.identifiant, role: deletedUser.role },
    })

    await pool.query('DELETE FROM users WHERE id = $1', [id])
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('delete user error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression de l’utilisateur.' })
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { identifiant, password, role, direction_id: directionId, caller_identifiant: callerIdentifiant } = req.body || {}
    if (!identifiant || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe sont requis.' })
    }

    if (callerIdentifiant) {
      const perms = await getPermissionsForIdentifiant(callerIdentifiant)
      if (perms && !perms.can_create_user) {
        return res.status(403).json({ error: 'Vous n’avez pas le droit de créer des utilisateurs.' })
      }
    }

    const hashed = await bcrypt.hash(password, 10)
    const id = uuidv4()

    let finalRole
    if (role && typeof role === 'string' && role.trim()) {
      const trimmed = role.trim()
      const roleRes = await pool.query('SELECT name FROM roles WHERE name = $1', [trimmed])
      if (roleRes.rows.length === 0) {
        return res.status(400).json({ error: 'Rôle invalide.' })
      }
      finalRole = trimmed
    } else {
      finalRole = identifiant === '1234567890' ? 'admin' : 'user'
    }

    // Non-admin users must be assigned to a direction
    if (finalRole !== 'admin' && (!directionId || typeof directionId !== 'string')) {
      return res.status(400).json({
        error: 'Une direction doit être sélectionnée pour cet utilisateur.',
      })
    }
    if (finalRole !== 'admin' && directionId) {
      const dirRes = await pool.query('SELECT id FROM directions WHERE id = $1', [directionId])
      if (dirRes.rows.length === 0) {
        return res.status(400).json({ error: 'Direction invalide.' })
      }
    }

    await pool.query(
      `INSERT INTO users (id, identifiant, password_hash, role, direction_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, identifiant, hashed, finalRole, finalRole === 'admin' ? null : directionId]
    )

    let actorId = null
    if (callerIdentifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'create_user',
      actorIdentifiant: callerIdentifiant || null,
      actorId,
      directionId: finalRole === 'admin' ? null : directionId,
      entityType: 'user',
      entityId: id,
      details: { identifiant, role: finalRole },
    })

    return res.status(201).json({ id, identifiant, role: finalRole, direction_id: finalRole === 'admin' ? null : directionId })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Identifiant déjà utilisé.' })
    }
    // eslint-disable-next-line no-console
    console.error('register error', err)
    return res.status(500).json({ error: 'Erreur lors de la création de l’utilisateur.' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifiant, password } = req.body || {}
    if (!identifiant || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe sont requis.' })
    }

    const result = await pool.query(
      `SELECT u.id, u.identifiant, u.password_hash, u.role, u.direction_id, d.name AS direction_name
       FROM users u
       LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides.' })
    }

    const user = result.rows[0]
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) {
      return res.status(401).json({ error: 'Identifiants invalides.' })
    }

    const permissions = await getPermissionsForIdentifiant(user.identifiant)
    const token = signToken(user.identifiant)

    return res.json({
      id: user.id,
      identifiant: user.identifiant,
      role: user.role,
      direction_id: user.direction_id,
      direction_name: user.direction_name || null,
      permissions: permissions || undefined,
      token,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('login error', err)
    return res.status(500).json({ error: 'Erreur lors de la connexion.' })
  }
})

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { identifiant, currentPassword, newPassword } = req.body || {}
    if (!identifiant || !currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: 'Identifiant, mot de passe actuel et nouveau mot de passe sont requis.' })
    }

    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides.' })
    }

    const user = result.rows[0]
    const ok = await bcrypt.compare(currentPassword, user.password_hash)
    if (!ok) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' })
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, user.id])

    return res.json({ success: true })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('change-password error', err)
    return res.status(500).json({ error: 'Erreur lors du changement de mot de passe.' })
  }
})

// ---------- Device approval flow (GitHub-style: request on web → approve on mobile) ----------

// Create a login request: user enters identifiant (and optionally password); returns requestId + code to show
app.post('/api/auth/device/request', async (req, res) => {
  try {
    const { identifiant, password } = req.body || {}
    const ident = (identifiant || '').trim()
    if (!ident) {
      return res.status(400).json({ error: 'Identifiant requis.' })
    }

    const result = await pool.query(
      `SELECT u.id, u.identifiant, u.password_hash, u.role, u.direction_id, d.name AS direction_name
       FROM users u
       LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [ident]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun compte avec cet identifiant.' })
    }

    if (password) {
      const ok = await bcrypt.compare(password, result.rows[0].password_hash)
      if (!ok) {
        return res.status(401).json({ error: 'Mot de passe incorrect.' })
      }
    }

    const requestId = uuidv4()
    const code = randomCode(DEVICE_CODE_LENGTH)
    const expiresAt = new Date(Date.now() + DEVICE_REQUEST_EXPIRY_MINUTES * 60 * 1000)

    // Cancel all previous pending requests for this user so only the latest one is active
    await pool.query(
      `UPDATE login_requests SET status = 'denied'
       WHERE user_identifiant = $1 AND status = 'pending'`,
      [ident]
    )

    await pool.query(
      `INSERT INTO login_requests (id, user_identifiant, code, status, expires_at)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [requestId, ident, code, expiresAt]
    )

    // Notify registered mobile devices for this identifiant via Firebase (fire-and-forget)
    const tokenRows = await pool.query(
      'SELECT expo_push_token, fcm_token FROM push_tokens WHERE user_identifiant = $1',
      [ident]
    )
    // eslint-disable-next-line no-console
    console.log('[push] device request for', ident, '→', tokenRows.rows.length, 'token(s)')
    if (tokenRows.rows.length > 0) {
      ;(async () => {
        try {
          const messaging = admin.messaging()
          for (const row of tokenRows.rows) {
            // Prefer fcm_token (direct Firebase), fall back to expo_push_token
            const deviceToken = row.fcm_token || row.expo_push_token
            if (!deviceToken) continue

            try {
              const result = await messaging.send({
                token: deviceToken,
                notification: {
                  title: 'Nouvelle demande de connexion',
                  body: `Code: ${code}`,
                },
                data: {
                  requestId: String(requestId),
                  code: String(code),
                },
                android: {
                  priority: 'high',
                  notification: {
                    channelId: 'default',
                    sound: 'default',
                    priority: 'high',
                  },
                },
              })
              // eslint-disable-next-line no-console
              console.log('[push] FCM sent successfully, messageId:', result)
            } catch (sendErr) {
              // eslint-disable-next-line no-console
              console.error('[push] FCM send error for token', deviceToken.slice(0, 20) + '...', sendErr.message)
              // If the token is invalid/unregistered, clean it up
              if (
                sendErr.code === 'messaging/invalid-registration-token' ||
                sendErr.code === 'messaging/registration-token-not-registered'
              ) {
                await pool.query(
                  'DELETE FROM push_tokens WHERE user_identifiant = $1 AND (fcm_token = $2 OR expo_push_token = $2)',
                  [ident, deviceToken]
                )
                // eslint-disable-next-line no-console
                console.log('[push] removed stale token for', ident)
              }
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[push] FCM batch error', err)
        }
      })()
    }

    return res.status(201).json({
      requestId,
      code,
      expiresAt: expiresAt.toISOString(),
      expiresIn: DEVICE_REQUEST_EXPIRY_MINUTES * 60,
      message: 'Ouvrez l’application Djogana sur votre téléphone et validez cette connexion.',
    })
  } catch (err) {
    console.error('device request error', err)
    return res.status(500).json({ error: 'Erreur lors de la demande de connexion.' })
  }
})

// Register an FCM device push token for the authenticated user (persisted in DB)
// Accepts { fcmToken } (new Firebase flow) or { expoPushToken } (legacy Expo flow)
app.post('/api/auth/device/push-token', (req, _res, next) => {
  // eslint-disable-next-line no-console
  console.log('[push] POST /push-token hit (before auth)')
  next()
}, requireAuth, async (req, res) => {
  const identifiant = req.authIdentifiant
  // eslint-disable-next-line no-console
  console.log('[push] push-token request received for', identifiant)
  try {
    const { fcmToken, expoPushToken } = req.body || {}
    const token = fcmToken || expoPushToken
    if (!token || typeof token !== 'string') {
      // eslint-disable-next-line no-console
      console.log('[push] push-token rejected: missing or invalid token')
      return res.status(400).json({ error: 'fcmToken ou expoPushToken requis.' })
    }
    // Store using the token as the primary key value (expo_push_token column)
    // and also store the fcm_token separately for Firebase sending
    await pool.query(
      `INSERT INTO push_tokens (user_identifiant, expo_push_token, fcm_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_identifiant, expo_push_token) DO UPDATE SET created_at = now(), fcm_token = COALESCE($3, push_tokens.fcm_token)`,
      [identifiant, token, fcmToken || null]
    )
    // eslint-disable-next-line no-console
    console.log('[push] token registered for', identifiant, 'token:', token.slice(0, 30) + '...', fcmToken ? '(FCM)' : '(Expo)')
    return res.json({ success: true })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('push-token error', err)
    return res.status(500).json({ error: "Erreur lors de l'enregistrement du token." })
  }
})

// Check if the current user has at least one push token registered (for debugging / UI)
app.get('/api/auth/device/push-token/status', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT 1 FROM push_tokens WHERE user_identifiant = $1 LIMIT 1',
      [req.authIdentifiant]
    )
    return res.json({ registered: result.rows.length > 0 })
  } catch (err) {
    return res.status(500).json({ registered: false })
  }
})

// List pending login requests for the authenticated user (mobile app with JWT)
app.get('/api/auth/device/requests', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const result = await pool.query(
      `SELECT id, code, status, created_at, expires_at
       FROM login_requests
       WHERE user_identifiant = $1 AND status = 'pending' AND expires_at > now()
       ORDER BY created_at DESC`,
      [identifiant]
    )
    return res.json(
      result.rows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }))
    )
  } catch (err) {
    console.error('device requests list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des demandes.' })
  }
})

// Get a single pending request by code (mobile: type the code from the web modal)
app.get('/api/auth/device/request-by-code', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const code = (req.query.code || '').trim()
    if (!code) {
      return res.status(400).json({ error: 'Code requis.' })
    }
    const result = await pool.query(
      `SELECT id, code, status, created_at, expires_at
       FROM login_requests
       WHERE user_identifiant = $1 AND code = $2 AND status = 'pending' AND expires_at > now()`,
      [identifiant, code]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune demande avec ce code.' })
    }
    const r = result.rows[0]
    return res.json({
      id: r.id,
      code: r.code,
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })
  } catch (err) {
    console.error('device request-by-code error', err)
    return res.status(500).json({ error: 'Erreur lors de la recherche.' })
  }
})

// Approve a login request (mobile app with JWT)
app.post('/api/auth/device/approve', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const { requestId } = req.body || {}
    if (!requestId) {
      return res.status(400).json({ error: 'requestId requis.' })
    }

    const reqRow = await pool.query(
      `SELECT id, user_identifiant, status FROM login_requests WHERE id = $1`,
      [requestId]
    )
    if (reqRow.rows.length === 0) {
      return res.status(404).json({ error: 'Demande introuvable.' })
    }
    if (reqRow.rows[0].user_identifiant !== identifiant) {
      return res.status(403).json({ error: 'Vous ne pouvez approuver que vos propres demandes.' })
    }
    if (reqRow.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Cette demande a déjà été traitée.' })
    }

    const userRes = await pool.query(
      `SELECT u.id, u.identifiant, u.role, u.direction_id, d.name AS direction_name
       FROM users u
       LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(500).json({ error: 'Utilisateur introuvable.' })
    }
    const user = userRes.rows[0]
    const permissions = await getPermissionsForIdentifiant(identifiant)
    const sessionPayload = {
      identifiant: user.identifiant,
      role: user.role,
      direction_id: user.direction_id || null,
      direction_name: user.direction_name || null,
      permissions: permissions || undefined,
    }

    await pool.query(
      `UPDATE login_requests SET status = 'approved', session_payload = $1, approved_at = now() WHERE id = $2`,
      [JSON.stringify(sessionPayload), requestId]
    )

    return res.json({ success: true, requestId })
  } catch (err) {
    console.error('device approve error', err)
    return res.status(500).json({ error: 'Erreur lors de l’approbation.' })
  }
})

// Deny a login request (mobile app with JWT)
app.post('/api/auth/device/deny', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const { requestId } = req.body || {}
    if (!requestId) {
      return res.status(400).json({ error: 'requestId requis.' })
    }

    const reqRow = await pool.query(
      `SELECT id, user_identifiant, status FROM login_requests WHERE id = $1`,
      [requestId]
    )
    if (reqRow.rows.length === 0) {
      return res.status(404).json({ error: 'Demande introuvable.' })
    }
    if (reqRow.rows[0].user_identifiant !== identifiant) {
      return res.status(403).json({ error: 'Vous ne pouvez refuser que vos propres demandes.' })
    }
    if (reqRow.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Cette demande a déjà été traitée.' })
    }

    await pool.query(`UPDATE login_requests SET status = 'denied' WHERE id = $1`, [requestId])
    return res.json({ success: true, requestId })
  } catch (err) {
    console.error('device deny error', err)
    return res.status(500).json({ error: 'Erreur lors du refus.' })
  }
})

// Poll for login request status (web: no auth; returns user when approved)
app.get('/api/auth/device/poll/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params
    const result = await pool.query(
      `SELECT status, session_payload, expires_at FROM login_requests WHERE id = $1`,
      [requestId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande introuvable.', status: 'not_found' })
    }

    const row = result.rows[0]
    if (row.status === 'pending') {
      if (new Date(row.expires_at) < new Date()) {
        await pool.query(`UPDATE login_requests SET status = 'denied' WHERE id = $1`, [requestId])
        return res.json({ status: 'expired', message: 'Demande expirée.' })
      }
      return res.json({ status: 'pending' })
    }

    if (row.status === 'denied') {
      return res.json({ status: 'denied', message: 'Connexion refusée.' })
    }

    if (row.status === 'approved' && row.session_payload) {
      await pool.query(`UPDATE login_requests SET status = 'consumed' WHERE id = $1`, [requestId])
      return res.json({ status: 'approved', user: row.session_payload })
    }

    return res.json({ status: row.status })
  } catch (err) {
    console.error('device poll error', err)
    return res.status(500).json({ error: 'Erreur lors de la vérification.' })
  }
})

// ---------- Activity log API (audit trail; direction-based access) ----------
app.get('/api/activity-log', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const { direction_id: filterDirectionId, action: filterAction, limit = 100, offset = 0 } = req.query || {}

    const userRes = await pool.query(
      'SELECT role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur introuvable.' })
    }
    const user = userRes.rows[0]
    const perms = await getPermissionsForIdentifiant(identifiant)
    const canViewLog = user.role === 'admin' || (perms && perms.can_view_activity_log)
    if (!canViewLog) {
      return res.status(403).json({ error: 'Vous n’avez pas accès au journal d’activité.' })
    }

    const params = []
    let sql = `
      SELECT a.id, a.action, a.actor_identifiant, a.direction_id, a.entity_type, a.entity_id, a.details, a.created_at,
             d.name AS direction_name
      FROM activity_log a
      LEFT JOIN directions d ON d.id = a.direction_id
      WHERE 1=1
    `
    if (user.role !== 'admin') {
      params.push(user.direction_id)
      sql += ` AND a.direction_id = $${params.length}`
    }
    if (filterDirectionId && user.role === 'admin') {
      params.push(filterDirectionId)
      sql += ` AND a.direction_id = $${params.length}`
    }
    if (filterAction) {
      params.push(String(filterAction).trim())
      sql += ` AND a.action = $${params.length}`
    }
    sql += ` ORDER BY a.created_at DESC LIMIT ${Math.min(parseInt(limit, 10) || 100, 500)} OFFSET ${Math.max(0, parseInt(offset, 10) || 0)}`

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor_identifiant: row.actor_identifiant,
        direction_id: row.direction_id,
        direction_name: row.direction_name,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        details: row.details,
        created_at: row.created_at,
      }))
    )
  } catch (err) {
    console.error('activity-log list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération du journal d’activité.' })
  }
})

// ---------- Roles & permissions (RBAC) ----------

// Helper: get permissions for a user by identifiant (admin => all true)
async function getPermissionsForIdentifiant(identifiant) {
  const userRes = await pool.query(
    'SELECT role FROM users WHERE identifiant = $1',
    [identifiant]
  )
  if (userRes.rows.length === 0) return null
  const roleName = userRes.rows[0].role
  if (roleName === 'admin') {
    return {
      can_create_folder: true,
      can_upload_file: true,
      can_delete_file: true,
      can_delete_folder: true,
      can_create_user: true,
      can_delete_user: true,
      can_create_direction: true,
      can_delete_direction: true,
      can_view_activity_log: true,
    }
  }
  const permRes = await pool.query(
    `
      SELECT p.can_create_folder, p.can_upload_file, p.can_delete_file, p.can_delete_folder,
             p.can_create_user, p.can_delete_user, p.can_create_direction, p.can_delete_direction,
             p.can_view_activity_log
      FROM roles r
      JOIN role_permissions p ON p.role_id = r.id
      WHERE r.name = $1
    `,
    [roleName]
  )
  if (permRes.rows.length === 0) {
    return {
      can_create_folder: false,
      can_upload_file: false,
      can_delete_file: false,
      can_delete_folder: false,
      can_create_user: false,
      can_delete_user: false,
      can_create_direction: false,
      can_delete_direction: false,
      can_view_activity_log: false,
    }
  }
  const row = permRes.rows[0]
  return {
    can_create_folder: !!row.can_create_folder,
    can_upload_file: !!row.can_upload_file,
    can_delete_file: !!row.can_delete_file,
    can_delete_folder: !!row.can_delete_folder,
    can_create_user: !!row.can_create_user,
    can_delete_user: !!row.can_delete_user,
    can_create_direction: !!row.can_create_direction,
    can_delete_direction: !!row.can_delete_direction,
    can_view_activity_log: !!row.can_view_activity_log,
  }
}

// List roles with their global permissions
app.get('/api/roles', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.name,
        COALESCE(p.can_create_folder, false) AS can_create_folder,
        COALESCE(p.can_upload_file, false) AS can_upload_file,
        COALESCE(p.can_delete_file, false) AS can_delete_file,
        COALESCE(p.can_delete_folder, false) AS can_delete_folder,
        COALESCE(p.can_create_user, false) AS can_create_user,
        COALESCE(p.can_delete_user, false) AS can_delete_user,
        COALESCE(p.can_create_direction, false) AS can_create_direction,
        COALESCE(p.can_delete_direction, false) AS can_delete_direction,
        COALESCE(p.can_view_activity_log, false) AS can_view_activity_log
      FROM roles r
      LEFT JOIN role_permissions p ON p.role_id = r.id
      ORDER BY r.created_at DESC
    `)
    return res.json(result.rows)
  } catch (err) {
    console.error('list roles error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des rôles.' })
  }
})

// Create a new role (name must be unique)
app.post('/api/roles', async (req, res) => {
  try {
    const { name } = req.body || {}
    const trimmed = (name || '').trim()
    if (!trimmed) {
      return res.status(400).json({ error: 'Nom de rôle requis.' })
    }

    const id = uuidv4()

    const result = await pool.query(
      `
        INSERT INTO roles (id, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
      `,
      [id, trimmed]
    )

    const row = result.rows[0]
    if (!row) {
      // Role already existed, just return existing one
      const existing = await pool.query(
        'SELECT id, name FROM roles WHERE name = $1',
        [trimmed]
      )
      return res.status(200).json(existing.rows[0])
    }

    // Initialize permissions row with defaults (all false)
    await pool.query(
      `
        INSERT INTO role_permissions (role_id)
        VALUES ($1)
        ON CONFLICT (role_id) DO NOTHING
      `,
      [row.id]
    )

    return res.status(201).json(row)
  } catch (err) {
    console.error('create role error', err)
    return res.status(500).json({ error: 'Erreur lors de la création du rôle.' })
  }
})

// Update global permissions for a role
app.patch('/api/roles/:id/permissions', async (req, res) => {
  try {
    const { id } = req.params
    const {
      canCreateFolder,
      canUploadFile,
      canDeleteFile,
      canDeleteFolder,
      canCreateUser,
      canDeleteUser,
      canCreateDirection,
      canDeleteDirection,
      canViewActivityLog,
    } = req.body || {}

    // Ensure the role exists
    const roleRes = await pool.query('SELECT id FROM roles WHERE id = $1', [id])
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }

    // Upsert permissions row
    await pool.query(
      `
        INSERT INTO role_permissions (role_id, can_create_folder, can_upload_file, can_delete_file, can_delete_folder, can_create_user, can_delete_user, can_create_direction, can_delete_direction, can_view_activity_log)
        VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, false), COALESCE($5, false), COALESCE($6, false), COALESCE($7, false), COALESCE($8, false), COALESCE($9, false), COALESCE($10, false))
        ON CONFLICT (role_id)
        DO UPDATE SET
          can_create_folder = COALESCE($2, role_permissions.can_create_folder),
          can_upload_file = COALESCE($3, role_permissions.can_upload_file),
          can_delete_file = COALESCE($4, role_permissions.can_delete_file),
          can_delete_folder = COALESCE($5, role_permissions.can_delete_folder),
          can_create_user = COALESCE($6, role_permissions.can_create_user),
          can_delete_user = COALESCE($7, role_permissions.can_delete_user),
          can_create_direction = COALESCE($8, role_permissions.can_create_direction),
          can_delete_direction = COALESCE($9, role_permissions.can_delete_direction),
          can_view_activity_log = COALESCE($10, role_permissions.can_view_activity_log)
      `,
      [id, canCreateFolder, canUploadFile, canDeleteFile, canDeleteFolder, canCreateUser, canDeleteUser, canCreateDirection, canDeleteDirection, canViewActivityLog]
    )

    const updated = await pool.query(
      `
        SELECT
          r.id,
          r.name,
          p.can_create_folder,
          p.can_upload_file,
          p.can_delete_file,
          p.can_delete_folder,
          p.can_create_user,
          p.can_delete_user,
          p.can_create_direction,
          p.can_delete_direction,
          p.can_view_activity_log
        FROM roles r
        JOIN role_permissions p ON p.role_id = r.id
        WHERE r.id = $1
      `,
      [id]
    )

    return res.json(updated.rows[0])
  } catch (err) {
    console.error('update role permissions error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour des permissions.' })
  }
})

// Get / set folder visibility per role
app.get('/api/folder-permissions', async (req, res) => {
  try {
    const { folderName, roleId } = req.query

    const params = []
    let sql = `
      SELECT
        v.folder_name,
        r.id AS role_id,
        r.name AS role_name,
        v.can_view
      FROM folder_role_visibility v
      JOIN roles r ON r.id = v.role_id
    `

    const conditions = []
    if (folderName) {
      params.push(folderName)
      conditions.push(`v.folder_name = $${params.length}`)
    }
    if (roleId) {
      params.push(roleId)
      conditions.push(`r.id = $${params.length}`)
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY v.folder_name, r.name'

    const result = await pool.query(sql, params)
    return res.json(result.rows)
  } catch (err) {
    console.error('list folder permissions error', err)
    return res
      .status(500)
      .json({ error: 'Erreur lors de la récupération des permissions de dossiers.' })
  }
})

app.post('/api/folder-permissions', async (req, res) => {
  try {
    const { folderName, roleId, canView } = req.body || {}
    const name = (folderName || '').trim()
    if (!name || !roleId) {
      return res
        .status(400)
        .json({ error: 'Nom de dossier et identifiant de rôle sont requis.' })
    }

    // Ensure role exists
    const roleRes = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId])
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }

    // Ensure folder exists in folders table
    const folderId = uuidv4()
    await pool.query(
      `
        INSERT INTO folders (id, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `,
      [folderId, name]
    )

    const result = await pool.query(
      `
        INSERT INTO folder_role_visibility (folder_name, role_id, can_view)
        VALUES ($1, $2, COALESCE($3, true))
        ON CONFLICT (folder_name, role_id)
        DO UPDATE SET can_view = COALESCE($3, folder_role_visibility.can_view)
        RETURNING folder_name, role_id, can_view
      `,
      [name, roleId, canView]
    )

    return res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('set folder permissions error', err)
    return res
      .status(500)
      .json({ error: 'Erreur lors de la mise à jour des permissions de dossier.' })
  }
})

// ---------- Files ----------

// Accepts any file type: APK, images, video, MP3, Excel, documents, etc. (no fileFilter)
app.post('/api/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const fileBuffer = req.file.buffer
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      return res.status(400).json({ error: 'Fichier invalide ou trop volumineux.' })
    }

    const folder = (req.body && req.body.folder) || 'default'
    const directionId = (req.body && req.body.direction_id) || null
    const identifiant = (req.body && req.body.identifiant) || null

    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise pour l’upload.' })
    }

    let uploadedBy = null
    if (identifiant) {
      const userRes = await pool.query(
        'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        uploadedBy = u.id
        if (u.role !== 'admin' && u.direction_id !== directionId) {
          return res.status(403).json({
            error: 'Vous ne pouvez déposer des fichiers que dans votre direction.',
          })
        }
      }
    }

    const dirRes = await pool.query(
      'SELECT id, code FROM directions WHERE id = $1',
      [directionId]
    )
    if (dirRes.rows.length === 0) {
      return res.status(400).json({ error: 'Direction invalide.' })
    }
    const directionCode = (dirRes.rows[0].code || 'DEF').toString().toUpperCase()

    const mimeType = (req.file.mimetype && String(req.file.mimetype).trim()) || 'application/octet-stream'

    // File name: always CODE_baseName (e.g. SUM_rapport.pdf)
    let baseName = (req.body && req.body.name) || req.file.originalname || 'document'
    baseName = baseName.replace(/^.*[/\\]/, '').trim() || 'document'
    if (baseName.toUpperCase().startsWith(directionCode + '_')) {
      baseName = baseName.slice(directionCode.length + 1)
    }
    const storedFileName = directionCode + '_' + baseName

    const id = uuidv4()
    const folderId = uuidv4()

    await pool.query(
      `
        INSERT INTO folders (id, name, direction_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (direction_id, name) DO NOTHING
      `,
      [folderId, folder, directionId]
    )

    await pool.query(
      `
        INSERT INTO files (id, name, mime_type, size, folder, direction_id, uploaded_by, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        id,
        storedFileName,
        mimeType,
        Number(req.file.size) || 0,
        folder,
        directionId,
        uploadedBy,
        fileBuffer,
      ]
    )

    const publicUrl = `${BASE_URL}/files/${encodeURIComponent(id)}`

    await insertActivityLog(pool, {
      action: 'upload_file',
      actorIdentifiant: identifiant || null,
      actorId: uploadedBy,
      directionId,
      entityType: 'file',
      entityId: id,
      details: { name: storedFileName, folder, size: Number(req.file.size) || 0 },
    })

    return res.json({
      id,
      name: storedFileName,
      size: req.file.size,
      url: publicUrl,
      direction_id: directionId,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('file upload error', err?.message || err, err?.code)
    return res.status(500).json({ error: 'Erreur lors de l’upload du fichier.' })
  }
})

// Explicit folders / groups (each folder belongs to a direction)
app.get('/api/folders', async (_req, res) => {
  try {
    const { role } = _req.query

    let sql = `
      SELECT f.id, f.name, f.direction_id, f.created_at, d.name AS direction_name
      FROM folders f
      JOIN directions d ON d.id = f.direction_id
    `
    const params = []

    if (role && role !== 'admin') {
      sql += `
        WHERE (
          NOT EXISTS (
            SELECT 1 FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = f.name
          )
          OR EXISTS (
            SELECT 1 FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = f.name AND r.name = $1 AND v.can_view = true
          )
        )
      `
      params.push(role)
    }

    sql += ' ORDER BY d.name, f.created_at DESC'

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        direction_id: row.direction_id,
        direction_name: row.direction_name,
        createdAt: row.created_at,
      }))
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('folders list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des dossiers.' })
  }
})

app.post('/api/folders', async (req, res) => {
  try {
    const { folder, direction_id: directionId, identifiant } = req.body || {}
    const name = (folder || '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Nom de dossier requis.' })
    }
    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise pour créer un dossier.' })
    }

    // Permission: admin can create in any direction; others only in their own direction
    if (identifiant) {
      const userRes = await pool.query(
        'SELECT role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        if (u.role !== 'admin' && u.direction_id !== directionId) {
          return res.status(403).json({
            error: 'Vous ne pouvez créer des dossiers que dans votre direction.',
          })
        }
      }
    }

    const dirRes = await pool.query('SELECT id FROM directions WHERE id = $1', [directionId])
    if (dirRes.rows.length === 0) {
      return res.status(400).json({ error: 'Direction invalide.' })
    }

    const id = uuidv4()
    await pool.query(
      `
        INSERT INTO folders (id, name, direction_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (direction_id, name) DO NOTHING
      `,
      [id, name, directionId]
    )

    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'create_folder',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId,
      entityType: 'folder',
      entityId: id,
      details: { name },
    })

    return res.status(201).json({ id, name, direction_id: directionId })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà dans cette direction.' })
    }
    // eslint-disable-next-line no-console
    console.error('folder create error', err)
    return res.status(500).json({ error: 'Erreur lors de la création du dossier.' })
  }
})

app.get('/api/files', async (req, res) => {
  try {
    const { folder, role } = req.query

    const params = []
    let sql = 'SELECT id, name, mime_type, size, folder, direction_id, created_at FROM files'

    const conditions = []

    if (folder) {
      params.push(folder)
      conditions.push(`files.folder = $${params.length}`)
    }

    if (role && role !== 'admin') {
      params.push(role)
      conditions.push(`
        (
          NOT EXISTS (
            SELECT 1
            FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = files.folder
          )
          OR EXISTS (
            SELECT 1
            FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = files.folder
              AND r.name = $${params.length}
              AND v.can_view = true
          )
        )
      `)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY files.created_at DESC'

    const result = await pool.query(sql, params)

    const rows = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      size: Number(row.size) || 0,
      folder: row.folder,
      direction_id: row.direction_id,
      url: `${BASE_URL}/files/${encodeURIComponent(row.id)}`,
    }))

    return res.json(rows)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('files list error', err?.message || err, err?.code)
    return res.status(500).json({ error: 'Erreur lors de la récupération des fichiers.' })
  }
})

app.get('/files/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      'SELECT name, mime_type, data FROM files WHERE id = $1',
      [id]
    )
    if (result.rows.length === 0) {
      return res.status(404).send('File not found')
    }

    const file = result.rows[0]
    res.setHeader('Content-Type', file.mime_type)
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.name)}"`
    )
    return res.send(file.data)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('file fetch error', err)
    return res.status(500).send('Error fetching file')
  }
})

app.patch('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name: rawName } = req.body || {}
    const identifiant = req.query.identifiant || req.body?.identifiant

    const name = (rawName || '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Nom du fichier requis pour renommer.' })
    }

    const fileRes = await pool.query(
      'SELECT direction_id FROM files WHERE id = $1',
      [id]
    )
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'Fichier introuvable.' })
    }

    if (identifiant) {
      const userRes = await pool.query(
        'SELECT role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        const fileDir = fileRes.rows[0].direction_id
        if (u.role !== 'admin' && u.direction_id !== fileDir) {
          return res.status(403).json({
            error: 'Vous ne pouvez renommer que les fichiers de votre direction.',
          })
        }
      }
    }

    const directionId = fileRes.rows[0].direction_id
    const dirRes = await pool.query(
      'SELECT code FROM directions WHERE id = $1',
      [directionId]
    )
    const directionCode = (dirRes.rows[0] && dirRes.rows[0].code) ? dirRes.rows[0].code.toString().toUpperCase() : 'DEF'
    let baseName = name.replace(/^.*[/\\]/, '').trim() || 'document'
    if (baseName.toUpperCase().startsWith(directionCode + '_')) {
      baseName = baseName.slice(directionCode.length + 1)
    }
    const storedFileName = directionCode + '_' + baseName

    await pool.query('UPDATE files SET name = $1 WHERE id = $2', [storedFileName, id])

    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'rename_file',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId,
      entityType: 'file',
      entityId: id,
      details: { name: storedFileName },
    })

    return res.json({ id, name: storedFileName })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('file rename error', err)
    return res.status(500).json({ error: 'Erreur lors du renommage du fichier.' })
  }
})

app.delete('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params
    const identifiant = req.query.identifiant || req.body?.identifiant

    const fileRes = await pool.query(
      'SELECT name, folder, direction_id FROM files WHERE id = $1',
      [id]
    )
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'Fichier introuvable.' })
    }
    const fileRow = fileRes.rows[0]
    const fileDir = fileRow.direction_id

    if (identifiant) {
      const userRes = await pool.query(
        'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        if (u.role !== 'admin' && u.direction_id !== fileDir) {
          return res.status(403).json({
            error: 'Vous ne pouvez supprimer que les fichiers de votre direction.',
          })
        }
      }
    }

    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'delete_file',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId: fileDir,
      entityType: 'file',
      entityId: id,
      details: { name: fileRow.name, folder: fileRow.folder },
    })

    await pool.query('DELETE FROM files WHERE id = $1', [id])
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('file delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du fichier.' })
  }
})

app.delete('/api/folders/:folder', async (req, res) => {
  try {
    const { folder } = req.params
    const directionId = req.query.direction_id || req.body?.direction_id
    const identifiant = req.query.identifiant || req.body?.identifiant

    if (identifiant && directionId) {
      const userRes = await pool.query(
        'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        if (u.role !== 'admin' && u.direction_id !== directionId) {
          return res.status(403).json({
            error: 'Vous ne pouvez supprimer que les dossiers de votre direction.',
          })
        }
      }
    }

    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'delete_folder',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId: directionId || null,
      entityType: 'folder',
      entityId: null,
      details: { folder, direction_id: directionId },
    })

    if (directionId) {
      await pool.query('DELETE FROM links WHERE folder = $1 AND direction_id = $2', [
        folder,
        directionId,
      ])
      await pool.query('DELETE FROM files WHERE folder = $1 AND direction_id = $2', [
        folder,
        directionId,
      ])
      await pool.query('DELETE FROM folders WHERE name = $1 AND direction_id = $2', [
        folder,
        directionId,
      ])
    } else {
      await pool.query('DELETE FROM links WHERE folder = $1', [folder])
      await pool.query('DELETE FROM files WHERE folder = $1', [folder])
      await pool.query('DELETE FROM folders WHERE name = $1', [folder])
    }
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('folder delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du dossier.' })
  }
})

// ---------- Links (URLs: websites, GitHub repos, etc.) ----------

function isValidUrl(str) {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch (_) {
    return false
  }
}

app.post('/api/links', async (req, res) => {
  try {
    const { folder, direction_id: directionId, url, label, identifiant } = req.body || {}
    const name = (folder || '').trim()
    const linkUrl = (url || '').trim()
    const linkLabel = (label || '').trim() || linkUrl

    if (!name) {
      return res.status(400).json({ error: 'Dossier requis pour ajouter un lien.' })
    }
    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise.' })
    }
    if (!linkUrl) {
      return res.status(400).json({ error: 'URL requise.' })
    }
    if (!isValidUrl(linkUrl)) {
      return res.status(400).json({ error: 'URL invalide. Utilisez http:// ou https://.' })
    }

    if (identifiant) {
      const userRes = await pool.query(
        'SELECT role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        if (u.role !== 'admin' && u.direction_id !== directionId) {
          return res.status(403).json({
            error: 'Vous ne pouvez ajouter des liens que dans votre direction.',
          })
        }
      }
    }

    const dirRes = await pool.query('SELECT id FROM directions WHERE id = $1', [directionId])
    if (dirRes.rows.length === 0) {
      return res.status(400).json({ error: 'Direction invalide.' })
    }

    const id = uuidv4()
    await pool.query(
      `INSERT INTO links (id, folder, direction_id, url, label) VALUES ($1, $2, $3, $4, $5)`,
      [id, name, directionId, linkUrl, linkLabel]
    )

    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'create_link',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId,
      entityType: 'link',
      entityId: id,
      details: { folder: name, url: linkUrl, label: linkLabel },
    })

    return res.status(201).json({
      id,
      folder: name,
      direction_id: directionId,
      url: linkUrl,
      label: linkLabel,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('link create error', err)
    return res.status(500).json({ error: 'Erreur lors de l’ajout du lien.' })
  }
})

app.get('/api/links', async (req, res) => {
  try {
    const { folder, role } = req.query
    const params = []
    let sql = `
      SELECT l.id, l.folder, l.direction_id, l.url, l.label, l.created_at
      FROM links l
    `
    const conditions = []

    if (folder) {
      params.push(folder)
      conditions.push(`l.folder = $${params.length}`)
    }

    if (role && role !== 'admin') {
      params.push(role)
      conditions.push(`
        (
          NOT EXISTS (
            SELECT 1 FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = l.folder
          )
          OR EXISTS (
            SELECT 1 FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = l.folder
              AND r.name = $${params.length}
              AND v.can_view = true
          )
        )
      `)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY l.created_at DESC'

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        folder: row.folder,
        direction_id: row.direction_id,
        url: row.url,
        label: row.label,
        created_at: row.created_at,
      }))
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('links list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des liens.' })
  }
})

app.patch('/api/links/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { url, label } = req.body || {}
    const identifiant = req.query.identifiant || req.body?.identifiant

    const linkRes = await pool.query(
      'SELECT direction_id, url, label FROM links WHERE id = $1',
      [id]
    )
    if (linkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Lien introuvable.' })
    }

    if (identifiant) {
      const userRes = await pool.query(
        'SELECT role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        if (u.role !== 'admin' && u.direction_id !== linkRes.rows[0].direction_id) {
          return res.status(403).json({
            error: 'Vous ne pouvez modifier que les liens de votre direction.',
          })
        }
      }
    }

    const newUrl = (url !== undefined && url !== null ? String(url).trim() : null) || linkRes.rows[0].url
    const newLabel = (label !== undefined && label !== null ? String(label).trim() : null) || linkRes.rows[0].label
    if (newUrl && !isValidUrl(newUrl)) {
      return res.status(400).json({ error: 'URL invalide. Utilisez http:// ou https://.' })
    }

    await pool.query(
      'UPDATE links SET url = $1, label = $2 WHERE id = $3',
      [newUrl, newLabel, id]
    )
    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'update_link',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId: linkRes.rows[0].direction_id,
      entityType: 'link',
      entityId: id,
      details: { url: newUrl, label: newLabel },
    })
    return res.json({ id, url: newUrl, label: newLabel })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('link update error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du lien.' })
  }
})

app.delete('/api/links/:id', async (req, res) => {
  try {
    const { id } = req.params
    const identifiant = req.query.identifiant || req.body?.identifiant

    const linkRes = await pool.query(
      'SELECT direction_id, url, label, folder FROM links WHERE id = $1',
      [id]
    )
    if (linkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Lien introuvable.' })
    }
    const linkRow = linkRes.rows[0]
    if (identifiant) {
      const userRes = await pool.query(
        'SELECT role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        if (u.role !== 'admin' && u.direction_id !== linkRow.direction_id) {
          return res.status(403).json({
            error: 'Vous ne pouvez supprimer que les liens de votre direction.',
          })
        }
      }
    }

    let actorId = null
    if (identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'delete_link',
      actorIdentifiant: identifiant || null,
      actorId,
      directionId: linkRow.direction_id,
      entityType: 'link',
      entityId: id,
      details: { folder: linkRow.folder, url: linkRow.url, label: linkRow.label },
    })

    await pool.query('DELETE FROM links WHERE id = $1', [id])
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('link delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du lien.' })
  }
})

const defaultPort = 3000
const port = parseInt(process.env.PORT, 10) || defaultPort

initDb()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.log(`Server running at ${BASE_URL.replace(/:(\d+)$/, ':' + port)} (port ${port}) — accessible on LAN`)
    })
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize database', err)
    process.exit(1)
  })

