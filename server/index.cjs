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
const cloudinary = require('cloudinary').v2
const { WebSocketServer } = require('ws')
const http = require('http')

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.warn('[cloudinary] WARNING: CLOUDINARY_CLOUD_NAME not set. File uploads will fail.')
}

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

/**
 * Background migration: uploads all files that still have bytea data
 * (no cloudinary_url) to Cloudinary, then NULLs out the bytea column.
 */
async function migrateLegacyFilesToCloudinary(pool) {
  const legacy = await pool.query(
    `SELECT f.id, f.name, f.mime_type, f.folder, f.data,
            COALESCE(d.code, 'DEF') AS direction_code
     FROM files f
     LEFT JOIN directions d ON d.id = f.direction_id
     WHERE f.data IS NOT NULL AND f.cloudinary_url IS NULL
     LIMIT 50`
  )
  if (legacy.rows.length === 0) {
    console.log('[cloudinary-migration] No legacy bytea files to migrate.')
    return
  }
  console.log(`[cloudinary-migration] Migrating ${legacy.rows.length} legacy files…`)

  for (const row of legacy.rows) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `intranet/${row.direction_code}/${row.folder}`,
            public_id: row.id,
            resource_type: 'auto',
          },
          (err, res) => (err ? reject(err) : resolve(res))
        )
        stream.end(row.data)
      })
      await pool.query(
        `UPDATE files SET cloudinary_url = $1, cloudinary_public_id = $2, data = NULL WHERE id = $3`,
        [result.secure_url, result.public_id, row.id]
      )
      console.log(`[cloudinary-migration] ✓ ${row.name}`)
    } catch (err) {
      console.error(`[cloudinary-migration] ✗ ${row.name}:`, err?.message || err)
    }
  }
  console.log('[cloudinary-migration] Batch complete.')
}

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

  // Add must_change_password flag (new users must change password on first login)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;
    `)
  } catch (_) { /* column may already exist */ }

  // Add is_direction_chief flag (chef de direction can manage their direction)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_direction_chief boolean NOT NULL DEFAULT false;
    `)
  } catch (_) { /* column may already exist */ }

  // Device login requests (GitHub-style: request access → approve on mobile → grant session)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_requests (
      id uuid PRIMARY KEY,
      user_identifiant text NOT NULL,
      code text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'detruite')),
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

  // Migration: add 'detruite' to the status CHECK constraint (for existing databases)
  try {
    await pool.query(`ALTER TABLE login_requests DROP CONSTRAINT IF EXISTS login_requests_status_check`)
    await pool.query(`ALTER TABLE login_requests ADD CONSTRAINT login_requests_status_check CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'detruite'))`)
  } catch (_) { /* constraint may already be correct */ }

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
  // Folder visibility: 'public' (everyone) or 'direction_only' (only members of the folder's direction)
  try {
    await pool.query(`ALTER TABLE folders ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'`)
  } catch (_) { /* ignore */ }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      mime_type text NOT NULL,
      size bigint NOT NULL,
      folder text NOT NULL,
      direction_id uuid REFERENCES directions(id) ON DELETE CASCADE,
      uploaded_by uuid,
      data bytea,
      cloudinary_url text,
      cloudinary_public_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_uploaded_by
        FOREIGN KEY (uploaded_by)
        REFERENCES users(id)
        ON DELETE SET NULL
    );
  `)
  // Migration: add Cloudinary columns to existing tables
  try { await pool.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS cloudinary_url text') } catch (_) { /* ignore */ }
  try { await pool.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS cloudinary_public_id text') } catch (_) { /* ignore */ }
  // Make data column nullable for Cloudinary-stored files
  try { await pool.query('ALTER TABLE files ALTER COLUMN data DROP NOT NULL') } catch (_) { /* ignore */ }

  // Background migration: move existing bytea files to Cloudinary
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    migrateLegacyFilesToCloudinary(pool).catch(err =>
      console.error('[cloudinary-migration] error:', err?.message || err)
    )
  }

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
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_set_folder_visibility boolean NOT NULL DEFAULT false')
    await pool.query('ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_view_stats boolean NOT NULL DEFAULT false')
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

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB max upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
})

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

// ---------- WebSocket: real-time permission updates ----------
// Each connected client is tracked with its identifiant and role.
// When an admin changes permissions for a role, all clients with that role get notified.
const wsClients = new Set()

function authenticateWsClient(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    return decoded && decoded.identifiant ? decoded.identifiant : null
  } catch (_) {
    return null
  }
}

/**
 * Broadcast a "refresh permissions" event to all connected clients
 * whose role matches `roleName`. If roleName is null, broadcast to everyone.
 */
async function broadcastPermissionsChange(roleName) {
  const message = JSON.stringify({ type: 'permissions_changed', role: roleName || null })
  for (const client of wsClients) {
    try {
      // If roleName is specified, only notify clients with that role
      if (roleName && client._userRole && client._userRole !== roleName) continue
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(message)
      }
    } catch (_) { /* ignore send errors */ }
  }
}

/**
 * Broadcast a "user_deleted" event to a specific identifiant (force logout)
 */
function broadcastUserDeleted(identifiant) {
  const message = JSON.stringify({ type: 'user_deleted' })
  for (const client of wsClients) {
    try {
      if (client._userIdentifiant === identifiant && client.readyState === 1) {
        client.send(message)
      }
    } catch (_) { /* ignore */ }
  }
}

/**
 * Broadcast a "new_device_request" event to a specific identifiant
 * so their mobile app can display the request without manual refresh.
 */
function broadcastNewDeviceRequest(identifiant, request) {
  const message = JSON.stringify({
    type: 'new_device_request',
    request: {
      id: request.id,
      code: request.code,
      status: 'pending',
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    },
  })
  for (const client of wsClients) {
    try {
      if (client._userIdentifiant === identifiant && client.readyState === 1) {
        client.send(message)
      }
    } catch (_) { /* ignore */ }
  }
}

/**
 * Unauthenticated WebSocket clients that "watch" a specific request ID.
 * Used by the web login page to get instant status updates without polling.
 */
const requestWatchers = new Set()

/**
 * Broadcast a "device_request_status" event to a specific identifiant.
 * Sent when a request is approved, denied, destroyed, or expired.
 * Both the mobile app and web client listen for this to update in real-time.
 * Also notifies any unauthenticated request watchers.
 * @param {string} identifiant
 * @param {string[]} requestIds – IDs of requests whose status changed
 * @param {string} newStatus – 'approved' | 'denied' | 'detruite' | 'expired'
 * @param {object} [sessionPayload] – for 'approved' status, the user session data
 */
function broadcastRequestStatusChange(identifiant, requestIds, newStatus, sessionPayload) {
  if (!requestIds || requestIds.length === 0) return
  const message = JSON.stringify({
    type: 'device_request_status',
    requestIds,
    status: newStatus,
  })
  // Notify authenticated mobile clients
  for (const client of wsClients) {
    try {
      if (client._userIdentifiant === identifiant && client.readyState === 1) {
        client.send(message)
      }
    } catch (_) { /* ignore */ }
  }
  // Notify unauthenticated web login page watchers
  for (const watcher of requestWatchers) {
    try {
      if (!requestIds.includes(watcher._watchRequestId)) continue
      if (watcher.readyState !== 1) continue
      // For approved status, include session payload + JWT so the web can log in instantly
      if (newStatus === 'approved' && sessionPayload) {
        const token = signToken(sessionPayload.identifiant)
        // Mark the request as consumed (same as the poll endpoint does)
        pool.query(`UPDATE login_requests SET status = 'consumed' WHERE id = $1`, [watcher._watchRequestId]).catch(() => {})
        watcher.send(JSON.stringify({
          type: 'device_request_status',
          requestIds,
          status: newStatus,
          user: sessionPayload,
          token,
        }))
      } else {
        watcher.send(message)
      }
    } catch (_) { /* ignore */ }
  }
}

/**
 * Broadcast a generic "data_changed" event to all authenticated WebSocket clients.
 * The web frontend listens for these and refreshes the relevant data automatically.
 *
 * @param {string} resource – e.g. 'files', 'folders', 'links', 'users', 'directions', 'roles', 'activity'
 * @param {string} action  – e.g. 'created', 'updated', 'deleted'
 * @param {object} [details] – optional extra info (e.g. { directionId, id })
 */
function broadcastDataChange(resource, action, details) {
  const message = JSON.stringify({
    type: 'data_changed',
    resource,
    action,
    ...(details || {}),
  })
  for (const client of wsClients) {
    try {
      if (client.readyState === 1) {
        client.send(message)
      }
    } catch (_) { /* ignore */ }
  }
}

/**
 * Get the list of currently online (connected via WebSocket) non-admin users.
 * Returns an array of { identifiant, role, connectedAt }.
 */
function getOnlineUsers() {
  const seen = new Map()
  for (const client of wsClients) {
    if (client.readyState === 1 && client._userIdentifiant && client._userRole !== 'admin') {
      // Deduplicate by identifiant (user may have multiple tabs)
      if (!seen.has(client._userIdentifiant)) {
        seen.set(client._userIdentifiant, {
          identifiant: client._userIdentifiant,
          role: client._userRole || 'user',
          connectedAt: client._connectedAt || null,
        })
      }
    }
  }
  return Array.from(seen.values())
}

/**
 * Notify all connected admin clients about the current online users list.
 * Only admin clients receive this — regular users never know.
 */
function broadcastOnlineUsersToAdmins() {
  const onlineUsers = getOnlineUsers()
  const message = JSON.stringify({ type: 'online_users', users: onlineUsers })
  for (const client of wsClients) {
    try {
      if (client.readyState === 1 && client._userRole === 'admin') {
        client.send(message)
      }
    } catch (_) { /* ignore */ }
  }
}

// ---------- Live surveillance: presence tracking + activity ring buffer (admin only) ----------
// Map<identifiant, { page, section, lastSeen, connectedAt, role, direction_id, direction_name }>
const userPresence = new Map()

// Capped ring buffer for recent live actions (last 200 events)
const MAX_LIVE_ACTIONS = 200
const liveActions = []

function pushLiveAction(entry) {
  liveActions.push(entry)
  if (liveActions.length > MAX_LIVE_ACTIONS) liveActions.shift()
}

/** Send a message to all admin WS clients. */
function sendToAdmins(message) {
  const msg = typeof message === 'string' ? message : JSON.stringify(message)
  for (const client of wsClients) {
    try {
      if (client.readyState === 1 && client._userRole === 'admin') {
        client.send(msg)
      }
    } catch (_) { /* ignore */ }
  }
}

/** Broadcast the full live presence map to admins. */
function broadcastLivePresence() {
  sendToAdmins({ type: 'live_presence', users: Object.fromEntries(userPresence) })
}

/** Broadcast a single live action event to admins. */
function broadcastLiveAction(action) {
  sendToAdmins({ type: 'live_action', ...action })
}

/** Record a login/logout/connect/disconnect event in the live feed. */
function recordLiveEvent(identifiant, action, detail) {
  const entry = {
    ts: new Date().toISOString(),
    identifiant,
    action,
    detail: detail || null,
  }
  pushLiveAction(entry)
  broadcastLiveAction(entry)
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

// Helper: convert a postgres-style interval string to milliseconds
function parsePgInterval(interval) {
  const match = interval.match(/^(\d+)\s+(days?|months?|years?)$/)
  if (!match) return 0
  const n = parseInt(match[1], 10)
  const unit = match[2]
  if (unit.startsWith('day')) return n * 86400000
  if (unit.startsWith('month')) return n * 30 * 86400000
  if (unit.startsWith('year')) return n * 365 * 86400000
  return 0
}

// ──────────── Admin analytics / stats ────────────
// Admin sees everything; users with can_view_stats see only their direction.
// Get currently online users (admin only — users are not notified)
app.get('/api/admin/online-users', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [req.authIdentifiant])
    if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
    }
    return res.json(getOnlineUsers())
  } catch (err) {
    console.error('online-users error', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
})

// Live surveillance: initial state for the admin live page
app.get('/api/admin/live', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [req.authIdentifiant])
    if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
    }
    return res.json({
      presence: Object.fromEntries(userPresence),
      actions: liveActions.slice(-50),
    })
  } catch (err) {
    console.error('admin-live error', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
})

app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    // Check access
    const userRow = await pool.query(
      'SELECT role, direction_id FROM users WHERE identifiant = $1',
      [req.authIdentifiant]
    )
    if (userRow.rows.length === 0) {
      return res.status(403).json({ error: 'Accès refusé.' })
    }
    const caller = userRow.rows[0]
    const isAdmin = caller.role === 'admin'

    if (!isAdmin) {
      const perms = await getPermissionsForIdentifiant(req.authIdentifiant)
      if (!perms || !perms.can_view_stats) {
        return res.status(403).json({ error: 'Accès refusé.' })
      }
    }

    // For non-admin users: scope everything to their direction
    const dirId = isAdmin ? null : caller.direction_id

    // ── Period filter ──
    // Accepted: 7d, 30d, 3m, 6m, 1y, all (default: all)
    // Also supports custom range: ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const periodIntervals = { '7d': '7 days', '30d': '30 days', '3m': '3 months', '6m': '6 months', '1y': '1 year' }
    const periodParam = (req.query.period || 'all').toString()

    const customFrom = req.query.from ? new Date(req.query.from.toString()) : null
    const customTo   = req.query.to   ? new Date(req.query.to.toString())   : null
    const hasCustomRange = customFrom && customTo && !isNaN(customFrom.getTime()) && !isNaN(customTo.getTime())

    let fromDate = null
    let toDate = null
    if (hasCustomRange) {
      fromDate = customFrom.toISOString()
      const end = new Date(customTo)
      end.setHours(23, 59, 59, 999)
      toDate = end.toISOString()
    } else {
      const pgInterval = periodIntervals[periodParam] || null
      if (pgInterval) {
        fromDate = new Date(Date.now() - parsePgInterval(pgInterval)).toISOString()
      }
    }

    // Helper: build { sql, params } with optional direction + date filters
    // Each query builds its own param array so indices are always correct.
    function q(baseSql, { joinAlias = '', dateCol = 'created_at', extraWhere = [] } = {}) {
      const clauses = [...extraWhere]
      const params = []
      if (dirId) {
        params.push(dirId)
        const col = joinAlias ? `${joinAlias}.direction_id` : 'direction_id'
        clauses.push(`${col} = $${params.length}`)
      }
      if (fromDate && dateCol) {
        params.push(fromDate)
        const col = joinAlias ? `${joinAlias}.${dateCol}` : dateCol
        clauses.push(`${col} >= $${params.length}`)
      }
      if (toDate && dateCol) {
        params.push(toDate)
        const col = joinAlias ? `${joinAlias}.${dateCol}` : dateCol
        clauses.push(`${col} <= $${params.length}`)
      }
      const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
      return pool.query(baseSql.replace('__WHERE__', where), params)
    }

    // Files MIME-type CASE expression (reused)
    const mimeCase = `
      CASE
        WHEN mime_type LIKE 'image/%' THEN 'Images'
        WHEN mime_type LIKE 'video/%' THEN 'Vidéos'
        WHEN mime_type LIKE 'audio/%' THEN 'Audio'
        WHEN mime_type IN ('application/pdf') THEN 'PDF'
        WHEN mime_type IN ('application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document') THEN 'Word'
        WHEN mime_type IN ('application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv') THEN 'Excel/CSV'
        WHEN mime_type IN ('application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation') THEN 'PowerPoint'
        WHEN mime_type LIKE 'text/%' THEN 'Texte'
        ELSE 'Autre'
      END`

    // Run all queries in parallel
    const [
      usersCount, usersByRole, usersByDirection,
      directionsCount, foldersCount, foldersByDirection,
      filesCount, filesByType, filesByDirection, filesByDirectionAndType,
      storageTotal, linksCount,
      recentActivity, topUploaders, filesOverTime, filesOverTimeByType,
    ] = await Promise.all([
      // ── Users (structural — not date-filtered, admin users hidden) ──
      q('SELECT COUNT(*)::int AS count FROM users __WHERE__', { dateCol: null, extraWhere: ["role <> 'admin'"] }),
      q('SELECT role, COUNT(*)::int AS count FROM users __WHERE__ GROUP BY role ORDER BY count DESC', { dateCol: null, extraWhere: ["role <> 'admin'"] }),
      q(`SELECT COALESCE(d.name, 'Sans direction') AS direction, COUNT(u.id)::int AS count
         FROM users u LEFT JOIN directions d ON u.direction_id = d.id __WHERE__ GROUP BY d.name ORDER BY count DESC`,
        { joinAlias: 'u', dateCol: null, extraWhere: ["u.role <> 'admin'"] }),
      // ── Directions (structural) ──
      dirId
        ? pool.query('SELECT 1::int AS count')
        : pool.query('SELECT COUNT(*)::int AS count FROM directions'),
      // ── Folders (structural — not date-filtered, but direction-scoped) ──
      q('SELECT COUNT(*)::int AS count FROM folders __WHERE__', { dateCol: null }),
      q(`SELECT d.name AS direction, COUNT(fo.id)::int AS count
         FROM folders fo JOIN directions d ON fo.direction_id = d.id __WHERE__ GROUP BY d.name ORDER BY count DESC`,
        { joinAlias: 'fo', dateCol: null }),
      // ── Files (date + direction filtered) ──
      q('SELECT COUNT(*)::int AS count FROM files __WHERE__'),
      q(`SELECT ${mimeCase} AS category, COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
         FROM files __WHERE__ GROUP BY category ORDER BY count DESC`),
      q(`SELECT COALESCE(d.name, 'Sans direction') AS direction, COUNT(f.id)::int AS count,
                COALESCE(SUM(f.size),0)::bigint AS total_size
         FROM files f LEFT JOIN directions d ON f.direction_id = d.id __WHERE__ GROUP BY d.name ORDER BY count DESC`,
        { joinAlias: 'f' }),
      // ── Files by direction AND type (cross-tabulation for filtering) ──
      q(`SELECT COALESCE(d.name, 'Sans direction') AS direction,
                ${mimeCase} AS category,
                COUNT(f.id)::int AS count,
                COALESCE(SUM(f.size),0)::bigint AS total_size
         FROM files f LEFT JOIN directions d ON f.direction_id = d.id __WHERE__
         GROUP BY d.name, category ORDER BY d.name, count DESC`,
        { joinAlias: 'f' }),
      // ── Storage (date + direction filtered) ──
      q('SELECT COALESCE(SUM(size),0)::bigint AS total FROM files __WHERE__'),
      // ── Links (date + direction filtered) ──
      q('SELECT COUNT(*)::int AS count FROM links __WHERE__'),
      // ── Activity (date + direction filtered) ──
      // Admin viewers see all activity; non-admin viewers don't see admin actions
      q(`SELECT action, actor_identifiant, entity_type, details, created_at
         FROM activity_log __WHERE__ ORDER BY created_at DESC LIMIT 20`,
        isAdmin ? {} : { extraWhere: ["(actor_identifiant IS NULL OR actor_identifiant NOT IN (SELECT identifiant FROM users WHERE role = 'admin'))"] }),
      // ── Top uploaders (date + direction filtered, admin hidden) ──
      q(`SELECT u.identifiant, COUNT(f.id)::int AS uploads
         FROM files f JOIN users u ON f.uploaded_by = u.id __WHERE__
         GROUP BY u.identifiant ORDER BY uploads DESC LIMIT 5`,
        { joinAlias: 'f', extraWhere: ["u.role <> 'admin'"] }),
      // ── Files over time (always use period or custom range, default to 12 months) ──
      (() => {
        const clauses = []
        const params = []
        if (dirId) { params.push(dirId); clauses.push(`direction_id = $${params.length}`) }
        if (fromDate) {
          params.push(fromDate)
          clauses.push(`created_at >= $${params.length}`)
        } else {
          // Default: show last 12 months for the timeline even when period is "all"
          params.push(new Date(Date.now() - 365 * 86400000).toISOString())
          clauses.push(`created_at >= $${params.length}`)
        }
        if (toDate) {
          params.push(toDate)
          clauses.push(`created_at <= $${params.length}`)
        }
        const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
        return pool.query(`
          SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                 COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
          FROM files ${where}
          GROUP BY month ORDER BY month ASC
        `, params)
      })(),
      // ── Files over time by type (for timeline type filtering) ──
      (() => {
        const clauses = []
        const params = []
        if (dirId) { params.push(dirId); clauses.push(`direction_id = $${params.length}`) }
        if (fromDate) {
          params.push(fromDate)
          clauses.push(`created_at >= $${params.length}`)
        } else {
          params.push(new Date(Date.now() - 365 * 86400000).toISOString())
          clauses.push(`created_at >= $${params.length}`)
        }
        if (toDate) {
          params.push(toDate)
          clauses.push(`created_at <= $${params.length}`)
        }
        const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
        return pool.query(`
          SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                 ${mimeCase} AS category,
                 COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
          FROM files ${where}
          GROUP BY month, category ORDER BY month ASC, count DESC
        `, params)
      })(),
    ])

    // For direction-scoped users, include the direction name
    let scopedDirectionName = null
    if (dirId) {
      const d = await pool.query('SELECT name FROM directions WHERE id = $1', [dirId])
      scopedDirectionName = d.rows[0]?.name || null
    }

    res.json({
      scopedDirection: scopedDirectionName,
      period: periodParam,
      users: {
        total: usersCount.rows[0].count,
        byRole: usersByRole.rows,
        byDirection: usersByDirection.rows,
      },
      directions: {
        total: directionsCount.rows[0].count,
      },
      folders: {
        total: foldersCount.rows[0].count,
        byDirection: foldersByDirection.rows,
      },
      files: {
        total: filesCount.rows[0].count,
        byType: filesByType.rows,
        byDirection: filesByDirection.rows,
        byDirectionAndType: filesByDirectionAndType.rows,
        overTime: filesOverTime.rows,
        overTimeByType: filesOverTimeByType.rows,
      },
      storage: {
        totalBytes: Number(storageTotal.rows[0].total),
      },
      links: {
        total: linksCount.rows[0].count,
      },
      recentActivity: recentActivity.rows,
      topUploaders: topUploaders.rows,
    })
  } catch (err) {
    console.error('admin stats error', err)
    res.status(500).json({ error: 'Failed to load stats' })
  }
})

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
    broadcastDataChange('directions', 'created', { id })
    return res.status(201).json({ id, name: trimmed, code })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Une direction avec ce nom ou ce code existe déjà.' })
    }
    console.error('create direction error', err)
    return res.status(500).json({ error: 'Erreur lors de la création de la direction.' })
  }
})

// Update direction name and/or code
app.patch('/api/directions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, code, identifiant } = req.body || {}
    const callerIdentifiant = identifiant || req.query.identifiant

    // Permission check
    if (callerIdentifiant) {
      const perms = await getPermissionsForIdentifiant(callerIdentifiant)
      if (perms && !perms.can_create_direction) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de modifier des directions.' })
      }
    }

    // Ensure the direction exists
    const dirRow = await pool.query('SELECT id, name, code FROM directions WHERE id = $1', [id])
    if (dirRow.rows.length === 0) {
      return res.status(404).json({ error: 'Direction introuvable.' })
    }

    const trimmedName = name ? name.trim() : null
    const trimmedCode = code ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null

    if (!trimmedName && !trimmedCode) {
      return res.status(400).json({ error: 'Veuillez fournir un nom ou un code à modifier.' })
    }

    if (trimmedCode && (trimmedCode.length < 2 || trimmedCode.length > 4)) {
      return res.status(400).json({ error: 'Le code doit faire 2 à 4 caractères (lettres ou chiffres).' })
    }

    // Build dynamic update
    const sets = []
    const vals = []
    let idx = 1
    if (trimmedName) {
      sets.push(`name = $${idx}`)
      vals.push(trimmedName)
      idx++
    }
    if (trimmedCode) {
      sets.push(`code = $${idx}`)
      vals.push(trimmedCode)
      idx++
    }
    vals.push(id)

    const result = await pool.query(
      `UPDATE directions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, code`,
      vals
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Direction introuvable.' })
    }

    // Activity log
    let actorId = null
    if (callerIdentifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'update_direction',
      actorIdentifiant: callerIdentifiant || null,
      actorId,
      directionId: id,
      entityType: 'direction',
      entityId: id,
      details: {
        oldName: dirRow.rows[0].name,
        oldCode: dirRow.rows[0].code,
        newName: result.rows[0].name,
        newCode: result.rows[0].code,
      },
    })

    broadcastDataChange('directions', 'updated', { id })
    return res.json(result.rows[0])
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Une direction avec ce nom ou ce code existe déjà.' })
    }
    console.error('update direction error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la direction.' })
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
    broadcastDataChange('directions', 'deleted', { id })
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
      SELECT u.id, u.identifiant, u.role, u.direction_id, u.created_at, u.is_direction_chief,
             d.name AS direction_name
      FROM users u
      LEFT JOIN directions d ON d.id = u.direction_id
      WHERE u.role <> 'admin'
      ORDER BY u.created_at DESC
    `)
    return res.json(
      result.rows.map((r) => ({
        id: r.id,
        identifiant: r.identifiant,
        role: r.role,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        is_direction_chief: Boolean(r.is_direction_chief),
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

    // Block deletion of admin users
    if (deletedUser.role === 'admin') {
      return res.status(403).json({ error: 'Impossible de supprimer un compte administrateur.' })
    }

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

    // Notify the deleted user via WebSocket (force logout)
    broadcastUserDeleted(deletedUser.identifiant)

    await pool.query('DELETE FROM users WHERE id = $1', [id])
    broadcastDataChange('users', 'deleted', { id })
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('delete user error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression de l’utilisateur.' })
  }
})


// Update user role and/or direction
app.patch('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { role, direction_id, caller_identifiant } = req.body || {}

    // Permission check
    if (caller_identifiant) {
      const perms = await getPermissionsForIdentifiant(caller_identifiant)
      const callerRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [caller_identifiant])
      const isCallerAdmin = callerRes.rows.length > 0 && callerRes.rows[0].role === 'admin'
      if (!isCallerAdmin && perms && !perms.can_create_user) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de modifier des utilisateurs.' })
      }
    }

    // Ensure the target user exists
    const userRow = await pool.query(
      'SELECT id, identifiant, role, direction_id FROM users WHERE id = $1',
      [id]
    )
    if (userRow.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const targetUser = userRow.rows[0]

    // Block editing admin users (except by admin)
    if (targetUser.role === 'admin') {
      return res.status(403).json({ error: 'Impossible de modifier un compte administrateur.' })
    }

    // Build dynamic update
    const sets = []
    const vals = []
    let idx = 1

    if (role !== undefined && role !== null) {
      const trimmedRole = role.trim()
      if (!trimmedRole) {
        return res.status(400).json({ error: 'Rôle requis.' })
      }
      // Verify the role exists
      const roleCheck = await pool.query('SELECT id FROM roles WHERE name = $1', [trimmedRole])
      if (roleCheck.rows.length === 0 && trimmedRole !== 'admin') {
        return res.status(400).json({ error: 'Ce rôle n\'existe pas.' })
      }
      sets.push(`role = $${idx}`)
      vals.push(trimmedRole)
      idx++
    }

    if (direction_id !== undefined) {
      // direction_id can be null (to remove direction) or a valid uuid
      if (direction_id) {
        const dirCheck = await pool.query('SELECT id FROM directions WHERE id = $1', [direction_id])
        if (dirCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Cette direction n\'existe pas.' })
        }
      }
      sets.push(`direction_id = $${idx}`)
      vals.push(direction_id || null)
      idx++
      // If direction is removed, also remove chief status
      if (!direction_id) {
        sets.push(`is_direction_chief = false`)
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucune modification fournie.' })
    }

    vals.push(id)
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, identifiant, role, direction_id, is_direction_chief`,
      vals
    )

    // Get direction name for the response
    let direction_name = null
    if (result.rows[0].direction_id) {
      const dirRes = await pool.query('SELECT name FROM directions WHERE id = $1', [result.rows[0].direction_id])
      if (dirRes.rows.length > 0) direction_name = dirRes.rows[0].name
    }

    // Activity log
    let actorId = null
    if (caller_identifiant) {
      const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [caller_identifiant])
      if (u.rows.length > 0) actorId = u.rows[0].id
    }
    await insertActivityLog(pool, {
      action: 'update_user',
      actorIdentifiant: caller_identifiant || null,
      actorId,
      directionId: result.rows[0].direction_id,
      entityType: 'user',
      entityId: id,
      details: {
        identifiant: targetUser.identifiant,
        oldRole: targetUser.role,
        newRole: result.rows[0].role,
        oldDirectionId: targetUser.direction_id,
        newDirectionId: result.rows[0].direction_id,
      },
    })

    broadcastDataChange('users', 'updated', { id })
    // Notify the user so their permissions refresh
    broadcastPermissionsChange(result.rows[0].role)

    return res.json({
      ...result.rows[0],
      is_direction_chief: Boolean(result.rows[0].is_direction_chief),
      direction_name,
    })
  } catch (err) {
    console.error('update user error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur.' })
  }
})

// Toggle "Chef de Direction" status (admin only)
app.patch('/api/users/:id/chief', async (req, res) => {
  try {
    const { id } = req.params
    const { is_direction_chief, caller_identifiant } = req.body || {}

    if (!caller_identifiant) {
      return res.status(403).json({ error: 'Identifiant requis.' })
    }
    const callerRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [caller_identifiant])
    if (callerRes.rows.length === 0 || callerRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Seul un administrateur peut modifier ce statut.' })
    }

    const userRes = await pool.query(
      'SELECT id, identifiant, role, direction_id FROM users WHERE id = $1',
      [id]
    )
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const targetUser = userRes.rows[0]

    if (targetUser.role === 'admin') {
      return res.status(400).json({ error: 'Un administrateur a deja tous les droits.' })
    }
    if (!targetUser.direction_id && is_direction_chief) {
      return res.status(400).json({ error: 'Utilisateur sans direction.' })
    }

    await pool.query(
      'UPDATE users SET is_direction_chief = $1 WHERE id = $2',
      [Boolean(is_direction_chief), id]
    )

    broadcastDataChange('users', 'updated', { id })
    // Notify the affected user's role so their permissions refresh
    await broadcastPermissionsChange(targetUser.role)

    return res.json({
      id: targetUser.id,
      identifiant: targetUser.identifiant,
      is_direction_chief: Boolean(is_direction_chief),
    })
  } catch (err) {
    console.error('toggle chief error', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
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
      // Block assigning admin role — only an existing admin can do this
      if (trimmed.toLowerCase() === 'admin') {
        if (!callerIdentifiant) {
          return res.status(403).json({ error: 'Impossible de créer un compte administrateur.' })
        }
        const callerRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [callerIdentifiant])
        if (callerRes.rows.length === 0 || callerRes.rows[0].role !== 'admin') {
          return res.status(403).json({ error: 'Seul un administrateur peut créer un compte administrateur.' })
        }
      }
      const roleRes = await pool.query('SELECT name FROM roles WHERE name = $1', [trimmed])
      if (roleRes.rows.length === 0) {
        return res.status(400).json({ error: 'Rôle invalide.' })
      }
      finalRole = trimmed
    } else {
      finalRole = 'user'
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

    broadcastDataChange('users', 'created', { id })
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
      `SELECT u.id, u.identifiant, u.password_hash, u.role, u.direction_id, u.must_change_password, u.is_direction_chief, d.name AS direction_name
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
      is_direction_chief: Boolean(user.is_direction_chief),
      permissions: permissions || undefined,
      must_change_password: Boolean(user.must_change_password),
      token,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('login error', err)
    return res.status(500).json({ error: 'Erreur lors de la connexion.' })
  }
})

// Refresh current user data (permissions, direction, role) without re-login
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ error: 'Token requis.' })
    }
    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    } catch (_) {
      return res.status(401).json({ error: 'Token invalide ou expiré.' })
    }
    const identifiant = decoded && decoded.identifiant ? decoded.identifiant : null
    if (!identifiant) {
      return res.status(401).json({ error: 'Token invalide.' })
    }
    const result = await pool.query(
      `SELECT u.id, u.identifiant, u.role, u.direction_id, u.must_change_password, u.is_direction_chief, d.name AS direction_name
       FROM users u
       LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const user = result.rows[0]
    const permissions = await getPermissionsForIdentifiant(user.identifiant)
    return res.json({
      id: user.id,
      identifiant: user.identifiant,
      role: user.role,
      direction_id: user.direction_id,
      direction_name: user.direction_name || null,
      is_direction_chief: Boolean(user.is_direction_chief),
      permissions: permissions || undefined,
      must_change_password: Boolean(user.must_change_password),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('auth/me error', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
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
    await pool.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [hashed, user.id])

    return res.json({ success: true, must_change_password: false })
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
      `SELECT u.id, u.identifiant, u.password_hash, u.role, u.direction_id, u.must_change_password, d.name AS direction_name
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
    // Mark them as 'detruite' (destroyed/superseded) – visible in history
    const destroyedRows = await pool.query(
      `UPDATE login_requests SET status = 'detruite'
       WHERE user_identifiant = $1 AND status = 'pending'
       RETURNING id`,
      [ident]
    )
    const destroyedIds = destroyedRows.rows.map((r) => r.id)

    await pool.query(
      `INSERT INTO login_requests (id, user_identifiant, code, status, expires_at)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [requestId, ident, code, expiresAt]
    )

    // Notify connected WebSocket clients that old requests are destroyed
    if (destroyedIds.length > 0) {
      broadcastRequestStatusChange(ident, destroyedIds, 'detruite')
    }

    // Notify connected WebSocket clients (mobile app) about the new request
    broadcastNewDeviceRequest(ident, {
      id: requestId,
      code,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    })

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
              // ── Data-only message ──
              // We intentionally omit the top-level `notification` field so that
              // expo-notifications processes the message on Android (even in the
              // background) and can attach the notification category with
              // interactive Approve / Deny action buttons.
              const result = await messaging.send({
                token: deviceToken,
                // Data-only → expo-notifications reads title, body, categoryId, channelId
                data: {
                  title: 'Nouvelle demande de connexion',
                  body: `Code: ${code} — Approuver ou refuser`,
                  requestId: String(requestId),
                  code: String(code),
                  categoryId: 'approval_request',   // matches setNotificationCategoryAsync
                  channelId: 'approval',             // high-priority Android channel
                },
                android: {
                  priority: 'high',
                },
                apns: {
                  payload: {
                    aps: {
                      category: 'approval_request',  // iOS notification category
                      sound: 'default',
                      'content-available': 1,
                      alert: {
                        title: 'Nouvelle demande de connexion',
                        body: `Code: ${code} — Approuver ou refuser`,
                      },
                    },
                  },
                  headers: {
                    'apns-priority': '10',
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

// List history of past login requests (approved, denied, expired) for the mobile app
app.get('/api/auth/device/requests/history', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const result = await pool.query(
      `SELECT id, code, status, created_at, expires_at
       FROM login_requests
       WHERE user_identifiant = $1
         AND (status IN ('approved', 'denied', 'detruite', 'consumed') OR (status = 'pending' AND expires_at <= now()))
       ORDER BY created_at DESC
       LIMIT 50`,
      [identifiant]
    )
    return res.json(
      result.rows.map((r) => ({
        id: r.id,
        code: r.code,
        // 'consumed' means it was approved and used — show as 'approved' in history
        // 'pending' past expiry means it expired
        status: r.status === 'pending' ? 'expired' : r.status === 'consumed' ? 'approved' : r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }))
    )
  } catch (err) {
    console.error('device requests history error', err)
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique." })
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
      `SELECT u.id, u.identifiant, u.role, u.direction_id, u.must_change_password, d.name AS direction_name
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
      must_change_password: Boolean(user.must_change_password),
    }

    await pool.query(
      `UPDATE login_requests SET status = 'approved', session_payload = $1, approved_at = now() WHERE id = $2`,
      [JSON.stringify(sessionPayload), requestId]
    )

    // Broadcast approval to all connected clients for this user (web picks it up instantly)
    broadcastRequestStatusChange(identifiant, [requestId], 'approved', sessionPayload)

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

    // Broadcast denial to all connected clients for this user
    broadcastRequestStatusChange(identifiant, [requestId], 'denied')

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

    if (row.status === 'detruite') {
      return res.json({ status: 'detruite', message: 'Cette demande a été remplacée par une nouvelle.' })
    }

    if (row.status === 'denied') {
      return res.json({ status: 'denied', message: 'Connexion refusée.' })
    }

    if (row.status === 'approved' && row.session_payload) {
      await pool.query(`UPDATE login_requests SET status = 'consumed' WHERE id = $1`, [requestId])
      const approvedUser = row.session_payload
      const token = signToken(approvedUser.identifiant)
      return res.json({ status: 'approved', user: approvedUser, token })
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
      // Hide admin actions from non-admin users
      sql += ` AND (a.actor_identifiant IS NULL OR a.actor_identifiant NOT IN (SELECT identifiant FROM users WHERE role = 'admin'))`
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
    'SELECT role, is_direction_chief FROM users WHERE identifiant = $1',
    [identifiant]
  )
  if (userRes.rows.length === 0) return null
  const roleName = userRes.rows[0].role
  const isChief = Boolean(userRes.rows[0].is_direction_chief)
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
      can_set_folder_visibility: true,
      can_view_stats: true,
    }
  }
  const permRes = await pool.query(
    `
      SELECT p.can_create_folder, p.can_upload_file, p.can_delete_file, p.can_delete_folder,
             p.can_create_user, p.can_delete_user, p.can_create_direction, p.can_delete_direction,
             p.can_view_activity_log, p.can_set_folder_visibility, p.can_view_stats
      FROM roles r
      JOIN role_permissions p ON p.role_id = r.id
      WHERE r.name = $1
    `,
    [roleName]
  )
  let base = {
    can_create_folder: false,
    can_upload_file: false,
    can_delete_file: false,
    can_delete_folder: false,
    can_create_user: false,
    can_delete_user: false,
    can_create_direction: false,
    can_delete_direction: false,
    can_view_activity_log: false,
    can_set_folder_visibility: false,
    can_view_stats: false,
  }
  if (permRes.rows.length > 0) {
    const row = permRes.rows[0]
    base = {
      can_create_folder: !!row.can_create_folder,
      can_upload_file: !!row.can_upload_file,
      can_delete_file: !!row.can_delete_file,
      can_delete_folder: !!row.can_delete_folder,
      can_create_user: !!row.can_create_user,
      can_delete_user: !!row.can_delete_user,
      can_create_direction: !!row.can_create_direction,
      can_delete_direction: !!row.can_delete_direction,
      can_view_activity_log: !!row.can_view_activity_log,
      can_set_folder_visibility: !!row.can_set_folder_visibility,
      can_view_stats: !!row.can_view_stats,
    }
  }

  // Chef de Direction: grant management permissions within their direction
  if (isChief) {
    base.can_create_folder = true
    base.can_upload_file = true
    base.can_delete_file = true
    base.can_delete_folder = true
    base.can_view_activity_log = true
    base.can_set_folder_visibility = true
    base.can_view_stats = true
  }

  return base
}

// List roles with their global permissions (admin role is hidden from the list)
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
        COALESCE(p.can_view_activity_log, false) AS can_view_activity_log,
        COALESCE(p.can_set_folder_visibility, false) AS can_set_folder_visibility,
        COALESCE(p.can_view_stats, false) AS can_view_stats
      FROM roles r
      LEFT JOIN role_permissions p ON p.role_id = r.id
      WHERE r.name <> 'admin'
      ORDER BY r.created_at DESC
    `)
    return res.json(result.rows)
  } catch (err) {
    console.error('list roles error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des rôles.' })
  }
})

// Create a new role (name must be unique; "admin" is reserved)
app.post('/api/roles', async (req, res) => {
  try {
    const { name } = req.body || {}
    const trimmed = (name || '').trim()
    if (!trimmed) {
      return res.status(400).json({ error: 'Nom de rôle requis.' })
    }
    if (trimmed.toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Le nom "admin" est réservé.' })
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

    broadcastDataChange('roles', 'created', { id: row.id })
    return res.status(201).json(row)
  } catch (err) {
    console.error('create role error', err)
    return res.status(500).json({ error: 'Erreur lors de la création du rôle.' })
  }
})

// Update role name
app.patch('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name } = req.body || {}
    const trimmed = (name || '').trim()
    if (!trimmed) {
      return res.status(400).json({ error: 'Nom de rôle requis.' })
    }
    if (trimmed.toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Le nom "admin" est réservé.' })
    }

    // Ensure the role exists and is not the admin role
    const roleRes = await pool.query('SELECT id, name FROM roles WHERE id = $1', [id])
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }
    if (roleRes.rows[0].name === 'admin') {
      return res.status(403).json({ error: 'Le rôle admin ne peut pas être renommé.' })
    }

    // Update the role name
    const result = await pool.query(
      'UPDATE roles SET name = $1 WHERE id = $2 RETURNING id, name',
      [trimmed, id]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }

    // Also update the role column in users table for all users with the old role name
    const oldName = roleRes.rows[0].name
    await pool.query('UPDATE users SET role = $1 WHERE role = $2', [trimmed, oldName])

    broadcastDataChange('roles', 'updated', { id })
    return res.json(result.rows[0])
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Un rôle avec ce nom existe déjà.' })
    }
    console.error('update role name error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du rôle.' })
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
      canSetFolderVisibility,
      canViewStats,
    } = req.body || {}

    // Ensure the role exists and is not the admin role
    const roleRes = await pool.query('SELECT id, name FROM roles WHERE id = $1', [id])
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }
    if (roleRes.rows[0].name === 'admin') {
      return res.status(403).json({ error: 'Les permissions du rôle admin ne peuvent pas être modifiées.' })
    }

    // Upsert permissions row
    await pool.query(
      `
        INSERT INTO role_permissions (role_id, can_create_folder, can_upload_file, can_delete_file, can_delete_folder, can_create_user, can_delete_user, can_create_direction, can_delete_direction, can_view_activity_log, can_set_folder_visibility, can_view_stats)
        VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, false), COALESCE($5, false), COALESCE($6, false), COALESCE($7, false), COALESCE($8, false), COALESCE($9, false), COALESCE($10, false), COALESCE($11, false), COALESCE($12, false))
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
          can_view_activity_log = COALESCE($10, role_permissions.can_view_activity_log),
          can_set_folder_visibility = COALESCE($11, role_permissions.can_set_folder_visibility),
          can_view_stats = COALESCE($12, role_permissions.can_view_stats)
      `,
      [id, canCreateFolder, canUploadFile, canDeleteFile, canDeleteFolder, canCreateUser, canDeleteUser, canCreateDirection, canDeleteDirection, canViewActivityLog, canSetFolderVisibility, canViewStats]
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
          p.can_view_activity_log,
          p.can_set_folder_visibility,
          p.can_view_stats
        FROM roles r
        JOIN role_permissions p ON p.role_id = r.id
        WHERE r.id = $1
      `,
      [id]
    )

    // Broadcast to all clients with this role so they refresh permissions instantly
    if (updated.rows[0]) {
      broadcastPermissionsChange(updated.rows[0].name)
    }

    broadcastDataChange('roles', 'updated', { id })
    return res.json(updated.rows[0])
  } catch (err) {
    console.error('update role permissions error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour des permissions.' })
  }
})

// Delete a role (cannot delete 'admin' or roles still assigned to users)
app.delete('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params

    // Look up the role
    const roleRes = await pool.query('SELECT id, name FROM roles WHERE id = $1', [id])
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }
    const roleName = roleRes.rows[0].name

    // Prevent deleting the built-in 'admin' role
    if (roleName === 'admin') {
      return res.status(400).json({ error: 'Impossible de supprimer le rôle admin.' })
    }

    // Check if any users still have this role
    const usersWithRole = await pool.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE role = $1',
      [roleName]
    )
    if (usersWithRole.rows[0].count > 0) {
      return res.status(400).json({
        error: `Impossible de supprimer ce rôle : ${usersWithRole.rows[0].count} utilisateur(s) l'utilisent encore. Réassignez-les d'abord.`,
      })
    }

    // Delete (cascades to role_permissions and folder_role_visibility)
    await pool.query('DELETE FROM roles WHERE id = $1', [id])

    broadcastDataChange('roles', 'deleted', { id })
    return res.json({ ok: true })
  } catch (err) {
    console.error('delete role error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du rôle.' })
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

    // Broadcast so affected clients refresh their view
    broadcastPermissionsChange(null)
    broadcastDataChange('folders', 'updated')

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
app.post('/api/files', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMB = Math.round(MAX_FILE_SIZE / 1024 / 1024)
        return res.status(413).json({ error: `Le fichier est trop volumineux. Taille maximum : ${maxMB} Mo.` })
      }
      return res.status(400).json({ error: err.message || 'Erreur lors du traitement du fichier.' })
    }
    next()
  })
}, async (req, res) => {
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

    // Determine Cloudinary resource_type from mime
    let resourceType = 'raw'
    if (mimeType.startsWith('image/')) resourceType = 'image'
    else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) resourceType = 'video'

    // Cloudinary plan limits: image/raw = 20 MB, video = 2 GB
    const cloudinaryLimit = resourceType === 'video' ? 2000 * 1024 * 1024 : 20 * 1024 * 1024
    const useCloudinary = fileBuffer.length <= cloudinaryLimit

    let cloudinaryUrl = null
    let cloudinaryPublicId = null

    if (useCloudinary) {
      // Upload to Cloudinary
      const cloudinaryOpts = {
        folder: `intranet/${directionCode}/${folder}`,
        public_id: id,
        resource_type: resourceType,
      }
      const cloudinaryResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          cloudinaryOpts,
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          }
        ).end(fileBuffer)
      })
      cloudinaryUrl = cloudinaryResult.secure_url
      cloudinaryPublicId = cloudinaryResult.public_id
    }

    // Store in DB — large files go in the `data` bytea column, small files use Cloudinary URL
    await pool.query(
      `INSERT INTO files (id, name, mime_type, size, folder, direction_id, uploaded_by, cloudinary_url, cloudinary_public_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        storedFileName,
        mimeType,
        Number(req.file.size) || 0,
        folder,
        directionId,
        uploadedBy,
        cloudinaryUrl,
        cloudinaryPublicId,
        useCloudinary ? null : fileBuffer, // store bytea only for large files
      ]
    )

    // The view_url always works because /files/:id serves from Cloudinary OR bytea
    const publicUrl = cloudinaryUrl || `${BASE_URL}/files/${encodeURIComponent(id)}`

    await insertActivityLog(pool, {
      action: 'upload_file',
      actorIdentifiant: identifiant || null,
      actorId: uploadedBy,
      directionId,
      entityType: 'file',
      entityId: id,
      details: { name: storedFileName, folder, size: Number(req.file.size) || 0 },
    })

    broadcastDataChange('files', 'created', { id, directionId, folder })
    return res.json({
      id,
      name: storedFileName,
      size: req.file.size,
      url: publicUrl,
      view_url: `${BASE_URL}/files/${encodeURIComponent(id)}`,
      direction_id: directionId,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("file upload error", err?.message || err, err?.code, err?.stack)
    const detail = err?.message || "Unknown error"
    return res.status(500).json({ error: "Erreur lors de l'upload: " + detail })
  }
})

// Explicit folders / groups (each folder belongs to a direction)
// Query params: role, direction_id (user's direction — used to filter direction_only folders)
app.get('/api/folders', async (_req, res) => {
  try {
    const { role, direction_id: userDirectionId } = _req.query

    let sql = `
      SELECT f.id, f.name, f.direction_id, f.created_at, f.visibility, d.name AS direction_name
      FROM folders f
      JOIN directions d ON d.id = f.direction_id
    `
    const params = []
    const conditions = []

    if (role && role !== 'admin') {
      // Role-based folder visibility (existing feature)
      params.push(role)
      conditions.push(`
        (
          NOT EXISTS (
            SELECT 1 FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = f.name
          )
          OR EXISTS (
            SELECT 1 FROM folder_role_visibility v
            JOIN roles r ON r.id = v.role_id
            WHERE v.folder_name = f.name AND r.name = $${params.length} AND v.can_view = true
          )
        )
      `)

      // Direction-only visibility: hide folders marked 'direction_only' unless the user belongs to that direction
      if (userDirectionId) {
        params.push(userDirectionId)
        conditions.push(`(f.visibility = 'public' OR f.direction_id = $${params.length})`)
      } else {
        conditions.push(`f.visibility = 'public'`)
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY d.name, f.created_at DESC'

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        direction_id: row.direction_id,
        direction_name: row.direction_name,
        visibility: row.visibility || 'public',
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
    const { folder, direction_id: directionId, identifiant, visibility: rawVisibility } = req.body || {}
    const name = (folder || '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Nom de dossier requis.' })
    }
    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise pour créer un dossier.' })
    }
    const visibility = rawVisibility === 'direction_only' ? 'direction_only' : 'public'

    // Permission: admin can create in any direction; others only in their own direction
    let callerRole = null
    if (identifiant) {
      const userRes = await pool.query(
        'SELECT role, direction_id FROM users WHERE identifiant = $1',
        [identifiant]
      )
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]
        callerRole = u.role
        if (u.role !== 'admin' && u.direction_id !== directionId) {
          return res.status(403).json({
            error: 'Vous ne pouvez créer des dossiers que dans votre direction.',
          })
        }
      }
    }

    // Only admin or users with can_set_folder_visibility can set visibility to 'direction_only'
    if (visibility === 'direction_only' && callerRole !== 'admin' && identifiant) {
      const perms = await getPermissionsForIdentifiant(identifiant)
      if (!perms || !perms.can_set_folder_visibility) {
        return res.status(403).json({
          error: "Vous n'avez pas la permission de restreindre la visibilité du dossier.",
        })
      }
    }

    const dirRes = await pool.query('SELECT id FROM directions WHERE id = $1', [directionId])
    if (dirRes.rows.length === 0) {
      return res.status(400).json({ error: 'Direction invalide.' })
    }

    const id = uuidv4()
    await pool.query(
      `
        INSERT INTO folders (id, name, direction_id, visibility)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (direction_id, name) DO NOTHING
      `,
      [id, name, directionId, visibility]
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
      details: { name, visibility },
    })

    broadcastDataChange('folders', 'created', { id, directionId })
    return res.status(201).json({ id, name, direction_id: directionId, visibility })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà dans cette direction.' })
    }
    // eslint-disable-next-line no-console
    console.error('folder create error', err)
    return res.status(500).json({ error: 'Erreur lors de la création du dossier.' })
  }
})

// Toggle folder visibility (public <-> direction_only)
app.patch('/api/folders/:id/visibility', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { visibility: rawVisibility } = req.body || {}
    const visibility = rawVisibility === 'direction_only' ? 'direction_only' : 'public'
    const identifiant = req.authIdentifiant

    const userRes = await pool.query(
      'SELECT role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur introuvable.' })
    }
    const user = userRes.rows[0]

    // Only admin or users with can_set_folder_visibility permission
    if (user.role !== 'admin') {
      const perms = await getPermissionsForIdentifiant(identifiant)
      if (!perms || !perms.can_set_folder_visibility) {
        return res.status(403).json({
          error: "Vous n'avez pas la permission de modifier la visibilité du dossier.",
        })
      }
    }

    // Verify folder exists and user belongs to the same direction (non-admin)
    const folderRes = await pool.query('SELECT id, name, direction_id FROM folders WHERE id = $1', [id])
    if (folderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dossier introuvable.' })
    }
    const folder = folderRes.rows[0]
    if (user.role !== 'admin' && user.direction_id !== folder.direction_id) {
      return res.status(403).json({
        error: 'Vous ne pouvez modifier que les dossiers de votre direction.',
      })
    }

    await pool.query('UPDATE folders SET visibility = $1 WHERE id = $2', [visibility, id])

    await insertActivityLog(pool, {
      action: 'update_folder_visibility',
      actorIdentifiant: identifiant,
      actorId: null,
      directionId: folder.direction_id,
      entityType: 'folder',
      entityId: id,
      details: { name: folder.name, visibility },
    })

    // Broadcast to all non-admin clients so they refresh visibility
    broadcastPermissionsChange(null)
    broadcastDataChange('folders', 'updated', { id })

    return res.json({ id, name: folder.name, direction_id: folder.direction_id, visibility })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('folder visibility update error', err)
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la visibilité.' })
  }
})

app.get('/api/files', async (req, res) => {
  try {
    const { folder, role, direction_id: userDirectionId } = req.query

    const params = []
    let sql = 'SELECT id, name, mime_type, size, folder, direction_id, cloudinary_url, created_at FROM files'

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

      // Direction-only visibility: hide files in folders marked 'direction_only' unless user belongs to that direction
      if (userDirectionId) {
        params.push(userDirectionId)
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM folders ff
            WHERE ff.name = files.folder AND ff.direction_id = files.direction_id
              AND ff.visibility = 'direction_only'
              AND ff.direction_id != $${params.length}
          )
        `)
      } else {
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM folders ff
            WHERE ff.name = files.folder AND ff.direction_id = files.direction_id
              AND ff.visibility = 'direction_only'
          )
        `)
      }
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
      url: row.cloudinary_url || `${BASE_URL}/files/${encodeURIComponent(row.id)}`,
      view_url: `${BASE_URL}/files/${encodeURIComponent(row.id)}`,
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
      'SELECT name, mime_type, data, cloudinary_url FROM files WHERE id = $1',
      [id]
    )
    if (result.rows.length === 0) {
      return res.status(404).send('File not found')
    }

    const file = result.rows[0]

    // If stored on Cloudinary, proxy the content with correct headers.
    // A redirect breaks MS Office Viewer because the Cloudinary URL has no
    // file extension (public_id is a UUID), so the viewer cannot identify
    // the document type.  By proxying we set the proper Content-Type.
    if (file.cloudinary_url) {
      try {
        const upstream = await fetch(file.cloudinary_url)
        if (!upstream.ok) {
          return res.status(502).send('Failed to fetch file from storage')
        }
        const buf = Buffer.from(await upstream.arrayBuffer())
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream')
        res.setHeader('Content-Length', buf.length)
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(file.name)}"`
        )
        return res.send(buf)
      } catch (fetchErr) {
        console.error('cloudinary proxy error', fetchErr)
        // Fallback: redirect as before
        return res.redirect(file.cloudinary_url)
      }
    }

    // Legacy: serve from bytea column
    if (file.data) {
      res.setHeader('Content-Type', file.mime_type)
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(file.name)}"`
      )
      return res.send(file.data)
    }

    return res.status(404).send('File data not found')
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

    broadcastDataChange('files', 'updated', { id })
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
      'SELECT name, folder, direction_id, cloudinary_public_id FROM files WHERE id = $1',
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

    // Delete from Cloudinary if stored there
    if (fileRow.cloudinary_public_id) {
      try {
        await cloudinary.uploader.destroy(fileRow.cloudinary_public_id, { resource_type: 'raw' })
      } catch (cloudErr) {
        console.warn('[cloudinary] failed to delete', fileRow.cloudinary_public_id, cloudErr?.message)
        // Also try as image/video in case resource_type differs
        try { await cloudinary.uploader.destroy(fileRow.cloudinary_public_id) } catch (_) { /* ignore */ }
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
    broadcastDataChange('files', 'deleted', { id, directionId: fileDir })
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

    // Delete Cloudinary resources for all files in the folder
    {
      const filesToDelete = directionId
        ? await pool.query('SELECT cloudinary_public_id FROM files WHERE folder = $1 AND direction_id = $2 AND cloudinary_public_id IS NOT NULL', [folder, directionId])
        : await pool.query('SELECT cloudinary_public_id FROM files WHERE folder = $1 AND cloudinary_public_id IS NOT NULL', [folder])
      for (const f of filesToDelete.rows) {
        try { await cloudinary.uploader.destroy(f.cloudinary_public_id, { resource_type: 'raw' }) } catch (_) { /* ignore */ }
        try { await cloudinary.uploader.destroy(f.cloudinary_public_id) } catch (_) { /* ignore */ }
      }
    }

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
    broadcastDataChange('folders', 'deleted', { directionId })
    broadcastDataChange('files', 'deleted', { directionId })
    broadcastDataChange('links', 'deleted', { directionId })
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

    broadcastDataChange('links', 'created', { id, directionId })
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
    const { folder, role, direction_id: userDirectionId } = req.query
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

      // Direction-only visibility: hide links in folders marked 'direction_only' unless user belongs to that direction
      if (userDirectionId) {
        params.push(userDirectionId)
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM folders ff
            WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
              AND ff.visibility = 'direction_only'
              AND ff.direction_id != $${params.length}
          )
        `)
      } else {
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM folders ff
            WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
              AND ff.visibility = 'direction_only'
          )
        `)
      }
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
    broadcastDataChange('links', 'updated', { id })
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
    broadcastDataChange('links', 'deleted', { id })
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('link delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du lien.' })
  }
})

const defaultPort = 3000
const port = parseInt(process.env.PORT, 10) || defaultPort

// Create HTTP server from the Express app so we can attach WebSocket
const server = http.createServer(app)

// WebSocket server mounted on the same HTTP server (path: /ws)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const token = url.searchParams.get('token')
  const watchRequestId = url.searchParams.get('watchRequest')

  // ─── Mode 1: Unauthenticated request watcher (web login page) ───
  if (watchRequestId && !token) {
    ws._watchRequestId = watchRequestId
    requestWatchers.add(ws)
    console.log(`[ws] request watcher connected for ${watchRequestId} — ${requestWatchers.size} watchers`)

    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.ping()
    }, 30000)

    ws.on('close', () => {
      requestWatchers.delete(ws)
      clearInterval(pingInterval)
      console.log(`[ws] request watcher disconnected for ${watchRequestId} — ${requestWatchers.size} watchers`)
    })

    ws.on('error', () => {
      requestWatchers.delete(ws)
      clearInterval(pingInterval)
    })

    ws.send(JSON.stringify({ type: 'watching', requestId: watchRequestId }))
    return
  }

  // ─── Mode 2: Authenticated client (mobile / web dashboard) ───
  const identifiant = token ? authenticateWsClient(token) : null

  if (!identifiant) {
    ws.close(4001, 'Authentification requise.')
    return
  }

  // Look up the user's role and direction so we can target broadcasts + track presence
  let userRole = null
  let userDirectionName = null
  try {
    const userRes = await pool.query(
      `SELECT u.role, d.name AS direction_name
       FROM users u LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (userRes.rows.length > 0) {
      userRole = userRes.rows[0].role
      userDirectionName = userRes.rows[0].direction_name || null
    }
  } catch (_) { /* ignore */ }

  ws._userIdentifiant = identifiant
  ws._userRole = userRole
  ws._connectedAt = new Date().toISOString()
  wsClients.add(ws)

  // eslint-disable-next-line no-console
  console.log(`[ws] client connected: ${identifiant} (role: ${userRole}) — ${wsClients.size} total`)

  // Notify admins about updated online users (silently — user doesn't know)
  broadcastOnlineUsersToAdmins()

  // Track presence for non-admin users
  if (userRole !== 'admin') {
    userPresence.set(identifiant, {
      page: '/dashboard',
      section: null,
      lastSeen: new Date().toISOString(),
      connectedAt: ws._connectedAt,
      role: userRole || 'user',
      direction_name: userDirectionName,
    })
    recordLiveEvent(identifiant, 'connected', null)
    broadcastLivePresence()
  }

  // Handle incoming messages from clients (presence + action tracking)
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString())

      // Presence update: user navigated to a new page
      if (data.type === 'presence' && userRole !== 'admin') {
        const existing = userPresence.get(identifiant) || {}
        userPresence.set(identifiant, {
          ...existing,
          page: String(data.page || '/dashboard').slice(0, 200),
          section: data.section ? String(data.section).slice(0, 200) : null,
          lastSeen: new Date().toISOString(),
        })
        broadcastLivePresence()
      }

      // Action event: user performed a meaningful action
      if (data.type === 'action' && userRole !== 'admin') {
        const action = String(data.action || 'unknown').slice(0, 50)
        const detail = data.detail ? String(data.detail).slice(0, 300) : null
        recordLiveEvent(identifiant, action, detail)
      }
    } catch (_) { /* ignore malformed messages */ }
  })

  // Keep-alive ping every 30s
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) ws.ping()
  }, 30000)

  ws.on('close', () => {
    wsClients.delete(ws)
    clearInterval(pingInterval)
    // eslint-disable-next-line no-console
    console.log(`[ws] client disconnected: ${identifiant} — ${wsClients.size} total`)

    // Clean up presence and notify admins
    if (userRole !== 'admin') {
      userPresence.delete(identifiant)
      recordLiveEvent(identifiant, 'disconnected', null)
      broadcastLivePresence()
    }
    broadcastOnlineUsersToAdmins()
  })

  ws.on('error', () => {
    wsClients.delete(ws)
    clearInterval(pingInterval)
    if (userRole !== 'admin') {
      userPresence.delete(identifiant)
    }
  })

  // Send a welcome message
  ws.send(JSON.stringify({ type: 'connected', identifiant }))
})

initDb()
  .then(() => {
    server.listen(port, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.log(`Server running at ${BASE_URL.replace(/:(\d+)$/, ':' + port)} (port ${port}) — accessible on LAN`)
      console.log(`[ws] WebSocket server ready at ws://0.0.0.0:${port}/ws`)
    })
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize database', err)
    process.exit(1)
  })

