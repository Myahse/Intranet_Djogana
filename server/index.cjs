const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const multer = require('multer')
const cors = require('cors')
const { Pool } = require('pg')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const cloudinary = require('cloudinary').v2
const { WebSocketServer } = require('ws')
const http = require('http')
const AdmZip = require('adm-zip')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')

function isUuidLike(value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function normalizeFolderPath(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  // Accept "A / B" style coming from UI and normalize to internal "::" separator.
  const asColons = s.replace(/\s*\/\s*/g, '::')
  // Collapse repeated separators and remove leading/trailing separators.
  return asColons
    .replace(/:{4,}/g, '::')
    .replace(/^::+/, '')
    .replace(/::+$/, '')
    .trim()
}

function escapeLikePattern(value) {
  // Escape for SQL LIKE ... ESCAPE '\'
  return String(value).replace(/([\\%_])/g, '\\$1')
}

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.warn('[cloudinary] WARNING: CLOUDINARY_CLOUD_NAME not set. File uploads will fail.')
}

// ---------- APK Icon Extraction ----------
/**
 * Extract the launcher icon from an APK buffer.
 * APK files are ZIP archives; the icon is typically in res/mipmap-* or res/drawable-* dirs.
 * Returns a Buffer of the PNG icon, or null if not found.
 */
function extractApkIcon(fileBuffer) {
  try {
    const zip = new AdmZip(fileBuffer)
    const entries = zip.getEntries()

    // Common icon paths ordered by resolution (highest first)
    const iconPatterns = [
      /^res\/mipmap-xxxhdpi[^/]*\/ic_launcher(?:_foreground)?\.png$/i,
      /^res\/mipmap-xxhdpi[^/]*\/ic_launcher(?:_foreground)?\.png$/i,
      /^res\/mipmap-xhdpi[^/]*\/ic_launcher(?:_foreground)?\.png$/i,
      /^res\/mipmap-hdpi[^/]*\/ic_launcher(?:_foreground)?\.png$/i,
      /^res\/mipmap-mdpi[^/]*\/ic_launcher(?:_foreground)?\.png$/i,
      /^res\/drawable-xxxhdpi[^/]*\/ic_launcher\.png$/i,
      /^res\/drawable-xxhdpi[^/]*\/ic_launcher\.png$/i,
      /^res\/drawable-xhdpi[^/]*\/ic_launcher\.png$/i,
      /^res\/drawable-hdpi[^/]*\/ic_launcher\.png$/i,
      /^res\/drawable[^/]*\/ic_launcher\.png$/i,
    ]

    // Try the standard patterns first
    for (const pattern of iconPatterns) {
      for (const entry of entries) {
        if (pattern.test(entry.entryName)) {
          const data = entry.getData()
          if (data && data.length > 100) return data
        }
      }
    }

    // Fallback: find any PNG in mipmap dirs, pick the largest by file size (best quality)
    let bestEntry = null
    let bestSize = 0
    for (const entry of entries) {
      const name = entry.entryName
      if (/^res\/(mipmap|drawable)-[^/]+\/.*\.png$/i.test(name) && !entry.isDirectory) {
        if (/ic_launcher/i.test(name) || /icon/i.test(name) || /logo/i.test(name)) {
          const size = entry.header.size || 0
          if (size > bestSize) {
            bestSize = size
            bestEntry = entry
          }
        }
      }
    }

    if (bestEntry) {
      const data = bestEntry.getData()
      if (data && data.length > 100) return data
    }

    return null
  } catch (err) {
    console.error('[apk-icon] Error extracting APK icon:', err?.message || err)
    return null
  }
}

/**
 * Upload an extracted APK icon buffer to Cloudinary.
 * Returns the secure URL or null.
 */
async function uploadApkIconToCloudinary(iconBuffer, cloudinaryFolder, fileId) {
  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: cloudinaryFolder,
          public_id: fileId + '_icon',
          resource_type: 'image',
          format: 'png',
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        }
      ).end(iconBuffer)
    })
    return result.secure_url
  } catch (err) {
    console.error('[apk-icon] Error uploading APK icon to Cloudinary:', err?.message || err)
    return null
  }
}

/**
 * Download a file from a URL and return its Buffer.
 * Used to fetch APKs from Cloudinary for icon extraction.
 */
function downloadFileBuffer(url) {
  const mod = url.startsWith('https') ? require('https') : require('http')
  return new Promise((resolve, reject) => {
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFileBuffer(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ---------- Firebase Admin SDK (lazy-loaded) ----------
// Loading `firebase-admin` at startup uses a lot of RAM on small hosts (e.g. Render free tier).
// We require it only when sending a push notification.
let firebaseAdminSingleton = null
let firebaseAdminLoadFailed = false
function getFirebaseAdmin() {
  if (firebaseAdminLoadFailed) return null
  if (firebaseAdminSingleton) return firebaseAdminSingleton
  try {
    const admin = require('firebase-admin')
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (raw) {
      const serviceAccount = JSON.parse(raw)
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      })
      console.log('[firebase] initialized from FIREBASE_SERVICE_ACCOUNT_JSON (lazy)')
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      })
      console.log('[firebase] initialized from GOOGLE_APPLICATION_CREDENTIALS (lazy)')
    } else {
      console.warn(
        '[firebase] WARNING: No Firebase credentials found. Push notifications will NOT work.\n' +
        '  Set FIREBASE_SERVICE_ACCOUNT_JSON (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (file path).'
      )
      admin.initializeApp()
    }
    firebaseAdminSingleton = admin
    return admin
  } catch (err) {
    firebaseAdminLoadFailed = true
    console.error('[firebase] initialization error:', err.message)
    return null
  }
}

function getMessaging() {
  const admin = getFirebaseAdmin()
  if (!admin) return null
  try {
    return admin.messaging()
  } catch (err) {
    console.error('[firebase] messaging() error:', err?.message || err)
    return null
  }
}

function isExpoPushToken(token) {
  // Expo can return `ExponentPushToken[…]` (legacy) or `ExpoPushToken[…]` (newer SDKs).
  return typeof token === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/i.test(token.trim())
}

function isLikelyFcmToken(token) {
  if (typeof token !== 'string') return false
  const t = token.trim()
  if (!t) return false
  if (isExpoPushToken(t)) return false
  // FCM tokens are long opaque strings; we just need to distinguish from Expo tokens.
  return t.length >= 50
}

async function sendExpoPushNotifications(tokens, message) {
  if (!Array.isArray(tokens) || tokens.length === 0) return
  const payloads = tokens.map((to) => ({
    to,
    title: message?.title,
    body: message?.body,
    data: message?.data || {},
    // Needed so iOS action buttons / categories work for Expo pushes.
    categoryId: message?.categoryId,
    sound: message?.sound || 'default',
    channelId: message?.channelId,
    priority: 'high',
  }))
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(payloads),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[push] Expo push error', res.status, data)
      return
    }
    // Best-effort logging; tickets are returned, receipts are async.
    console.log('[push] Expo push sent:', Array.isArray(data?.data) ? data.data.length : 'unknown')
  } catch (err) {
    console.error('[push] Expo push send failed', err?.message || err)
  }
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set')
}
const DEVICE_REQUEST_EXPIRY_MINUTES = 15
const DEVICE_CODE_LENGTH = 6

const app = express()

// Cache for expensive admin stats (longer TTL + parallel queries below keep this effective).
const ADMIN_STATS_CACHE_TTL_MS = 90_000
const ADMIN_STATS_CACHE_MAX_KEYS = 32
const adminStatsCache = new Map() // key -> { ts: number, data: any }

function adminStatsCacheSet(key, entry) {
  while (adminStatsCache.size >= ADMIN_STATS_CACHE_MAX_KEYS) {
    const first = adminStatsCache.keys().next().value
    if (first === undefined) break
    adminStatsCache.delete(first)
  }
  adminStatsCache.set(key, entry)
}

// ── CORS ──
// Build an allowed-origins list from CORS_ORIGINS env (comma-separated) plus common defaults.
const CORS_ORIGINS = (() => {
  const extra = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const defaults = [
    'https://www.intranet-djogana.ci',
    'https://intranet-djogana.ci',
    'https://intranet-djogana.onrender.com',
    'http://localhost:5173',
    'http://localhost:3000',
  ]
  return [...new Set([...defaults, ...extra])]
})()

app.use(
  cors({
    origin(origin, cb) {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return cb(null, true)
      if (CORS_ORIGINS.includes(origin)) return cb(null, origin)
      // Any subdomain of intranet-djogana.ci (www, app, etc.)
      if (/^https:\/\/([a-z0-9-]+\.)*intranet-djogana\.ci$/i.test(origin)) return cb(null, origin)
      // Render preview / API host (e.g. *.onrender.com)
      if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin)) return cb(null, origin)
      // In development, allow any localhost
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, origin)
      console.warn(`[cors] blocked origin: ${origin}`)
      cb(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Identifiant'],
  })
)
app.use(express.json())

// Render / load balancers: must respond before DB migrations finish (see server.listen below).
app.get('/health', (_req, res) => {
  res.status(200).type('text/plain').send('ok')
})

// Same as /health but under /api (Vercel rewrites /api/* → Render; use for probes & monitoring without DB).
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() })
})

const BASE_URL = process.env.PUBLIC_BASE_URL
if (!BASE_URL) {
  throw new Error('PUBLIC_BASE_URL is not set')
}
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

/** Neon + pg: strip channel_binding — it can break or slow pooled connections with some setups. */
function normalizeDatabaseUrl(raw) {
  try {
    const u = new URL(raw)
    u.searchParams.delete('channel_binding')
    return u.toString()
  } catch {
    return raw
  }
}

// Use verify-full to match current pg behavior and silence the sslmode deprecation warning
const connectionString =
  normalizeDatabaseUrl(DATABASE_URL).replace(/sslmode=require(?=&|$)/i, 'sslmode=verify-full') ||
  normalizeDatabaseUrl(DATABASE_URL)

// Neon compute cold start / TLS can exceed 15s; default 60s in production (override with PG_CONNECTION_TIMEOUT_MS).
const pgConnectionTimeoutMs = Math.max(
  5_000,
  Math.min(
    120_000,
    parseInt(
      process.env.PG_CONNECTION_TIMEOUT_MS ||
        (process.env.NODE_ENV === 'production' ? '60000' : '15000'),
      10
    ) || 15_000
  )
)

const pool = new Pool({
  connectionString,
  // Fewer idle connections on small PaaS instances (Neon pooler + low RAM).
  max: Math.max(
    2,
    Math.min(
      parseInt(process.env.PG_POOL_MAX || (process.env.NODE_ENV === 'production' ? '5' : '10'), 10) || 5,
      20
    )
  ),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: pgConnectionTimeoutMs,
  keepAlive: true,
})

pool.on('error', (err) => {
  console.error('[pg] pool error', err?.message || err)
})
console.log(
  `[pg] pool max=${pool.options.max} connectionTimeoutMs=${pgConnectionTimeoutMs} (set PG_CONNECTION_TIMEOUT_MS to override)`
)

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
     LIMIT 15`
  )
  if (legacy.rows.length === 0) {
    console.log('[cloudinary-migration] No legacy bytea files to migrate.')
    return
  }
  console.log(`[cloudinary-migration] Migrating ${legacy.rows.length} legacy files…`)

  for (const row of legacy.rows) {
    try {
      const result = await new Promise((resolve, reject) => {
        const size = row?.data?.length || 0
        const useLarge = size > 20 * 1024 * 1024
        const uploader = useLarge
          ? cloudinary.uploader.upload_large_stream
          : cloudinary.uploader.upload_stream
        const stream = uploader(
          {
            folder: `intranet/${row.direction_code}/${row.folder}`,
            public_id: row.id,
            resource_type: 'auto',
            ...(useLarge ? { chunk_size: 6_000_000 } : {}),
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

  // Note: Default direction is no longer created automatically
  // Admins must create directions manually through the UI
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

  // Add is_suspended flag (admin suspends users instead of deleting)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;
    `)
  } catch (_) { /* column may already exist */ }

  // Add name column (required when creating new users)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS name text DEFAULT '';
    `)
  } catch (_) { /* column may already exist */ }

  // Add prenoms column (first names, displayed with identifiant and profil)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS prenoms text DEFAULT '';
    `)
  } catch (_) { /* column may already exist */ }

  // Deleted users archive (soft-delete: users are copied here before removal, can be restored)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deleted_users (
      id uuid PRIMARY KEY,
      name text DEFAULT '',
      prenoms text DEFAULT '',
      identifiant text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL,
      direction_id uuid REFERENCES directions(id) ON DELETE SET NULL,
      must_change_password boolean NOT NULL DEFAULT true,
      is_direction_chief boolean NOT NULL DEFAULT false,
      is_suspended boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      deleted_by text
    );
  `)

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
  // Backfill folders without direction_id - only if a direction exists
  // If no directions exist, folders will remain without direction_id until admin creates one
  const anyDirection = await pool.query("SELECT id FROM directions LIMIT 1")
  if (anyDirection.rows.length > 0) {
    // Use the first available direction for orphaned folders
    const firstDirectionId = anyDirection.rows[0].id
    await pool.query('UPDATE folders SET direction_id = $1 WHERE direction_id IS NULL', [
      firstDirectionId,
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

  // ── Soft-delete support (Corbeille / Trash) ──
  try { await pool.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL') } catch (_) { /* ignore */ }
  try { await pool.query('ALTER TABLE links ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL') } catch (_) { /* ignore */ }
  try { await pool.query('ALTER TABLE folders ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL') } catch (_) { /* ignore */ }
  try { await pool.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_by text DEFAULT NULL') } catch (_) { /* ignore */ }
  try { await pool.query('ALTER TABLE links ADD COLUMN IF NOT EXISTS deleted_by text DEFAULT NULL') } catch (_) { /* ignore */ }
  try { await pool.query('ALTER TABLE folders ADD COLUMN IF NOT EXISTS deleted_by text DEFAULT NULL') } catch (_) { /* ignore */ }

  // ── Indexes for analytics / stats performance ──
  // These are safe and dramatically speed up /api/admin/stats.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at DESC);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_direction_created_at ON files (direction_id, created_at DESC);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files (deleted_at DESC);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_direction_deleted_at ON files (direction_id, deleted_at DESC);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files (uploaded_by);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_links_direction_created_at ON links (direction_id, created_at DESC);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_folders_direction_id ON folders (direction_id);`)

  // ── APK icon support ──
  try { await pool.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS icon_url text DEFAULT NULL') } catch (_) { /* ignore */ }

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

  // Cross-direction access: allows users from one direction to create folders/upload files in another direction
  await pool.query(`
    CREATE TABLE IF NOT EXISTS direction_access_grants (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_direction_id uuid NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
      granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, granted_direction_id)
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_direction_access_grants_user_id ON direction_access_grants(user_id);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_direction_access_grants_direction_id ON direction_access_grants(granted_direction_id);
  `)

  // Accès à un dossier en particulier pour des utilisateurs d'autres directions (dossiers cachés)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folder_access_grants (
      id uuid PRIMARY KEY,
      folder_id uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(folder_id, user_id)
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_folder_access_grants_user_id ON folder_access_grants(user_id);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_folder_access_grants_folder_id ON folder_access_grants(folder_id);
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

// Disk storage avoids holding the whole file in RAM (memoryStorage + large uploads = OOM on 2GB hosts).
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'intranet-djogana-uploads')
try {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true })
} catch (_) {
  /* ignore */
}

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB max upload
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname || '') || '.bin'}`),
  }),
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
 * Broadcast "user_suspended" to a specific identifiant so their session shows the suspension modal immediately.
 */
function broadcastUserSuspended(identifiant) {
  const message = JSON.stringify({ type: 'user_suspended' })
  for (const client of wsClients) {
    try {
      if (client._userIdentifiant === identifiant && client.readyState === 1) {
        client.send(message)
      }
    } catch (_) { /* ignore */ }
  }
}

/**
 * Broadcast "user_restored" to a specific identifiant so the suspension modal disappears and they can use the app again.
 */
function broadcastUserRestored(identifiant) {
  const message = JSON.stringify({ type: 'user_restored' })
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
 * Returns an array of { identifiant, role, connectedAt, name, prenoms }.
 */
function getOnlineUsers() {
  const seen = new Map()
  for (const client of wsClients) {
    if (client.readyState === 1 && client._userIdentifiant && client._userRole !== 'admin') {
      const ident = client._userIdentifiant
      if (!seen.has(ident)) {
        const cached = userDisplayCache.get(ident) || {}
        seen.set(ident, {
          identifiant: ident,
          role: client._userRole || 'user',
          connectedAt: client._connectedAt || null,
          name: cached.name || '',
          prenoms: cached.prenoms || '',
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
// Map<identifiant, { page, section, lastSeen, connectedAt, role, direction_name, name, prenoms }>
const userPresence = new Map()
// Cache identifiant -> { name, prenoms } for display in live actions (persists after disconnect)
const userDisplayCache = new Map()

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
  const cached = userDisplayCache.get(identifiant) || {}
  const entry = {
    ts: new Date().toISOString(),
    identifiant,
    name: cached.name || '',
    prenoms: cached.prenoms || '',
    action,
    detail: detail || null,
  }
  pushLiveAction(entry)
  broadcastLiveAction(entry)
}

// ---------- JWT helpers (for device-approval flow: mobile uses token to list/approve) ----------
function signToken(identifiant) {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '15m').toString()
  return jwt.sign(
    { identifiant, type: 'auth' },
    JWT_SECRET,
    { expiresIn, algorithm: 'HS256' }
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
    // Cache key includes caller + filters (so admins and direction-scoped users don't leak data)
    const cacheKey = JSON.stringify({
      identifiant: req.authIdentifiant,
      scope: (req.query.scope || '').toString().toLowerCase(),
      period: (req.query.period || 'all').toString(),
      from: req.query.from ? req.query.from.toString() : null,
      to: req.query.to ? req.query.to.toString() : null,
    })
    const cached = adminStatsCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < ADMIN_STATS_CACHE_TTL_MS) {
      return res.json(cached.data)
    }

    // Check access
    const userRow = await pool.query(
      'SELECT role, direction_id, is_direction_chief FROM users WHERE identifiant = $1',
      [req.authIdentifiant]
    )
    if (userRow.rows.length === 0) {
      return res.status(403).json({ error: 'Accès refusé.' })
    }
    const caller = userRow.rows[0]
    const isAdmin = caller.role === 'admin'
    const isDirectionChief = Boolean(caller.is_direction_chief)

    if (!isAdmin) {
      const perms = await getPermissionsForIdentifiant(req.authIdentifiant)
      if (!perms || !perms.can_view_stats) {
        return res.status(403).json({ error: 'Accès refusé.' })
      }
    }

    // Scope: admin sees full system; regular users see only their direction;
    // chief of direction can request scope=direction (default) or scope=all (full system)
    const scopeParam = (req.query.scope || '').toString().toLowerCase()
    let dirId = null
    if (isAdmin) {
      dirId = null
    } else if (isDirectionChief && scopeParam === 'all') {
      dirId = null
    } else {
      dirId = caller.direction_id
    }

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

    // Run independent stats queries in parallel (≤5 concurrent ≈ PG_POOL_MAX) to cut latency vs 17 round-trips.
    const [
      usersCount,
      usersByRole,
      usersByDirection,
      directionsCount,
      foldersCount,
    ] = await Promise.all([
      q('SELECT COUNT(*)::int AS count FROM users __WHERE__', { dateCol: null, extraWhere: ["role <> 'admin'"] }),
      q('SELECT role, COUNT(*)::int AS count FROM users __WHERE__ GROUP BY role ORDER BY count DESC', { dateCol: null, extraWhere: ["role <> 'admin'"] }),
      q(
        `SELECT COALESCE(d.name, 'Sans direction') AS direction, COUNT(u.id)::int AS count
         FROM users u LEFT JOIN directions d ON u.direction_id = d.id __WHERE__ GROUP BY d.name ORDER BY count DESC`,
        { joinAlias: 'u', dateCol: null, extraWhere: ["u.role <> 'admin'"] }
      ),
      dirId ? pool.query('SELECT 1::int AS count') : pool.query('SELECT COUNT(*)::int AS count FROM directions'),
      q('SELECT COUNT(*)::int AS count FROM folders __WHERE__', { dateCol: null }),
    ])

    const [foldersByDirection, filesCount, filesByType, filesByDirection, filesByDirectionAndType] =
      await Promise.all([
        q(
          `SELECT d.name AS direction, COUNT(fo.id)::int AS count
         FROM folders fo JOIN directions d ON fo.direction_id = d.id __WHERE__ GROUP BY d.name ORDER BY count DESC`,
          { joinAlias: 'fo', dateCol: null }
        ),
        q('SELECT COUNT(*)::int AS count FROM files __WHERE__'),
        q(
          `SELECT ${mimeCase} AS category, COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
         FROM files __WHERE__ GROUP BY category ORDER BY count DESC`
        ),
        q(
          `SELECT COALESCE(d.name, 'Sans direction') AS direction, COUNT(f.id)::int AS count,
                COALESCE(SUM(f.size),0)::bigint AS total_size
         FROM files f LEFT JOIN directions d ON f.direction_id = d.id __WHERE__ GROUP BY d.name ORDER BY count DESC`,
          { joinAlias: 'f' }
        ),
        q(
          `SELECT COALESCE(d.name, 'Sans direction') AS direction,
                ${mimeCase} AS category,
                COUNT(f.id)::int AS count,
                COALESCE(SUM(f.size),0)::bigint AS total_size
         FROM files f LEFT JOIN directions d ON f.direction_id = d.id __WHERE__
         GROUP BY d.name, category ORDER BY d.name, count DESC`,
          { joinAlias: 'f' }
        ),
      ])

    const buildFilesTimeWhere = (dateColumn) => {
      const clauses = []
      const params = []
      if (dirId) {
        params.push(dirId)
        clauses.push(`direction_id = $${params.length}`)
      }
      if (fromDate) {
        params.push(fromDate)
        clauses.push(`${dateColumn} >= $${params.length}`)
      } else {
        params.push(new Date(Date.now() - 365 * 86400000).toISOString())
        clauses.push(`${dateColumn} >= $${params.length}`)
      }
      if (toDate) {
        params.push(toDate)
        clauses.push(`${dateColumn} <= $${params.length}`)
      }
      return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params }
    }

    const ftCreated = buildFilesTimeWhere('created_at')
    const ftDeleted = (() => {
      const { where, params } = buildFilesTimeWhere('deleted_at')
      const extra = where ? ' AND deleted_at IS NOT NULL' : ' WHERE deleted_at IS NOT NULL'
      return { where: where ? where + extra : ' WHERE deleted_at IS NOT NULL', params }
    })()

    const filesOverTimePromise = pool.query(
      `
          SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                 COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
          FROM files ${ftCreated.where}
          GROUP BY month ORDER BY month ASC
        `,
      ftCreated.params
    )

    const filesOverTimeByTypePromise = pool.query(
      `
          SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                 ${mimeCase} AS category,
                 COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
          FROM files ${ftCreated.where}
          GROUP BY month, category ORDER BY month ASC, count DESC
        `,
      ftCreated.params
    )

    const filesDeletedOverTimePromise = pool.query(
      `
          SELECT TO_CHAR(DATE_TRUNC('month', deleted_at), 'YYYY-MM') AS month,
                 COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size
          FROM files ${ftDeleted.where}
          GROUP BY month ORDER BY month ASC
        `,
      ftDeleted.params
    )

    const [storageTotal, linksCount, recentActivity, topUploaders, filesOverTime] = await Promise.all([
      q('SELECT COALESCE(SUM(size),0)::bigint AS total FROM files __WHERE__'),
      q('SELECT COUNT(*)::int AS count FROM links __WHERE__'),
      q(
        `SELECT a.action, a.actor_identifiant, COALESCE(u.role, 'Système') AS actor_role,
         u.name AS actor_name, u.prenoms AS actor_prenoms, a.entity_type, a.details, a.created_at
         FROM activity_log a
         LEFT JOIN users u ON a.actor_identifiant = u.identifiant
         __WHERE__ ORDER BY a.created_at DESC LIMIT 20`,
        isAdmin
          ? { joinAlias: 'a' }
          : {
              joinAlias: 'a',
              extraWhere: [
                "(a.actor_identifiant IS NULL OR a.actor_identifiant NOT IN (SELECT identifiant FROM users WHERE role = 'admin'))",
              ],
            }
      ),
      q(
        `SELECT u.identifiant, u.role, COUNT(f.id)::int AS uploads
         FROM files f JOIN users u ON f.uploaded_by = u.id __WHERE__
         GROUP BY u.identifiant, u.role ORDER BY uploads DESC LIMIT 5`,
        { joinAlias: 'f', extraWhere: ["u.role <> 'admin'"] }
      ),
      filesOverTimePromise,
    ])

    const [filesOverTimeByType, filesDeletedOverTime] = await Promise.all([
      filesOverTimeByTypePromise,
      filesDeletedOverTimePromise,
    ])

    // For direction-scoped users, include the direction name
    let scopedDirectionName = null
    if (dirId) {
      const d = await pool.query('SELECT name FROM directions WHERE id = $1', [dirId])
      scopedDirectionName = d.rows[0]?.name || null
    }

    // Chiefs of direction (and admins) can switch to full-system stats
    const scopeOptionAllAvailable = isAdmin || isDirectionChief

    const payload = {
      scopedDirection: scopedDirectionName,
      scope: dirId ? 'direction' : 'all',
      scopeOptionAllAvailable: !!scopeOptionAllAvailable,
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
        deletedOverTime: filesDeletedOverTime.rows,
      },
      storage: {
        totalBytes: Number(storageTotal.rows[0].total),
      },
      links: {
        total: linksCount.rows[0].count,
      },
      recentActivity: recentActivity.rows,
      topUploaders: topUploaders.rows,
    }

    adminStatsCacheSet(cacheKey, { ts: Date.now(), data: payload })
    return res.json(payload)
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
      SELECT u.id, u.name, u.prenoms, u.identifiant, u.role, u.direction_id, u.created_at, u.is_direction_chief, u.is_suspended,
             d.name AS direction_name
      FROM users u
      LEFT JOIN directions d ON d.id = u.direction_id
      WHERE u.role <> 'admin'
      ORDER BY u.created_at DESC
    `)
    return res.json(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name || '',
        prenoms: r.prenoms || '',
        identifiant: r.identifiant,
        role: r.role,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        is_direction_chief: Boolean(r.is_direction_chief),
        is_suspended: Boolean(r.is_suspended),
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
      'SELECT id, name, prenoms, identifiant, password_hash, role, direction_id, must_change_password, is_direction_chief, is_suspended, created_at FROM users WHERE id = $1',
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

    // Copy to deleted_users before removing (for recovery)
    await pool.query(
      `INSERT INTO deleted_users (id, name, prenoms, identifiant, password_hash, role, direction_id, must_change_password, is_direction_chief, is_suspended, created_at, deleted_at, deleted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)`,
      [
        deletedUser.id,
        deletedUser.name || '',
        deletedUser.prenoms || '',
        deletedUser.identifiant,
        deletedUser.password_hash,
        deletedUser.role,
        deletedUser.direction_id,
        deletedUser.must_change_password,
        deletedUser.is_direction_chief,
        deletedUser.is_suspended,
        deletedUser.created_at,
        callerIdentifiant || null,
      ]
    )

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

// List deleted users (admin only)
app.get('/api/deleted-users', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [req.authIdentifiant])
    if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
    }
    const result = await pool.query(`
      SELECT du.id, du.name, du.prenoms, du.identifiant, du.role, du.deleted_at, du.deleted_by,
             d.name AS direction_name
      FROM deleted_users du
      LEFT JOIN directions d ON d.id = du.direction_id
      ORDER BY du.deleted_at DESC
    `)
    return res.json(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name || '',
        prenoms: r.prenoms || '',
        identifiant: r.identifiant,
        role: r.role,
        direction_name: r.direction_name,
        deleted_at: r.deleted_at,
        deleted_by: r.deleted_by,
      }))
    )
  } catch (err) {
    console.error('list deleted users error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs supprimés.' })
  }
})

// Restore a deleted user (admin only)
app.post('/api/deleted-users/:id/restore', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [req.authIdentifiant])
    if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
    }
    const { id } = req.params
    const du = await pool.query('SELECT * FROM deleted_users WHERE id = $1', [id])
    if (du.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable dans les archives.' })
    }
    const row = du.rows[0]
    const existing = await pool.query('SELECT id FROM users WHERE identifiant = $1', [row.identifiant])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un utilisateur avec cet identifiant existe déjà. Renommez-le avant de restaurer.' })
    }
    await pool.query(
      `INSERT INTO users (id, name, prenoms, identifiant, password_hash, role, direction_id, must_change_password, is_direction_chief, is_suspended, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.name,
        row.prenoms,
        row.identifiant,
        row.password_hash,
        row.role,
        row.direction_id,
        row.must_change_password,
        row.is_direction_chief,
        row.is_suspended,
        row.created_at,
      ]
    )
    await pool.query('DELETE FROM deleted_users WHERE id = $1', [id])
    broadcastDataChange('users', 'created', { id })
    return res.json({ ok: true, id: row.id })
  } catch (err) {
    console.error('restore user error', err)
    return res.status(500).json({ error: 'Erreur lors de la restauration.' })
  }
})

// Reset a user's password (admin only).
// Sets password_hash = hash(identifiant) and must_change_password = true,
// so the user must change it at next login.
app.post('/api/users/:id/reset-password', requireAuth, async (req, res) => {
  try {
    const callerIdentifiant = req.authIdentifiant
    const callerRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [callerIdentifiant])
    if (callerRes.rows.length === 0 || callerRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
    }

    const { id } = req.params
    const userRow = await pool.query(
      'SELECT id, identifiant, role, direction_id FROM users WHERE id = $1',
      [id]
    )
    if (userRow.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const targetUser = userRow.rows[0]

    // Sécurité: ne pas réinitialiser les comptes admin via ce bouton
    if (targetUser.role === 'admin') {
      return res.status(403).json({ error: 'Impossible de réinitialiser le mot de passe d’un administrateur via cette action.' })
    }

    const ident = String(targetUser.identifiant || '').trim()
    if (!ident) {
      return res.status(400).json({ error: 'Identifiant utilisateur invalide pour la réinitialisation.' })
    }

    const hashed = await bcrypt.hash(ident, 10)
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2',
      [hashed, id]
    )

    // Activity log
    let actorId = null
    const actorRes = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
    if (actorRes.rows.length > 0) actorId = actorRes.rows[0].id
    await insertActivityLog(pool, {
      action: 'reset_user_password',
      actorIdentifiant: callerIdentifiant,
      actorId,
      directionId: targetUser.direction_id,
      entityType: 'user',
      entityId: id,
      details: { identifiant: targetUser.identifiant, role: targetUser.role },
    })

    broadcastDataChange('users', 'updated', { id })

    return res.json({ ok: true })
  } catch (err) {
    console.error('reset-password error', err)
    return res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe.' })
  }
})

// Update user role and/or direction
app.patch('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { role, direction_id, is_suspended, name, prenoms, caller_identifiant } = req.body || {}

    // Permission: can_create_user for role/direction/name/prenoms; can_delete_user for suspension
    if (caller_identifiant) {
      const perms = await getPermissionsForIdentifiant(caller_identifiant)
      const callerRes = await pool.query('SELECT role FROM users WHERE identifiant = $1', [caller_identifiant])
      const isCallerAdmin = callerRes.rows.length > 0 && callerRes.rows[0].role === 'admin'
      if (is_suspended !== undefined && !isCallerAdmin && perms && !perms.can_delete_user) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de suspendre des utilisateurs.' })
      }
      if ((role !== undefined || direction_id !== undefined || name !== undefined || prenoms !== undefined) && !isCallerAdmin && perms && !perms.can_create_user) {
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de modifier des utilisateurs.' })
      }
    }

    // Ensure the target user exists
    const userRow = await pool.query(
      'SELECT id, identifiant, role, direction_id, is_suspended, name, prenoms FROM users WHERE id = $1',
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

    if (is_suspended !== undefined && typeof is_suspended === 'boolean') {
      sets.push(`is_suspended = $${idx}`)
      vals.push(is_suspended)
      idx++
    }

    if (name !== undefined) {
      sets.push(`name = $${idx}`)
      vals.push(typeof name === 'string' ? name.trim() : '')
      idx++
    }
    if (prenoms !== undefined) {
      sets.push(`prenoms = $${idx}`)
      vals.push(typeof prenoms === 'string' ? prenoms.trim() : '')
      idx++
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucune modification fournie.' })
    }

    vals.push(id)
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, identifiant, role, direction_id, is_direction_chief, is_suspended, name, prenoms`,
      vals
    )

    const newSuspended = result.rows[0].is_suspended
    // Real-time suspend/restore via WebSocket so modal appears or disappears without refresh
    if (is_suspended !== undefined && targetUser.is_suspended !== newSuspended) {
      if (newSuspended) {
        broadcastUserSuspended(targetUser.identifiant)
        sendPushToIdentifiants(
          [targetUser.identifiant],
          'Compte suspendu',
          'Votre compte a été suspendu par un administrateur.',
          { type: 'user_suspended' }
        ).catch((err) => console.error('[push] user_suspended', err))
      } else {
        broadcastUserRestored(targetUser.identifiant)
        sendPushToIdentifiants(
          [targetUser.identifiant],
          'Compte réactivé',
          'Votre compte a été réactivé. Vous pouvez à nouveau vous connecter.',
          { type: 'user_restored' }
        ).catch((err) => console.error('[push] user_restored', err))
      }
    }

    // Activity log for suspend/unsuspend
    if (is_suspended !== undefined && targetUser.is_suspended !== newSuspended) {
      let actorId = null
      if (caller_identifiant) {
        const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [caller_identifiant])
        if (u.rows.length > 0) actorId = u.rows[0].id
      }
      await insertActivityLog(pool, {
        action: newSuspended ? 'suspend_user' : 'unsuspend_user',
        actorIdentifiant: caller_identifiant || null,
        actorId,
        directionId: targetUser.direction_id,
        entityType: 'user',
        entityId: id,
        details: { identifiant: targetUser.identifiant, role: targetUser.role },
      })
    }

    // Get direction name for the response
    let direction_name = null
    if (result.rows[0].direction_id) {
      const dirRes = await pool.query('SELECT name FROM directions WHERE id = $1', [result.rows[0].direction_id])
      if (dirRes.rows.length > 0) direction_name = dirRes.rows[0].name
    }

    // Activity log for role/direction changes
    if (role !== undefined || direction_id !== undefined) {
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
    }
    // Activity log for name/prenoms changes
    if ((name !== undefined || prenoms !== undefined) && (targetUser.name !== (result.rows[0].name ?? '') || targetUser.prenoms !== (result.rows[0].prenoms ?? ''))) {
      let actorId = null
      if (caller_identifiant) {
        const u = await pool.query('SELECT id FROM users WHERE identifiant = $1', [caller_identifiant])
        if (u.rows.length > 0) actorId = u.rows[0].id
      }
      await insertActivityLog(pool, {
        action: 'update_user_profile',
        actorIdentifiant: caller_identifiant || null,
        actorId,
        directionId: result.rows[0].direction_id,
        entityType: 'user',
        entityId: id,
        details: {
          identifiant: targetUser.identifiant,
          oldName: targetUser.name,
          newName: result.rows[0].name,
          oldPrenoms: targetUser.prenoms,
          newPrenoms: result.rows[0].prenoms,
        },
      })
    }

    broadcastDataChange('users', 'updated', { id })
    // Notify the user so their permissions refresh
    broadcastPermissionsChange(result.rows[0].role)

    // Notification push (app mobile) : profil modifié (rôle, direction, nom ou prénoms)
    const profileChanged =
      (role !== undefined && targetUser.role !== result.rows[0].role) ||
      (direction_id !== undefined && targetUser.direction_id !== result.rows[0].direction_id) ||
      (name !== undefined && (targetUser.name ?? '') !== (result.rows[0].name ?? '')) ||
      (prenoms !== undefined && (targetUser.prenoms ?? '') !== (result.rows[0].prenoms ?? ''))
    if (profileChanged) {
      const msg =
        (name !== undefined || prenoms !== undefined) && (targetUser.name !== (result.rows[0].name ?? '') || targetUser.prenoms !== (result.rows[0].prenoms ?? ''))
          ? 'Vos nom et prénom ont été modifiés par un administrateur.'
          : 'Votre profil (rôle ou direction) a été modifié par un administrateur.'
      sendPushToIdentifiants(
        [targetUser.identifiant],
        'Profil modifié',
        msg,
        { type: 'profile_updated' }
      ).catch((err) => console.error('[push] profile_updated', err))
    }

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

    sendPushToIdentifiants(
      [targetUser.identifiant],
      'Statut modifié',
      'Votre statut de chef de direction a été modifié.',
      { type: 'profile_updated' }
    ).catch((err) => console.error('[push] chief_updated', err))

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

// Grant cross-direction access to a user (admin or direction chief)
app.post('/api/direction-access/grant', async (req, res) => {
  try {
    const { user_id: userId, direction_id: directionId, caller_identifiant: callerIdentifiant } = req.body || {}
    
    if (!userId || !directionId || !callerIdentifiant) {
      return res.status(400).json({ error: 'Paramètres manquants.' })
    }
    
    // Check if caller can grant access
    const canGrant = await canGrantDirectionAccess(callerIdentifiant, directionId)
    if (!canGrant) {
      return res.status(403).json({
        error: 'Vous n\'avez pas la permission d\'accorder l\'accès à cette direction.',
      })
    }
    
    // Verify user and direction exist
    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [userId])
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    
    const dirRes = await pool.query('SELECT id FROM directions WHERE id = $1', [directionId])
    if (dirRes.rows.length === 0) {
      return res.status(404).json({ error: 'Direction introuvable.' })
    }
    
    // Get granter's user ID
    const granterRes = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
    const granterId = granterRes.rows.length > 0 ? granterRes.rows[0].id : null
    
    // Create or update grant
    const id = uuidv4()
    await pool.query(
      `INSERT INTO direction_access_grants (id, user_id, granted_direction_id, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, granted_direction_id) DO UPDATE SET granted_by = $4`,
      [id, userId, directionId, granterId]
    )
    
    // Get user and direction names for response
    const userInfo = await pool.query('SELECT identifiant FROM users WHERE id = $1', [userId])
    const dirInfo = await pool.query('SELECT name FROM directions WHERE id = $1', [directionId])
    
    await insertActivityLog(pool, {
      action: 'grant_direction_access',
      actorIdentifiant: callerIdentifiant,
      actorId: granterId,
      directionId,
      entityType: 'user',
      entityId: userId,
      details: {
        user_identifiant: userInfo.rows[0]?.identifiant,
        direction_name: dirInfo.rows[0]?.name,
      },
    })
    
    broadcastDataChange('users', 'updated', { id: userId })

    // Notify the affected user to refresh their permissions (WebSocket + push mobile)
    if (userInfo.rows.length > 0) {
      const userIdentifiant = userInfo.rows[0].identifiant
      const dirName = dirInfo.rows[0]?.name || 'Direction'
      const message = JSON.stringify({ type: 'permissions_changed' })
      let notified = false
      for (const client of wsClients) {
        try {
          if (client._userIdentifiant === userIdentifiant && client.readyState === 1) {
            client.send(message)
            notified = true
            console.log(`[grant-access] Sent permissions_changed WebSocket to ${userIdentifiant}`)
          }
        } catch (err) {
          console.error(`[grant-access] Error sending WebSocket to ${userIdentifiant}:`, err)
        }
      }
      if (!notified) {
        console.log(`[grant-access] User ${userIdentifiant} not connected via WebSocket (will refresh on next page load)`)
      }
      // Notification push (app mobile) : accès à une direction accordé
      sendPushToIdentifiants(
        [userIdentifiant],
        'Accès accordé',
        `Vous avez reçu l'accès à la direction : ${dirName}`,
        { type: 'direction_access_granted', direction_id: directionId, direction_name: dirName }
      ).catch((err) => console.error('[push] direction_access_granted', err))
    }

    return res.status(201).json({
      id,
      user_id: userId,
      direction_id: directionId,
      granted: true,
    })
  } catch (err) {
    console.error('grant direction access error', err)
    return res.status(500).json({ error: 'Erreur lors de l\'octroi de l\'accès.' })
  }
})

// Revoke cross-direction access (admin or direction chief)
app.delete('/api/direction-access/revoke', async (req, res) => {
  try {
    const { user_id: userId, direction_id: directionId, caller_identifiant: callerIdentifiant } = req.body || {}
    
    if (!userId || !directionId || !callerIdentifiant) {
      return res.status(400).json({ error: 'Paramètres manquants.' })
    }
    
    // Check if caller can revoke access
    const canGrant = await canGrantDirectionAccess(callerIdentifiant, directionId)
    if (!canGrant) {
      return res.status(403).json({
        error: 'Vous n\'avez pas la permission de révoquer l\'accès à cette direction.',
      })
    }
    
    // Get granter's user ID
    const granterRes = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
    const granterId = granterRes.rows.length > 0 ? granterRes.rows[0].id : null
    
    // Delete grant
    const result = await pool.query(
      'DELETE FROM direction_access_grants WHERE user_id = $1 AND granted_direction_id = $2 RETURNING id',
      [userId, directionId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Accès non trouvé.' })
    }
    
    // Get user and direction names for activity log
    const userInfo = await pool.query('SELECT identifiant FROM users WHERE id = $1', [userId])
    const dirInfo = await pool.query('SELECT name FROM directions WHERE id = $1', [directionId])
    
    await insertActivityLog(pool, {
      action: 'revoke_direction_access',
      actorIdentifiant: callerIdentifiant,
      actorId: granterId,
      directionId,
      entityType: 'user',
      entityId: userId,
      details: {
        user_identifiant: userInfo.rows[0]?.identifiant,
        direction_name: dirInfo.rows[0]?.name,
      },
    })
    
    broadcastDataChange('users', 'updated', { id: userId })
    
    // Notify the affected user to refresh their permissions
    // userInfo was already fetched above, reuse it
    if (userInfo.rows.length > 0) {
      const userIdentifiant = userInfo.rows[0].identifiant
      const message = JSON.stringify({ type: 'permissions_changed' })
      let notified = false
      for (const client of wsClients) {
        try {
          if (client._userIdentifiant === userIdentifiant && client.readyState === 1) {
            client.send(message)
            notified = true
            console.log(`[revoke-access] Sent permissions_changed WebSocket to ${userIdentifiant}`)
          }
        } catch (err) {
          console.error(`[revoke-access] Error sending WebSocket to ${userIdentifiant}:`, err)
        }
      }
      if (!notified) {
        console.log(`[revoke-access] User ${userIdentifiant} not connected via WebSocket (will refresh on next page load)`)
      }
    }
    
    return res.status(204).send()
  } catch (err) {
    console.error('revoke direction access error', err)
    return res.status(500).json({ error: 'Erreur lors de la révocation de l\'accès.' })
  }
})

// Helper: check if caller can grant/revoke folder access (admin or chef of the folder's direction)
async function canGrantFolderAccess(callerIdentifiant, folderId) {
  const folderRes = await pool.query('SELECT direction_id FROM folders WHERE id = $1', [folderId])
  if (folderRes.rows.length === 0) return false
  return canGrantDirectionAccess(callerIdentifiant, folderRes.rows[0].direction_id)
}

// List folder access grants (for a folder or for a user)
app.get('/api/folder-access', async (req, res) => {
  try {
    const { folder_id: folderId, user_id: userId } = req.query
    if (folderId) {
      const rows = await pool.query(
        `SELECT fag.id, fag.folder_id, fag.user_id, fag.granted_by, fag.created_at,
                u.identifiant AS user_identifiant, u.name AS user_name, u.prenoms AS user_prenoms,
                f.name AS folder_name, d.name AS direction_name
         FROM folder_access_grants fag
         JOIN users u ON u.id = fag.user_id
         JOIN folders f ON f.id = fag.folder_id
         JOIN directions d ON d.id = f.direction_id
         WHERE fag.folder_id = $1`,
        [folderId]
      )
      return res.json(rows.rows.map((r) => ({
        id: r.id,
        folder_id: r.folder_id,
        user_id: r.user_id,
        user_identifiant: r.user_identifiant,
        user_name: r.user_name,
        user_prenoms: r.user_prenoms,
        folder_name: r.folder_name,
        direction_name: r.direction_name,
        granted_by: r.granted_by,
        created_at: r.created_at,
      })))
    }
    if (userId) {
      const rows = await pool.query(
        `SELECT fag.id, fag.folder_id, fag.user_id, fag.granted_by, fag.created_at,
                f.name AS folder_name, f.direction_id, d.name AS direction_name
         FROM folder_access_grants fag
         JOIN folders f ON f.id = fag.folder_id
         JOIN directions d ON d.id = f.direction_id
         WHERE fag.user_id = $1`,
        [userId]
      )
      return res.json(rows.rows.map((r) => ({
        id: r.id,
        folder_id: r.folder_id,
        folder_name: r.folder_name,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        granted_by: r.granted_by,
        created_at: r.created_at,
      })))
    }
    return res.status(400).json({ error: 'Précisez folder_id ou user_id.' })
  } catch (err) {
    console.error('folder-access list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des accès dossier.' })
  }
})

// Grant folder access (allow a user from another direction to see a specific folder)
app.post('/api/folder-access', async (req, res) => {
  try {
    const { folder_id: folderId, user_id: userId, caller_identifiant: callerIdentifiant } = req.body || {}
    if (!folderId || !userId || !callerIdentifiant) {
      return res.status(400).json({ error: 'Paramètres manquants (folder_id, user_id, caller_identifiant).' })
    }
    const canGrant = await canGrantFolderAccess(callerIdentifiant, folderId)
    if (!canGrant) {
      return res.status(403).json({
        error: 'Vous n\'avez pas la permission d\'accorder l\'accès à ce dossier.',
      })
    }
    const folderRes = await pool.query('SELECT id, name, direction_id FROM folders WHERE id = $1', [folderId])
    if (folderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dossier introuvable.' })
    }
    const userRes = await pool.query('SELECT id, identifiant FROM users WHERE id = $1', [userId])
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const granterRes = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
    const granterId = granterRes.rows.length > 0 ? granterRes.rows[0].id : null
    const id = uuidv4()
    await pool.query(
      `INSERT INTO folder_access_grants (id, folder_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (folder_id, user_id) DO UPDATE SET granted_by = $4`,
      [id, folderId, userId, granterId]
    )
    await insertActivityLog(pool, {
      action: 'grant_folder_access',
      actorIdentifiant: callerIdentifiant,
      actorId: granterId,
      directionId: folderRes.rows[0].direction_id,
      entityType: 'folder',
      entityId: folderId,
      details: {
        folder_name: folderRes.rows[0].name,
        user_identifiant: userRes.rows[0].identifiant,
      },
    })
    broadcastDataChange('folders', 'updated', { id: folderId })
    const userIdentifiant = userRes.rows[0].identifiant
    const folderName = folderRes.rows[0].name
    const message = JSON.stringify({ type: 'permissions_changed' })
    for (const client of wsClients) {
      try {
        if (client._userIdentifiant === userIdentifiant && client.readyState === 1) {
          client.send(message)
          break
        }
      } catch (_) { /* ignore */ }
    }
    // Notification push (app mobile) : accès à un dossier accordé
    sendPushToIdentifiants(
      [userIdentifiant],
      'Accès au dossier accordé',
      `Vous avez reçu l'accès au dossier : ${folderName}`,
      { type: 'folder_access_granted', folder_id: folderId, folder_name: folderName }
    ).catch((err) => console.error('[push] folder_access_granted', err))
    return res.status(201).json({ id, folder_id: folderId, user_id: userId, granted: true })
  } catch (err) {
    console.error('grant folder access error', err)
    return res.status(500).json({ error: 'Erreur lors de l\'octroi de l\'accès au dossier.' })
  }
})

// Revoke folder access
app.delete('/api/folder-access/revoke', async (req, res) => {
  try {
    const { folder_id: folderId, user_id: userId, caller_identifiant: callerIdentifiant } = req.body || {}
    if (!folderId || !userId || !callerIdentifiant) {
      return res.status(400).json({ error: 'Paramètres manquants.' })
    }
    const canGrant = await canGrantFolderAccess(callerIdentifiant, folderId)
    if (!canGrant) {
      return res.status(403).json({
        error: 'Vous n\'avez pas la permission de révoquer l\'accès à ce dossier.',
      })
    }
    const folderRes = await pool.query('SELECT id, name, direction_id FROM folders WHERE id = $1', [folderId])
    if (folderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dossier introuvable.' })
    }
    const result = await pool.query(
      'DELETE FROM folder_access_grants WHERE folder_id = $1 AND user_id = $2 RETURNING id',
      [folderId, userId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Accès au dossier non trouvé.' })
    }
    const granterRes = await pool.query('SELECT id FROM users WHERE identifiant = $1', [callerIdentifiant])
    const granterId = granterRes.rows.length > 0 ? granterRes.rows[0].id : null
    const userRes = await pool.query('SELECT identifiant FROM users WHERE id = $1', [userId])
    await insertActivityLog(pool, {
      action: 'revoke_folder_access',
      actorIdentifiant: callerIdentifiant,
      actorId: granterId,
      directionId: folderRes.rows[0].direction_id,
      entityType: 'folder',
      entityId: folderId,
      details: {
        folder_name: folderRes.rows[0].name,
        user_identifiant: userRes.rows[0]?.identifiant,
      },
    })
    broadcastDataChange('folders', 'updated', { id: folderId })
    const userIdentifiant = userRes.rows[0]?.identifiant
    if (userIdentifiant) {
      const message = JSON.stringify({ type: 'permissions_changed' })
      for (const client of wsClients) {
        try {
          if (client._userIdentifiant === userIdentifiant && client.readyState === 1) {
            client.send(message)
            break
          }
        } catch (_) { /* ignore */ }
      }
    }
    return res.status(204).send()
  } catch (err) {
    console.error('revoke folder access error', err)
    return res.status(500).json({ error: 'Erreur lors de la révocation de l\'accès au dossier.' })
  }
})

// Get directions the current user has access to (for UI filtering)
app.get('/api/direction-access/my-access', async (req, res) => {
  try {
    const { identifiant } = req.query
    if (!identifiant) {
      return res.status(401).json({ error: 'Authentification requise.' })
    }
    
    const userRes = await pool.query(
      'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    }
    
    const u = userRes.rows[0]
    const accessibleDirections = []
    
    // Add user's own direction if they have one
    if (u.direction_id) {
      accessibleDirections.push(u.direction_id)
    }
    
    // If admin, they have access to all directions (no need to check grants)
    if (u.role !== 'admin') {
      // Get granted directions
      const grantsRes = await pool.query(
        'SELECT granted_direction_id FROM direction_access_grants WHERE user_id = $1',
        [u.id]
      )
      console.log(`[my-access] User ${identifiant} (id: ${u.id}, role: ${u.role}) has ${grantsRes.rows.length} grants`)
      grantsRes.rows.forEach((row) => {
        if (row.granted_direction_id && !accessibleDirections.includes(row.granted_direction_id)) {
          accessibleDirections.push(row.granted_direction_id)
        }
      })
      console.log(`[my-access] User ${identifiant} accessible directions:`, accessibleDirections)
    } else {
      console.log(`[my-access] User ${identifiant} is admin - has access to all directions`)
    }
    
    return res.json({ direction_ids: accessibleDirections })
  } catch (err) {
    console.error('get my direction access error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des accès.' })
  }
})

// List all direction access grants for a user or direction
app.get('/api/direction-access', async (req, res) => {
  try {
    const { user_id: userId, direction_id: directionId, caller_identifiant: callerIdentifiant } = req.query
    
    if (!callerIdentifiant) {
      return res.status(401).json({ error: 'Authentification requise.' })
    }
    
    const callerRes = await pool.query(
      'SELECT role, direction_id, is_direction_chief FROM users WHERE identifiant = $1',
      [callerIdentifiant]
    )
    if (callerRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    }
    
    const caller = callerRes.rows[0]
    const isAdmin = caller.role === 'admin'
    
    let sql = `
      SELECT 
        g.id,
        g.user_id,
        g.granted_direction_id,
        g.granted_by,
        g.created_at,
        u.identifiant AS user_identifiant,
        d.name AS direction_name,
        granter.identifiant AS granted_by_identifiant
      FROM direction_access_grants g
      JOIN users u ON u.id = g.user_id
      JOIN directions d ON d.id = g.granted_direction_id
      LEFT JOIN users granter ON granter.id = g.granted_by
      WHERE 1=1
    `
    const params = []
    
    if (userId) {
      params.push(userId)
      sql += ` AND g.user_id = $${params.length}`
    }
    
    if (directionId) {
      params.push(directionId)
      sql += ` AND g.granted_direction_id = $${params.length}`
      
      // Non-admin direction chiefs can only see grants for their own direction
      if (!isAdmin && caller.is_direction_chief && caller.direction_id !== directionId) {
        return res.status(403).json({ error: 'Vous ne pouvez voir que les accès pour votre direction.' })
      }
    } else if (!isAdmin) {
      // Non-admin users can only see grants for their own direction
      if (caller.is_direction_chief && caller.direction_id) {
        params.push(caller.direction_id)
        sql += ` AND g.granted_direction_id = $${params.length}`
      } else {
        return res.status(403).json({ error: 'Accès refusé.' })
      }
    }
    
    sql += ' ORDER BY g.created_at DESC'
    
    const result = await pool.query(sql, params)
    
    return res.json(result.rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      user_identifiant: r.user_identifiant,
      direction_id: r.granted_direction_id,
      direction_name: r.direction_name,
      granted_by_identifiant: r.granted_by_identifiant,
      created_at: r.created_at,
    })))
  } catch (err) {
    console.error('list direction access error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des accès.' })
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, prenoms, identifiant, password, role, direction_id: directionId, caller_identifiant: callerIdentifiant } = req.body || {}
    if (!identifiant || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe sont requis.' })
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Le nom est requis.' })
    }
    if (!prenoms || typeof prenoms !== 'string' || !prenoms.trim()) {
      return res.status(400).json({ error: 'Les prénoms sont requis.' })
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
      `INSERT INTO users (id, name, prenoms, identifiant, password_hash, role, direction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, (name || '').trim(), (prenoms || '').trim(), identifiant, hashed, finalRole, finalRole === 'admin' ? null : directionId]
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
    return res.status(201).json({ id, name: (name || '').trim(), prenoms: (prenoms || '').trim(), identifiant, role: finalRole, direction_id: finalRole === 'admin' ? null : directionId })
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
      `SELECT u.id, u.name, u.prenoms, u.identifiant, u.password_hash, u.role, u.direction_id, u.must_change_password, u.is_direction_chief, u.is_suspended, d.name AS direction_name
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

    const permissions = user.is_suspended ? null : await getPermissionsForIdentifiant(user.identifiant)
    const token = signToken(user.identifiant)

    return res.json({
      id: user.id,
      name: user.name || '',
      prenoms: user.prenoms || '',
      identifiant: user.identifiant,
      role: user.role,
      direction_id: user.direction_id,
      direction_name: user.direction_name || null,
      is_direction_chief: Boolean(user.is_direction_chief),
      is_suspended: Boolean(user.is_suspended),
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
      `SELECT u.id, u.name, u.prenoms, u.identifiant, u.role, u.direction_id, u.must_change_password, u.is_direction_chief, u.is_suspended, d.name AS direction_name
       FROM users u
       LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    const user = result.rows[0]
    const permissions = user.is_suspended ? null : await getPermissionsForIdentifiant(user.identifiant)
    return res.json({
      id: user.id,
      name: user.name || '',
      prenoms: user.prenoms || '',
      identifiant: user.identifiant,
      role: user.role,
      direction_id: user.direction_id,
      direction_name: user.direction_name || null,
      is_direction_chief: Boolean(user.is_direction_chief),
      is_suspended: Boolean(user.is_suspended),
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

    sendPushToIdentifiants(
      [identifiant],
      'Mot de passe modifié',
      'Votre mot de passe a été modifié avec succès.',
      { type: 'password_changed' }
    ).catch((err) => console.error('[push] password_changed', err))

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
      `SELECT u.id, u.identifiant, u.password_hash, u.role, u.direction_id, u.must_change_password, u.is_suspended, d.name AS direction_name
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
          const messaging = getMessaging()
          const expoTokens = []
          const fcmTokens = []
          for (const row of tokenRows.rows) {
            const keyToken = typeof row.expo_push_token === 'string' ? row.expo_push_token.trim() : ''
            const fcmToken = typeof row.fcm_token === 'string' ? row.fcm_token.trim() : ''

            if (isExpoPushToken(keyToken)) expoTokens.push(keyToken)
            else if (isLikelyFcmToken(fcmToken)) fcmTokens.push(fcmToken)
            else if (isLikelyFcmToken(keyToken)) fcmTokens.push(keyToken)
            else if (keyToken) {
              console.warn('[push] unknown token format, skipping:', keyToken.slice(0, 20) + '...')
            }
          }

          if (expoTokens.length > 0) {
            await sendExpoPushNotifications(expoTokens, {
              title: 'Nouvelle demande de connexion',
              body: `Code: ${code} — Approuver ou refuser`,
              channelId: 'approval_mixkit_v1',
              sound: 'mixkit_correct_answer_tone_2870',
              categoryId: 'approval_request',
              data: {
                requestId: String(requestId),
                code: String(code),
                categoryId: 'approval_request',
              },
            })
          }

          if (fcmTokens.length > 0) {
            if (!messaging) return
            for (const deviceToken of fcmTokens) {
              try {
                const result = await messaging.send({
                  token: deviceToken,
                  notification: {
                    title: 'Nouvelle demande de connexion',
                    body: `Code: ${code} — Approuver ou refuser`,
                  },
                  data: {
                    title: 'Nouvelle demande de connexion',
                    body: `Code: ${code} — Approuver ou refuser`,
                    requestId: String(requestId),
                    code: String(code),
                    categoryId: 'approval_request',
                    channelId: 'approval_mixkit_v1',
                    sound: 'mixkit_correct_answer_tone_2870',
                  },
                  android: {
                    priority: 'high',
                    notification: {
                      channelId: 'approval_mixkit_v1',
                      sound: 'mixkit_correct_answer_tone_2870',
                    },
                  },
                  apns: {
                    payload: {
                      aps: {
                        category: 'approval_request',
                        sound: 'mixkit_correct_answer_tone_2870.wav',
                        'content-available': 1,
                        alert: {
                          title: 'Nouvelle demande de connexion',
                          body: `Code: ${code} — Approuver ou refuser`,
                        },
                      },
                    },
                    headers: { 'apns-priority': '10' },
                  },
                })
                console.log('[push] FCM sent successfully, messageId:', result)
              } catch (sendErr) {
                console.error(
                  '[push] FCM send error for token',
                  deviceToken.slice(0, 20) + '...',
                  sendErr?.message || sendErr
                )
                if (
                  sendErr?.code === 'messaging/invalid-registration-token' ||
                  sendErr?.code === 'messaging/registration-token-not-registered' ||
                  // Happens when token belongs to another Firebase project (SenderId mismatch)
                  sendErr?.code === 'messaging/mismatched-credential' ||
                  sendErr?.code === 'messaging/sender-id-mismatch'
                ) {
                  await pool.query(
                    'DELETE FROM push_tokens WHERE user_identifiant = $1 AND (fcm_token = $2 OR expo_push_token = $2)',
                    [ident, deviceToken]
                  )
                  console.log('[push] removed stale token for', ident)
                }
              }
            }
          }
        } catch (err) {
       
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
    const trimmedFcm = typeof fcmToken === 'string' ? fcmToken.trim() : ''
    const trimmedExpo = typeof expoPushToken === 'string' ? expoPushToken.trim() : ''
    const tokenKey = trimmedExpo || trimmedFcm
    const fcmValue = trimmedFcm && !isExpoPushToken(trimmedFcm) ? trimmedFcm : null
    if (!tokenKey) {
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
      [identifiant, tokenKey, fcmValue]
    )
    // eslint-disable-next-line no-console
    console.log(
      '[push] token registered for',
      identifiant,
      'token:',
      tokenKey.slice(0, 30) + '...',
      isExpoPushToken(tokenKey) ? '(Expo)' : fcmValue ? '(FCM)' : '(Unknown)'
    )
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
      `SELECT u.id, u.name, u.prenoms, u.identifiant, u.role, u.direction_id, u.must_change_password, u.is_direction_chief, u.is_suspended, d.name AS direction_name
       FROM users u
       LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(500).json({ error: 'Utilisateur introuvable.' })
    }
    const user = userRes.rows[0]
    const permissions = user.is_suspended ? null : await getPermissionsForIdentifiant(identifiant)
    const sessionPayload = {
      name: user.name || '',
      prenoms: user.prenoms || '',
      identifiant: user.identifiant,
      role: user.role,
      direction_id: user.direction_id || null,
      direction_name: user.direction_name || null,
      is_direction_chief: Boolean(user.is_direction_chief),
      is_suspended: Boolean(user.is_suspended),
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
// Query params: direction_id, action, actor_identifiant (numéro), actor_name (recherche nom/prénom), limit, offset
app.get('/api/activity-log', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const {
      direction_id: filterDirectionId,
      action: filterAction,
      actor_identifiant: filterActorIdentifiant,
      actor_name: filterActorName,
      limit = 100,
      offset = 0,
    } = req.query || {}

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

    const limitNum = Math.min(parseInt(limit, 10) || 100, 500)
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0)
    const { sql, params } = buildActivityLogQuery(user, {
      direction_id: filterDirectionId,
      action: filterAction,
      actor_identifiant: filterActorIdentifiant,
      actor_name: filterActorName,
    }, limitNum, offsetNum)

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor_identifiant: row.actor_identifiant,
        actor_name: row.actor_name || '',
        actor_prenoms: row.actor_prenoms || '',
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

// ---------- Mobile "Fil d'actualité" ----------
// A lightweight feed for the mobile app (all authenticated users can access it).
// Returns recent platform events (folders/files/users/directions) without requiring can_view_activity_log.
app.get('/api/feed', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const { limit = 50, offset = 0 } = req.query || {}
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200)
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0)

    const userRes = await pool.query(
      'SELECT role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur introuvable.' })
    }
    // We only need to confirm the user exists; the feed is global.
    // (Direction-only folder visibility is enforced on folder/file endpoints, not on the activity feed.)
    // const user = userRes.rows[0]

    // Show a curated subset of actions (most relevant for notifications)
    const actions = [
      'create_folder',
      'rename_folder',
      'move_folder',
      'delete_folder',
      'delete_folder_tree',
      'upload_file',
      'delete_file',
      'create_link',
      'delete_link',
      'direction_access_granted',
      'folder_access_granted',
      'profile_updated',
      'user_suspended',
      'user_restored',
    ]

    const params = [actions]
    let sql = `
      SELECT a.id, a.action, a.actor_identifiant, a.direction_id, a.entity_type, a.entity_id, a.details, a.created_at,
             d.name AS direction_name,
             u.name AS actor_name, u.prenoms AS actor_prenoms
      FROM activity_log a
      LEFT JOIN directions d ON d.id = a.direction_id
      LEFT JOIN users u ON a.actor_identifiant = u.identifiant
      WHERE a.action = ANY($1)
    `

    // Feed is global: any authenticated user can see all recent platform events across directions.

    sql += ` ORDER BY a.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor_identifiant: row.actor_identifiant,
        actor_name: row.actor_name || '',
        actor_prenoms: row.actor_prenoms || '',
        direction_id: row.direction_id,
        direction_name: row.direction_name,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        details: row.details,
        created_at: row.created_at,
      }))
    )
  } catch (err) {
    console.error('feed list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération du fil d’actualité.' })
  }
})

// Helper: build activity log query and params (shared between list and export)
function buildActivityLogQuery(user, filters, limit = 10000, offset = 0) {
  const {
    direction_id: filterDirectionId,
    action: filterAction,
    actor_identifiant: filterActorIdentifiant,
    actor_name: filterActorName,
  } = filters || {}
  const params = []
  let sql = `
    SELECT a.id, a.action, a.actor_identifiant, a.direction_id, a.entity_type, a.entity_id, a.details, a.created_at,
           d.name AS direction_name,
           u.name AS actor_name, u.prenoms AS actor_prenoms
    FROM activity_log a
    LEFT JOIN directions d ON d.id = a.direction_id
    LEFT JOIN users u ON a.actor_identifiant = u.identifiant
    WHERE 1=1
  `
  if (user.role !== 'admin') {
    params.push(user.direction_id)
    sql += ` AND a.direction_id = $${params.length}`
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
  if (filterActorIdentifiant && String(filterActorIdentifiant).trim()) {
    params.push(`%${String(filterActorIdentifiant).trim()}%`)
    sql += ` AND (a.actor_identifiant ILIKE $${params.length})`
  }
  if (filterActorName && String(filterActorName).trim()) {
    const namePattern = `%${String(filterActorName).trim()}%`
    params.push(namePattern, namePattern)
    sql += ` AND (u.name ILIKE $${params.length - 1} OR u.prenoms ILIKE $${params.length})`
  }
  sql += ` ORDER BY a.created_at DESC LIMIT ${Math.min(parseInt(limit, 10) || 10000, 10000)} OFFSET ${Math.max(0, parseInt(offset, 10) || 0)}`
  return { sql, params }
}

// Export activity log (Excel, Word, PDF) — same filters as GET /api/activity-log
app.get('/api/activity-log/export', requireAuth, async (req, res) => {
  try {
    const identifiant = req.authIdentifiant
    const {
      direction_id: filterDirectionId,
      action: filterAction,
      actor_identifiant: filterActorIdentifiant,
      actor_name: filterActorName,
      format = 'xlsx',
    } = req.query || {}

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

    const { sql, params } = buildActivityLogQuery(user, {
      direction_id: filterDirectionId,
      action: filterAction,
      actor_identifiant: filterActorIdentifiant,
      actor_name: filterActorName,
    }, 10000, 0)
    const result = await pool.query(sql, params)
    const rows = result.rows.map((r) => ({
      Date: r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '',
      Action: r.action,
      'N° utilisateur': r.actor_identifiant || '',
      Nom: r.actor_name || '',
      Prénoms: r.actor_prenoms || '',
      Direction: r.direction_name || '',
      'Type entité': r.entity_type || '',
      Détails: r.details ? JSON.stringify(r.details) : '',
    }))

    const safeFormat = String(format).toLowerCase()
    const filenameBase = `journal-activite-${new Date().toISOString().slice(0, 10)}`

    if (safeFormat === 'xlsx' || safeFormat === 'excel') {
      const XLSX = require('xlsx')
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, 'Journal')
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`)
      return res.send(buf)
    }

    if (safeFormat === 'docx' || safeFormat === 'word') {
      const docx = require('docx')
      const { Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle } = docx
      const headers = ['Date', 'Action', 'N° utilisateur', 'Nom', 'Prénoms', 'Direction', 'Type entité', 'Détails']
      const tableRows = [
        new TableRow({
          children: (rows[0] ? Object.keys(rows[0]) : headers).map(
            (h) => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
              width: { size: 15, type: WidthType.DXA },
            })
          ),
        }),
        ...rows.map((row) => new TableRow({
          children: Object.values(row).map(
            (v) => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: String(v == null ? '' : v) })] })],
              width: { size: 15, type: WidthType.DXA },
            })
          ),
        })),
      ]
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({ children: [new TextRun({ text: 'Journal d’activité', bold: true, size: 28 })] }),
            new Paragraph({ text: '' }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { top: BorderStyle.SINGLE, bottom: BorderStyle.SINGLE, left: BorderStyle.SINGLE, right: BorderStyle.SINGLE },
              rows: tableRows,
            }),
          ],
        }],
      })
      const buf = await Packer.toBuffer(doc)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.docx"`)
      return res.send(buf)
    }

    if (safeFormat === 'pdf') {
      const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
      const pdfDoc = await PDFDocument.create()
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      let currentPage = pdfDoc.addPage([842, 595]) // A4 landscape
      const fontSize = 8
      const lineHeight = 12
      const margin = 40
      let y = currentPage.getHeight() - margin
      const colWidths = [70, 90, 70, 60, 60, 70, 50, 120]
      const headers = ['Date', 'Action', 'N° utilisateur', 'Nom', 'Prénoms', 'Direction', 'Type', 'Détails']
      const drawRow = (page, row) => {
        if (y < margin + lineHeight) {
          currentPage = pdfDoc.addPage([842, 595])
          y = currentPage.getHeight() - margin
          return drawRow(currentPage, row)
        }
        let x = margin
        const values = row instanceof Array ? row : headers.map((h) => row[h] ?? '')
        values.forEach((val, i) => {
          const w = colWidths[i] || 80
          page.drawText(String(val).slice(0, 40), { x, y, size: fontSize, font, color: rgb(0, 0, 0) })
          x += w
        })
        y -= lineHeight
        return currentPage
      }
      currentPage.drawText('Journal d’activité', { x: margin, y, size: 14, font, color: rgb(0, 0, 0) })
      y -= 20
      currentPage = drawRow(currentPage, headers)
      for (const r of rows) {
        currentPage = drawRow(currentPage, r)
      }
      const buf = await pdfDoc.save()
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`)
      return res.send(Buffer.from(buf))
    }

    return res.status(400).json({ error: 'Format non supporté. Utilisez format=xlsx, docx ou pdf.' })
  } catch (err) {
    console.error('activity-log export error', err)
    return res.status(500).json({ error: 'Erreur lors de l’export du journal d’activité.' })
  }
})

// ---------- Roles & permissions (RBAC) ----------

// Helper: get permissions for a user by identifiant (admin => all true)
function isAdminRole(role) {
  return typeof role === 'string' && role.toLowerCase() === 'admin'
}

async function getPermissionsForIdentifiant(identifiant) {
  const userRes = await pool.query(
    'SELECT role, is_direction_chief FROM users WHERE identifiant = $1',
    [identifiant]
  )
  if (userRes.rows.length === 0) return null
  const roleName = userRes.rows[0].role
  const isChief = Boolean(userRes.rows[0].is_direction_chief)
  if (isAdminRole(roleName)) {
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

// Helper: check if a user has access to create folders/upload files in a specific direction
async function hasDirectionAccess(userId, directionId) {
  // Admin always has access
  const userRes = await pool.query('SELECT role FROM users WHERE id = $1', [userId])
  if (userRes.rows.length > 0 && isAdminRole(userRes.rows[0].role)) {
    return true
  }
  
  // Check if user's own direction matches
  const userDirRes = await pool.query('SELECT direction_id FROM users WHERE id = $1', [userId])
  if (userDirRes.rows.length > 0 && userDirRes.rows[0].direction_id === directionId) {
    return true
  }
  
  // Check if user has been granted access to this direction
  const grantRes = await pool.query(
    'SELECT id FROM direction_access_grants WHERE user_id = $1 AND granted_direction_id = $2',
    [userId, directionId]
  )
  return grantRes.rows.length > 0
}

// Helper: check if a user can grant access (admin or direction chief of the target direction)
async function canGrantDirectionAccess(granterIdentifiant, targetDirectionId) {
  const granterRes = await pool.query(
    'SELECT role, direction_id, is_direction_chief FROM users WHERE identifiant = $1',
    [granterIdentifiant]
  )
  if (granterRes.rows.length === 0) return false

  const granter = granterRes.rows[0]

  // Admin can grant access to any direction
  if (granter.role === 'admin') return true

  // Direction chief can grant access to their own direction
  if (granter.is_direction_chief && granter.direction_id === targetDirectionId) return true

  return false
}

/**
 * Get list of user identifiants to notify when something happens in a direction
 * (members of the direction + users with direction_access_grants for that direction).
 * Optionally exclude one identifiant (e.g. the uploader).
 */
async function getIdentifiantsToNotifyForDirection(directionId, excludeIdentifiant = null) {
  const members = await pool.query(
    'SELECT identifiant FROM users WHERE direction_id = $1 AND is_suspended = false',
    [directionId]
  )
  const granted = await pool.query(
    `SELECT u.identifiant FROM direction_access_grants g
     JOIN users u ON u.id = g.user_id
     WHERE g.granted_direction_id = $1 AND u.is_suspended = false`,
    [directionId]
  )
  const set = new Set([
    ...members.rows.map((r) => r.identifiant),
    ...granted.rows.map((r) => r.identifiant),
  ])
  if (excludeIdentifiant) set.delete(excludeIdentifiant)
  return [...set]
}

/**
 * Get list of user identifiants to notify for a folder (direction members + folder_access_grants).
 */
async function getIdentifiantsToNotifyForFolder(folderId, excludeIdentifiant = null) {
  const folderRes = await pool.query('SELECT direction_id FROM folders WHERE id = $1', [folderId])
  if (folderRes.rows.length === 0) return []
  const directionId = folderRes.rows[0].direction_id
  const directionIdentifiants = await getIdentifiantsToNotifyForDirection(directionId, excludeIdentifiant)
  const folderGrants = await pool.query(
    `SELECT u.identifiant FROM folder_access_grants g
     JOIN users u ON u.id = g.user_id
     WHERE g.folder_id = $1 AND u.is_suspended = false`,
    [folderId]
  )
  const set = new Set([...directionIdentifiants, ...folderGrants.rows.map((r) => r.identifiant)])
  if (excludeIdentifiant) set.delete(excludeIdentifiant)
  return [...set]
}

/**
 * Get list of ALL active user identifiants (optionally excluding one).
 * Used when we want to notify the whole platform (not direction-scoped).
 */
async function getIdentifiantsToNotifyAll(excludeIdentifiant = null) {
  const all = await pool.query('SELECT identifiant FROM users WHERE is_suspended = false')
  const set = new Set(all.rows.map((r) => r.identifiant).filter(Boolean))
  if (excludeIdentifiant) set.delete(excludeIdentifiant)
  return [...set]
}

/**
 * Send FCM push notification to a list of user identifiants (fire-and-forget).
 * data can include categoryId, channelId for mobile handling.
 */
async function sendPushToIdentifiants(identifiants, title, body, data = {}) {
  if (identifiants.length === 0) return
  const normalizedData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
  const androidSound = typeof data?.sound === 'string' && data.sound.trim() ? data.sound.trim() : null
  const apnsSound =
    typeof data?.apnsSound === 'string' && data.apnsSound.trim()
      ? data.apnsSound.trim()
      : (androidSound ? `${androidSound}.wav` : 'default')
  const tokenRows = await pool.query(
    'SELECT user_identifiant, expo_push_token, fcm_token FROM push_tokens WHERE user_identifiant = ANY($1)',
    [identifiants]
  )
  if (tokenRows.rows.length === 0) return
  try {
    const expoTokens = []
    const fcmTokens = []
    for (const row of tokenRows.rows) {
      const expo = typeof row.expo_push_token === 'string' ? row.expo_push_token.trim() : ''
      const fcm = typeof row.fcm_token === 'string' ? row.fcm_token.trim() : ''
      if (isExpoPushToken(expo)) expoTokens.push(expo)
      else if (isLikelyFcmToken(fcm)) fcmTokens.push(fcm)
      else if (isLikelyFcmToken(expo)) fcmTokens.push(expo)
    }

    if (expoTokens.length > 0) {
      await sendExpoPushNotifications(expoTokens, {
        title: String(title),
        body: String(body),
        channelId: data?.channelId,
        sound: data?.sound,
        data: normalizedData,
      })
    }

    const messaging = fcmTokens.length > 0 ? getMessaging() : null
    if (fcmTokens.length > 0 && !messaging) {
      console.warn('[push] Firebase messaging unavailable; skipping FCM sends (Expo sends may still work).')
      return
    }

    for (const deviceToken of fcmTokens) {
      try {
        await messaging.send({
          token: deviceToken,
          notification: {
            title: String(title),
            body: String(body),
          },
          data: {
            title: String(title),
            body: String(body),
            ...normalizedData,
          },
          android: {
            priority: 'high',
            notification: {
              channelId: typeof data?.channelId === 'string' ? data.channelId : undefined,
              sound: androidSound || undefined,
            },
          },
          apns: {
            payload: {
              aps: {
                sound: apnsSound,
                'content-available': 1,
                alert: { title: String(title), body: String(body) },
              },
            },
            headers: { 'apns-priority': '10' },
          },
        })
      } catch (sendErr) {
        if (
          sendErr.code === 'messaging/invalid-registration-token' ||
          sendErr.code === 'messaging/registration-token-not-registered'
        ) {
          await pool.query(
            'DELETE FROM push_tokens WHERE user_identifiant = $1 AND (fcm_token = $2 OR expo_push_token = $2)',
            [tokenRows.rows.find((r) => r.fcm_token === deviceToken || r.expo_push_token === deviceToken)?.user_identifiant, deviceToken]
          ).catch(() => {})
        }
      }
    }
  } catch (err) {
    console.error('[push] sendPushToIdentifiants error', err)
  }
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

// Delete a role (cannot delete 'admin'; users with this role are reassigned to default 'user' profile)
app.delete('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params
    const callerIdentifiant = req.query.identifiant || req.body?.identifiant

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

    // Find a fallback role: prefer 'user', otherwise first non-admin role
    const fallbackRes = await pool.query(
      "SELECT name FROM roles WHERE name <> 'admin' AND id <> $1 ORDER BY CASE WHEN name = 'user' THEN 0 ELSE 1 END LIMIT 1",
      [id]
    )
    const fallbackRole = fallbackRes.rows.length > 0 ? fallbackRes.rows[0].name : 'user'

    // Reassign users to fallback role instead of deleting them
    const updateRes = await pool.query(
      'UPDATE users SET role = $1 WHERE role = $2 RETURNING id',
      [fallbackRole, roleName]
    )
    const reassignedCount = updateRes.rowCount || 0

    // Notify affected users to refresh their session (permissions may have changed)
    for (const row of updateRes.rows) {
      broadcastDataChange('users', 'updated', { id: row.id })
    }

    // Delete the role (cascades to role_permissions and folder_role_visibility)
    await pool.query('DELETE FROM roles WHERE id = $1', [id])

    broadcastDataChange('roles', 'deleted', { id })
    return res.json({ ok: true, reassignedUsers: reassignedCount })
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
  const tmpPath = req.file?.path
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    if (!tmpPath || !fs.existsSync(tmpPath)) {
      return res.status(400).json({ error: 'Fichier invalide ou trop volumineux.' })
    }

    const folder = (req.body && req.body.folder) || 'default'
    const directionId = (req.body && req.body.direction_id) || null
    const identifiant = (req.body && req.body.identifiant) || null

    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise pour l’upload.' })
    }

    if (!identifiant) {
      return res.status(401).json({ error: 'Authentification requise pour l\'upload de fichiers.' })
    }

    const userRes = await pool.query(
      'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    }

    const u = userRes.rows[0]
    const uploadedBy = u.id

    // Check if user has access to upload to this direction
    const hasAccess = await hasDirectionAccess(uploadedBy, directionId)
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Vous ne pouvez déposer des fichiers que dans votre direction ou dans les directions pour lesquelles vous avez reçu un accès.',
      })
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

    let resourceType = 'raw'
    if (mimeType.startsWith('image/')) resourceType = 'image'
    else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) resourceType = 'video'

    const fileSize = Number(req.file.size) || 0
    const isApkUpload = storedFileName.toLowerCase().endsWith('.apk')
    if (isApkUpload && resourceType === 'raw' && fileSize > 20 * 1024 * 1024) {
      // Upload large APKs as "video" to bypass common RAW plan limits (~20MB).
      resourceType = 'video'
    }

    const cloudinaryLimit = resourceType === 'video'
      ? 2000 * 1024 * 1024
      : 20 * 1024 * 1024
    const useCloudinary = fileSize <= cloudinaryLimit

    let cloudinaryUrl = null
    let cloudinaryPublicId = null

    if (useCloudinary) {
      const cloudinaryOpts = {
        folder: `intranet/${directionCode}/${folder}`,
        public_id: id,
        resource_type: resourceType,
      }
      const cloudinaryResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          cloudinaryOpts,
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          }
        )
        fs.createReadStream(tmpPath).on('error', reject).pipe(uploadStream)
      })
      cloudinaryUrl = cloudinaryResult.secure_url
      cloudinaryPublicId = cloudinaryResult.public_id
    }

    let dataForDb = null
    if (!useCloudinary) {
      dataForDb = fs.readFileSync(tmpPath)
    }

    // Extract APK icon if this is an APK file
    let iconUrl = null
    if (storedFileName.toLowerCase().endsWith('.apk')) {
      // Large APKs can cause high memory/CPU usage during ZIP parsing and may crash small hosts.
      // Skip icon extraction for large APKs; the upload should still succeed.
      const APK_ICON_MAX_BYTES = 25 * 1024 * 1024 // 25 MB
      if (fileSize <= APK_ICON_MAX_BYTES) {
        try {
          const apkBufForIcon = dataForDb || fs.readFileSync(tmpPath)
          const iconBuffer = extractApkIcon(apkBufForIcon)
          if (iconBuffer) {
            const cloudinaryFolder = `intranet/${directionCode}/${folder}`
            iconUrl = await uploadApkIconToCloudinary(iconBuffer, cloudinaryFolder, id)
          }
        } catch (err) {
          console.error('[apk-icon] Skipping icon extraction (error):', err?.message || err)
        }
      }
    }

    // Store in DB — large files go in the `data` bytea column, small files use Cloudinary URL
    await pool.query(
      `INSERT INTO files (id, name, mime_type, size, folder, direction_id, uploaded_by, cloudinary_url, cloudinary_public_id, data, icon_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        storedFileName,
        mimeType,
        fileSize,
        folder,
        directionId,
        uploadedBy,
        cloudinaryUrl,
        cloudinaryPublicId,
        useCloudinary ? null : dataForDb,
        iconUrl,
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
      details: { name: storedFileName, folder, size: fileSize },
    })

    broadcastDataChange('files', 'created', { id, directionId, folder })

    // Notifier les membres de la direction et les utilisateurs avec accès au dossier (app mobile)
    const folderRow = await pool.query(
      'SELECT id FROM folders WHERE direction_id = $1 AND name = $2 LIMIT 1',
      [directionId, folder]
    )
    const folderIdForNotify = folderRow.rows[0]?.id
    const toNotify = folderIdForNotify
      ? await getIdentifiantsToNotifyForFolder(folderIdForNotify, identifiant)
      : await getIdentifiantsToNotifyForDirection(directionId, identifiant)
    if (toNotify.length > 0) {
      const uploaderRow = await pool.query(
        'SELECT name, prenoms FROM users WHERE identifiant = $1 LIMIT 1',
        [identifiant]
      )
      const uploaderName = uploaderRow.rows[0]
        ? [uploaderRow.rows[0].name, uploaderRow.rows[0].prenoms].filter(Boolean).join(' ').trim() || identifiant
        : identifiant
      const bodyText = `${storedFileName} — déposé par ${uploaderName}`
      sendPushToIdentifiants(
        toNotify,
        'Nouveau document',
        bodyText,
        {
          type: 'document_uploaded',
          fileId: id,
          fileName: storedFileName,
          uploaderName,
          directionId,
          folder,
          channelId: 'approval_mixkit_v1',
          sound: 'mixkit_correct_answer_tone_2870',
          apnsSound: 'mixkit_correct_answer_tone_2870.wav',
        }
      ).catch((err) => console.error('[push] upload_file notify', err))
    }

    return res.json({
      id,
      name: storedFileName,
      size: fileSize,
      url: publicUrl,
      view_url: `${BASE_URL}/files/${encodeURIComponent(id)}`,
      direction_id: directionId,
      icon_url: iconUrl || undefined,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("file upload error", err?.message || err, err?.code, err?.stack)
    const detail = err?.message || "Unknown error"
    return res.status(500).json({ error: "Erreur lors de l'upload: " + detail })
  } finally {
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath)
      } catch (_) {
        /* ignore */
      }
    }
  }
})

// ---------- Direct-to-Cloudinary upload (sign + register) ----------

/**
 * POST /api/files/sign
 * Returns a Cloudinary upload signature so the client can upload directly to Cloudinary.
 * If the file exceeds Cloudinary limits for its resource type, returns { use_direct: false }
 * so the client falls back to the multipart POST /api/files endpoint.
 * Body: { folder, direction_id, identifiant, mime_type, size }
 */
app.post('/api/files/sign', async (req, res) => {
  try {
    const { folder, direction_id: directionId, identifiant, mime_type: mimeType, size, file_name: fileName } = req.body || {}

    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise pour l\'upload.' })
    }

    if (!identifiant) {
      return res.status(401).json({ error: 'Authentification requise pour l\'upload de fichiers.' })
    }

    const userRes = await pool.query(
      'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    }

    const u = userRes.rows[0]
    const uploadedBy = u.id

    // Check if user has access to upload to this direction
    const hasAccess = await hasDirectionAccess(uploadedBy, directionId)
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Vous ne pouvez déposer des fichiers que dans votre direction ou dans les directions pour lesquelles vous avez reçu un accès.',
      })
    }

    const dirRes = await pool.query(
      'SELECT id, code FROM directions WHERE id = $1',
      [directionId]
    )
    if (dirRes.rows.length === 0) {
      return res.status(400).json({ error: 'Direction invalide.' })
    }
    const directionCode = (dirRes.rows[0].code || 'DEF').toString().toUpperCase()


    const mime = (mimeType || '').toLowerCase()
    let resourceType = 'raw'
    if (mime.startsWith('image/')) resourceType = 'image'
    else if (mime.startsWith('video/') || mime.startsWith('audio/')) resourceType = 'video'

    
    const isApkMime =
      mime === 'application/vnd.android.package-archive' ||
      mime === 'application/android-package-archive'
    const isApkByName =
      typeof fileName === 'string' && fileName.trim().toLowerCase().endsWith('.apk')
    const fileSize = Number(size) || 0
    if ((isApkMime || isApkByName) && fileSize > 20 * 1024 * 1024) {
      resourceType = 'video'
    }

    const cloudinaryLimit = resourceType === 'video'
      ? 2000 * 1024 * 1024
      : 20 * 1024 * 1024

    if (fileSize > cloudinaryLimit) {
   
      return res.json({ use_direct: false, direction_code: directionCode })
    }

    const id = uuidv4()
    const cloudinaryFolder = `intranet/${directionCode}/${folder || 'default'}`
    const timestamp = Math.round(Date.now() / 1000)

    const paramsToSign = {
      timestamp,
      folder: cloudinaryFolder,
      public_id: id,
    }
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    )

    return res.json({
      use_direct: true,
      id,
      signature,
      timestamp,
      api_key: process.env.CLOUDINARY_API_KEY,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      folder: cloudinaryFolder,
      direction_code: directionCode,
      resource_type: resourceType,
    })
  } catch (err) {
    console.error('file sign error', err?.message || err)
    return res.status(500).json({ error: 'Erreur lors de la signature.' })
  }
})


app.post('/api/files/register', async (req, res) => {
  try {
    const {
      id,
      name,
      mime_type: mimeType,
      size,
      folder,
      direction_id: directionId,
      identifiant,
      cloudinary_url: cloudinaryUrl,
      cloudinary_public_id: cloudinaryPublicId,
      direction_code: directionCode,
    } = req.body || {}

    if (!id || !name || !directionId || !cloudinaryUrl) {
      return res.status(400).json({ error: 'Paramètres manquants.' })
    }

    if (!identifiant) {
      return res.status(401).json({ error: 'Authentification requise pour l\'enregistrement de fichiers.' })
    }

    const userRes = await pool.query(
      'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    }

    const u = userRes.rows[0]
    const uploadedBy = u.id

 
    const hasAccess = await hasDirectionAccess(uploadedBy, directionId)
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Vous ne pouvez déposer des fichiers que dans votre direction ou dans les directions pour lesquelles vous avez reçu un accès.',
      })
    }

    const code = (directionCode || 'DEF').toString().toUpperCase()

 
    let baseName = (name || 'document').replace(/^.*[/\\]/, '').trim() || 'document'
    if (baseName.toUpperCase().startsWith(code + '_')) {
      baseName = baseName.slice(code.length + 1)
    }
    const storedFileName = code + '_' + baseName

    const folderName = folder || 'default'
    const folderId = uuidv4()

    await pool.query(
      `INSERT INTO folders (id, name, direction_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (direction_id, name) DO NOTHING`,
      [folderId, folderName, directionId]
    )

    // Extract APK icon if this is an APK file (download from Cloudinary first)
    let iconUrl = null
    if (storedFileName.toLowerCase().endsWith('.apk') && cloudinaryUrl) {
      try {
        const apkBuffer = await downloadFileBuffer(cloudinaryUrl)
        const iconBuffer = extractApkIcon(apkBuffer)
        if (iconBuffer) {
          const cloudinaryFolder = `intranet/${code}/${folderName}`
          iconUrl = await uploadApkIconToCloudinary(iconBuffer, cloudinaryFolder, id)
        }
      } catch (dlErr) {
        console.error('[apk-icon] Could not download APK for icon extraction:', dlErr?.message)
      }
    }

    await pool.query(
      `INSERT INTO files (id, name, mime_type, size, folder, direction_id, uploaded_by, cloudinary_url, cloudinary_public_id, data, icon_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10)`,
      [
        id,
        storedFileName,
        mimeType || 'application/octet-stream',
        Number(size) || 0,
        folderName,
        directionId,
        uploadedBy,
        cloudinaryUrl,
        cloudinaryPublicId || null,
        iconUrl,
      ]
    )

    const publicUrl = cloudinaryUrl

    await insertActivityLog(pool, {
      action: 'upload_file',
      actorIdentifiant: identifiant || null,
      actorId: uploadedBy,
      directionId,
      entityType: 'file',
      entityId: id,
      details: { name: storedFileName, folder: folderName, size: Number(size) || 0 },
    })

    broadcastDataChange('files', 'created', { id, directionId, folder: folderName })

    // Notifier les membres de la direction et les utilisateurs avec accès au dossier (app mobile)
    const folderRow = await pool.query(
      'SELECT id FROM folders WHERE direction_id = $1 AND name = $2 LIMIT 1',
      [directionId, folderName]
    )
    const folderIdForNotify = folderRow.rows[0]?.id
    const toNotify = folderIdForNotify
      ? await getIdentifiantsToNotifyForFolder(folderIdForNotify, identifiant)
      : await getIdentifiantsToNotifyForDirection(directionId, identifiant)
    if (toNotify.length > 0) {
      const dirRow = await pool.query('SELECT name FROM directions WHERE id = $1 LIMIT 1', [directionId])
      const directionName = (dirRow.rows[0]?.name || '').toString().trim() || 'Direction'
      const uploaderRow = await pool.query(
        'SELECT name, prenoms FROM users WHERE identifiant = $1 LIMIT 1',
        [identifiant]
      )
      const uploaderName = uploaderRow.rows[0]
        ? [uploaderRow.rows[0].name, uploaderRow.rows[0].prenoms].filter(Boolean).join(' ').trim() || identifiant
        : identifiant
      const bodyText = `${directionName} a ajouté un fichier "${storedFileName}"`
      sendPushToIdentifiants(
        toNotify,
        'Nouveau fichier',
        bodyText,
        {
          type: 'document_uploaded',
          fileId: id,
          fileName: storedFileName,
          uploaderName,
          directionId,
          direction_name: directionName,
          folder: folderName,
          channelId: 'approval_mixkit_v1',
          sound: 'mixkit_correct_answer_tone_2870',
          apnsSound: 'mixkit_correct_answer_tone_2870.wav',
        }
      ).catch((err) => console.error('[push] file register notify', err))
    }

    return res.json({
      id,
      name: storedFileName,
      size: Number(size) || 0,
      url: publicUrl,
      view_url: `${BASE_URL}/files/${encodeURIComponent(id)}`,
      direction_id: directionId,
      icon_url: iconUrl || undefined,
    })
  } catch (err) {
    console.error('file register error', err?.message || err, err?.stack)
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement du fichier.' })
  }
})

// Explicit folders / groups (each folder belongs to a direction)
// Query params: role, direction_id (user's direction), identifiant (pour inclure dossiers avec accès accordé)
app.get('/api/folders', async (_req, res) => {
  try {
    const { role, direction_id: userDirectionIdRaw, identifiant } = _req.query
    let userDirectionId = userDirectionIdRaw

    let sql = `
      SELECT DISTINCT f.id, f.name, f.direction_id, f.created_at, f.visibility, d.name AS direction_name
      FROM folders f
      JOIN directions d ON d.id = f.direction_id
    `
    const params = []
    const conditions = ['f.deleted_at IS NULL']

    // Si identifiant fourni, inclure aussi les dossiers pour lesquels l'utilisateur a un accès explicite (folder_access_grants)
    let userIdForGrants = null
    let accessibleDirectionIds = []
    if (identifiant) {
      const u = await pool.query('SELECT id, direction_id FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) {
        userIdForGrants = u.rows[0].id
        // Fallback: if direction_id is missing from query, use the user's DB direction.
        if (!userDirectionId && u.rows[0].direction_id) {
          userDirectionId = u.rows[0].direction_id
        }
        // Directions accessibles: direction propre + accès accordés via direction_access_grants
        if (userDirectionId) accessibleDirectionIds.push(userDirectionId)
        try {
          const grants = await pool.query(
            'SELECT granted_direction_id FROM direction_access_grants WHERE user_id = $1',
            [userIdForGrants]
          )
          for (const row of grants.rows) {
            if (row.granted_direction_id && !accessibleDirectionIds.includes(row.granted_direction_id)) {
              accessibleDirectionIds.push(row.granted_direction_id)
            }
          }
        } catch (_) {
          // ignore
        }
      }
    }

    if (role && role !== 'admin') {
      // Role-based folder visibility (existing feature)
      params.push(role)
      // Default-allow model:
      // only hide a folder when the current role has an explicit deny (can_view = false).
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM folder_role_visibility v
          JOIN roles r ON r.id = v.role_id
          WHERE v.folder_name = f.name
            AND r.name = $${params.length}
            AND v.can_view = false
        )
      `)

      // Direction-only: visible si public, ou si user dans la direction, ou si accès accordé via folder_access_grants
      if (userIdForGrants) {
        // If we know the user, allow:
        // - public folders
        // - direction_only folders for any accessible direction (own + direction_access_grants)
        // - folders explicitly granted via folder_access_grants
        const dirs = accessibleDirectionIds.length > 0 ? accessibleDirectionIds : (userDirectionId ? [userDirectionId] : [])
        if (dirs.length > 0) {
          params.push(dirs)
          params.push(userIdForGrants)
          conditions.push(`(
            f.visibility = 'public'
            OR (f.visibility = 'direction_only' AND f.direction_id = ANY($${params.length - 1}::uuid[]))
            OR EXISTS (SELECT 1 FROM folder_access_grants fag WHERE fag.folder_id = f.id AND fag.user_id = $${params.length})
          )`)
        } else {
          params.push(userIdForGrants)
          conditions.push(`(
            f.visibility = 'public'
            OR EXISTS (SELECT 1 FROM folder_access_grants fag WHERE fag.folder_id = f.id AND fag.user_id = $${params.length})
          )`)
        }
      } else if (userDirectionId) {
        // Legacy: identifiant not provided, rely on direction_id query param only
        params.push(userDirectionId)
        conditions.push(`(f.visibility = 'public' OR (f.visibility = 'direction_only' AND f.direction_id = $${params.length}))`)
      } else {
        // Utilisateur sans direction_id: public + dossiers avec accès accordé
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
        name: normalizeFolderPath(row.name),
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
    const name = normalizeFolderPath(folder)
    if (!name) {
      return res.status(400).json({ error: 'Nom de dossier requis.' })
    }
    if (!directionId) {
      return res.status(400).json({ error: 'Direction requise pour créer un dossier.' })
    }

    if (!identifiant) {
      return res.status(401).json({ error: 'Authentification requise pour créer un dossier.' })
    }

    const visibility = rawVisibility === 'direction_only' ? 'direction_only' : 'public'

    // Permission: admin can create in any direction; others only in their own/granted directions
    const userRes = await pool.query(
      'SELECT id, role, direction_id FROM users WHERE identifiant = $1',
      [identifiant]
    )
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    }

    const u = userRes.rows[0]
    const callerRole = u.role

    // Check if user has access to create folders in this direction
    const hasAccess = await hasDirectionAccess(u.id, directionId)
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Vous ne pouvez créer des dossiers que dans votre direction ou dans les directions pour lesquelles vous avez reçu un accès.',
      })
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

    // Avoid duplicates explicitly (do not silently "succeed")
    const existing = await pool.query(
      'SELECT id FROM folders WHERE direction_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1',
      [directionId, name]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà dans cette direction.' })
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
    // Notify all users on the platform (mobile app)
    getIdentifiantsToNotifyAll(identifiant || null)
      .then(async (idents) => {
        const dirRow = await pool.query('SELECT name FROM directions WHERE id = $1 LIMIT 1', [directionId])
        const directionName = (dirRow.rows[0]?.name || '').toString().trim() || 'Direction'
        const folderDisplay = name.includes('::') ? name.split('::').slice(-1)[0] : name
        return sendPushToIdentifiants(
          idents,
          'Nouveau dossier',
          `${directionName} a ajouté un dossier "${folderDisplay}"`,
          {
            type: 'folder_created',
            folder_name: name,
            folder_display_name: folderDisplay,
            direction_id: directionId,
            direction_name: directionName,
            channelId: 'approval_mixkit_v1',
            sound: 'mixkit_correct_answer_tone_2870',
            apnsSound: 'mixkit_correct_answer_tone_2870.wav',
          }
        )
      })
      .catch((err) => console.error('[push] folder_created', err))
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

// Rename a folder "path" (also renames subfolders + updates files/links folder fields)
// Body: { direction_id, old_name, new_name, identifiant }
app.patch('/api/folders/rename', async (req, res) => {
  try {
    const { direction_id: directionId, old_name: oldNameRaw, new_name: newNameRaw, identifiant } = req.body || {}
    const oldName = normalizeFolderPath(oldNameRaw)
    const newName = normalizeFolderPath(newNameRaw)
    if (!directionId) return res.status(400).json({ error: 'Direction requise.' })
    if (!identifiant) return res.status(401).json({ error: 'Authentification requise.' })
    if (!oldName || !newName) return res.status(400).json({ error: 'Ancien et nouveau nom requis.' })

    const userRes = await pool.query('SELECT id, role, direction_id FROM users WHERE identifiant = $1', [identifiant])
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    const user = userRes.rows[0]
    if (user.role !== 'admin' && user.direction_id !== directionId) {
      return res.status(403).json({ error: 'Vous ne pouvez renommer que les dossiers de votre direction.' })
    }

    // Prevent conflicts
    const conflict = await pool.query(
      'SELECT 1 FROM folders WHERE direction_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1',
      [directionId, newName]
    )
    if (conflict.rows.length > 0) return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà.' })

    // Rename subtree: folders + files + links (soft-deleted are ignored)
    const folderRows = await pool.query(
      `SELECT id, name FROM folders
       WHERE direction_id = $1 AND deleted_at IS NULL
         AND (name = $2 OR name LIKE $3)`,
      [directionId, oldName, `${oldName}::%`]
    )
    if (folderRows.rows.length === 0) return res.status(404).json({ error: 'Dossier introuvable.' })

    // Apply updates deterministically
    for (const row of folderRows.rows) {
      const current = row.name
      const next = current === oldName ? newName : newName + current.slice(oldName.length)
      await pool.query('UPDATE folders SET name = $1 WHERE id = $2', [next, row.id])
    }
    await pool.query(
      `UPDATE files SET folder = $1 || substring(folder from $2)
       WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5)`,
      [newName, oldName.length + 1, directionId, oldName, `${oldName}::%`]
    )
    await pool.query(
      `UPDATE links SET folder = $1 || substring(folder from $2)
       WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5)`,
      [newName, oldName.length + 1, directionId, oldName, `${oldName}::%`]
    )

    await insertActivityLog(pool, {
      action: 'rename_folder',
      actorIdentifiant: identifiant || null,
      actorId: user.id,
      directionId,
      entityType: 'folder',
      entityId: null,
      details: { oldName, newName },
    })
    broadcastDataChange('folders', 'updated', { directionId })
    broadcastDataChange('files', 'updated', { directionId })
    broadcastDataChange('links', 'updated', { directionId })
    return res.json({ ok: true })
  } catch (err) {
    console.error('folder rename error', err)
    return res.status(500).json({ error: 'Erreur lors du renommage du dossier.' })
  }
})

// Move a folder into another folder (same direction) by rewriting the path prefix.
// Body: { direction_id, source_name, target_name|null, identifiant }
app.post('/api/folders/move', async (req, res) => {
  try {
    const { direction_id: directionId, source_name: sourceRaw, target_name: targetRaw, identifiant } = req.body || {}
    const source = normalizeFolderPath(sourceRaw)
    const target = targetRaw === null || targetRaw === undefined ? null : normalizeFolderPath(targetRaw)
    if (!directionId) return res.status(400).json({ error: 'Direction requise.' })
    if (!isUuidLike(String(directionId))) return res.status(400).json({ error: 'Direction invalide.' })
    if (!identifiant) return res.status(401).json({ error: 'Authentification requise.' })
    if (!source) return res.status(400).json({ error: 'Dossier source requis.' })
    if (source.length > 512 || (target && target.length > 512)) {
      return res.status(400).json({ error: 'Nom de dossier trop long.' })
    }

    const userRes = await pool.query('SELECT id, role, direction_id FROM users WHERE identifiant = $1', [identifiant])
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    const user = userRes.rows[0]
    if (user.role !== 'admin' && user.direction_id !== directionId) {
      return res.status(403).json({ error: 'Vous ne pouvez déplacer que les dossiers de votre direction.' })
    }

    const baseName = source.includes('::') ? source.split('::').pop() : source
    const nextName = target ? `${target}::${baseName}` : baseName

    if (target && (target === source || target.startsWith(`${source}::`))) {
      return res.status(400).json({ error: 'Impossible de déplacer un dossier dans lui-même.' })
    }

    // If target is provided, ensure target exists (as a folder or as a group root)
    if (target) {
      const targetLike = `${escapeLikePattern(target)}::%`
      const targetExists = await pool.query(
        `SELECT 1 FROM folders WHERE direction_id = $1 AND deleted_at IS NULL
          AND (name = $2 OR name LIKE $3 ESCAPE '\\') LIMIT 1`,
        [directionId, target, targetLike]
      )
      if (targetExists.rows.length === 0) {
        // Also allow "virtual" folders that only exist via files/links prefixes.
        const targetLike2 = `${escapeLikePattern(target)}::%`
        const targetExistsViaContent = await pool.query(
          `
            SELECT 1
            FROM (
              SELECT 1 AS ok FROM files WHERE direction_id = $1 AND deleted_at IS NULL AND (folder = $2 OR folder LIKE $3 ESCAPE '\\') LIMIT 1
              UNION ALL
              SELECT 1 AS ok FROM links WHERE direction_id = $1 AND deleted_at IS NULL AND (folder = $2 OR folder LIKE $3 ESCAPE '\\') LIMIT 1
            ) t
            LIMIT 1
          `,
          [directionId, target, targetLike2]
        )
        if (targetExistsViaContent.rows.length === 0) return res.status(404).json({ error: 'Dossier cible introuvable.' })
      }
    }

    // Prevent conflicts at destination
    const conflict = await pool.query(
      'SELECT 1 FROM folders WHERE direction_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1',
      [directionId, nextName]
    )
    if (conflict.rows.length > 0) return res.status(409).json({ error: 'Un dossier avec ce nom existe déjà à cet emplacement.' })

    // Reuse rename logic by renaming prefix source -> nextName
    req.body = { direction_id: directionId, old_name: source, new_name: nextName, identifiant }
    // Call handler inline by duplicating minimal behavior (avoid refactor in this patch)
    const sourceLike = `${escapeLikePattern(source)}::%`
    const folderRows = await pool.query(
      `SELECT id, name FROM folders
       WHERE direction_id = $1 AND deleted_at IS NULL
         AND (name = $2 OR name LIKE $3 ESCAPE '\\')`,
      [directionId, source, sourceLike]
    )
    if (folderRows.rows.length === 0) {
      // Fallback: allow moving a "virtual" folder if it exists via files/links.
      const sourceExistsViaContent = await pool.query(
        `
          SELECT 1
          FROM (
            SELECT 1 AS ok FROM files WHERE direction_id = $1 AND deleted_at IS NULL AND (folder = $2 OR folder LIKE $3 ESCAPE '\\') LIMIT 1
            UNION ALL
            SELECT 1 AS ok FROM links WHERE direction_id = $1 AND deleted_at IS NULL AND (folder = $2 OR folder LIKE $3 ESCAPE '\\') LIMIT 1
          ) t
          LIMIT 1
        `,
        [directionId, source, sourceLike]
      )
      if (sourceExistsViaContent.rows.length === 0) return res.status(404).json({ error: 'Dossier source introuvable.' })

      // Prevent merge conflicts for virtual folders: do not move onto an existing subtree.
      const nextLike = `${escapeLikePattern(nextName)}::%`
      const conflictVirtual = await pool.query(
        `
          SELECT 1
          FROM (
            SELECT 1 AS ok FROM files WHERE direction_id = $1 AND deleted_at IS NULL AND (folder = $2 OR folder LIKE $3 ESCAPE '\\') LIMIT 1
            UNION ALL
            SELECT 1 AS ok FROM links WHERE direction_id = $1 AND deleted_at IS NULL AND (folder = $2 OR folder LIKE $3 ESCAPE '\\') LIMIT 1
          ) t
          LIMIT 1
        `,
        [directionId, nextName, nextLike]
      )
      if (conflictVirtual.rows.length > 0) {
        return res.status(409).json({ error: 'Conflit: le dossier de destination contient déjà des éléments.' })
      }

      await pool.query(
        `UPDATE files SET folder = $1 || substring(folder from $2)
         WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5 ESCAPE '\\')`,
        [nextName, source.length + 1, directionId, source, sourceLike]
      )
      await pool.query(
        `UPDATE links SET folder = $1 || substring(folder from $2)
         WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5 ESCAPE '\\')`,
        [nextName, source.length + 1, directionId, source, sourceLike]
      )

      await insertActivityLog(pool, {
        action: 'move_folder',
        actorIdentifiant: identifiant || null,
        actorId: user.id,
        directionId,
        entityType: 'folder',
        entityId: null,
        details: { source, target: target || null, newName: nextName, virtual: true },
      })
      broadcastDataChange('files', 'updated', { directionId })
      broadcastDataChange('links', 'updated', { directionId })
      return res.json({ ok: true, name: nextName })
    }

    // Prevent ANY conflict for the entire moved subtree (not just the root).
    // Compute all next names, then ensure none already exist outside the moving set.
    // Compare ids as text to stay compatible with legacy schemas (uuid/int/etc.).
    const movingIds = folderRows.rows.map((r) => String(r.id))
    const nextNames = folderRows.rows.map((row) => {
      const current = row.name
      return current === source ? nextName : nextName + current.slice(source.length)
    })
    const conflictAny = await pool.query(
      `
        SELECT 1
        FROM folders
        WHERE direction_id = $1
          AND deleted_at IS NULL
          AND name = ANY($2::text[])
          AND NOT (id::text = ANY($3::text[]))
        LIMIT 1
      `,
      [directionId, nextNames, movingIds]
    )
    if (conflictAny.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflit: un ou plusieurs sous-dossiers existent déjà à la destination.',
      })
    }

    for (const row of folderRows.rows) {
      const current = row.name
      const next = current === source ? nextName : nextName + current.slice(source.length)
      await pool.query('UPDATE folders SET name = $1 WHERE id = $2', [next, row.id])
    }
    await pool.query(
      `UPDATE files SET folder = $1 || substring(folder from $2)
       WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5 ESCAPE '\\')`,
      [nextName, source.length + 1, directionId, source, sourceLike]
    )
    await pool.query(
      `UPDATE links SET folder = $1 || substring(folder from $2)
       WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5 ESCAPE '\\')`,
      [nextName, source.length + 1, directionId, source, sourceLike]
    )

    await insertActivityLog(pool, {
      action: 'move_folder',
      actorIdentifiant: identifiant || null,
      actorId: user.id,
      directionId,
      entityType: 'folder',
      entityId: null,
      details: { source, target: target || null, newName: nextName },
    })
    broadcastDataChange('folders', 'updated', { directionId })
    broadcastDataChange('files', 'updated', { directionId })
    broadcastDataChange('links', 'updated', { directionId })
    return res.json({ ok: true, name: nextName })
  } catch (err) {
    console.error('folder move error', err)
    const details = (process.env.EXPOSE_ERRORS === '1' || process.env.NODE_ENV !== 'production')
      ? (err?.message || String(err))
      : undefined
    return res.status(500).json({ error: 'Erreur lors du déplacement du dossier.', details })
  }
})

// Delete a folder tree: deletes a folder and any subfolders (name prefix match)
// Body: { direction_id, name, identifiant }
app.delete('/api/folders-tree', async (req, res) => {
  try {
    const { direction_id: directionId, name: nameRaw, identifiant } = req.body || {}
    const name = (nameRaw || '').trim()
    if (!directionId) return res.status(400).json({ error: 'Direction requise.' })
    if (!identifiant) return res.status(401).json({ error: 'Authentification requise.' })
    if (!name) return res.status(400).json({ error: 'Nom du dossier requis.' })

    const userRes = await pool.query('SELECT id, role, direction_id FROM users WHERE identifiant = $1', [identifiant])
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Utilisateur non trouvé.' })
    const user = userRes.rows[0]
    if (user.role !== 'admin' && user.direction_id !== directionId) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que les dossiers de votre direction.' })
    }

    const now = new Date().toISOString()
    // Soft-delete: all matching folders + their content
    await pool.query(
      `UPDATE folders SET deleted_at = $1, deleted_by = $2
       WHERE direction_id = $3 AND deleted_at IS NULL AND (name = $4 OR name LIKE $5)`,
      [now, identifiant || null, directionId, name, `${name}::%`]
    )
    await pool.query(
      `UPDATE files SET deleted_at = $1, deleted_by = $2
       WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5)`,
      [now, identifiant || null, directionId, name, `${name}::%`]
    )
    await pool.query(
      `UPDATE links SET deleted_at = $1, deleted_by = $2
       WHERE direction_id = $3 AND deleted_at IS NULL AND (folder = $4 OR folder LIKE $5)`,
      [now, identifiant || null, directionId, name, `${name}::%`]
    )

    await insertActivityLog(pool, {
      action: 'delete_folder_tree',
      actorIdentifiant: identifiant || null,
      actorId: user.id,
      directionId,
      entityType: 'folder',
      entityId: null,
      details: { name },
    })
    broadcastDataChange('folders', 'deleted', { directionId })
    broadcastDataChange('files', 'deleted', { directionId })
    broadcastDataChange('links', 'deleted', { directionId })
    return res.status(204).send()
  } catch (err) {
    console.error('folder tree delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du dossier.' })
  }
})

// Toggle folder visibility (public <-> direction_only)
app.patch('/api/folders/:id/visibility', async (req, res) => {
  try {
    const { id } = req.params
    const { visibility: rawVisibility, identifiant: bodyIdentifiant } = req.body || {}
    const visibility = rawVisibility === 'direction_only' ? 'direction_only' : 'public'
    const identifiant =
      bodyIdentifiant ||
      (req.query && req.query.identifiant) ||
      req.authIdentifiant ||
      getOptionalAuthUser(req)
    if (!identifiant) {
      return res.status(401).json({ error: 'Authentification requise.' })
    }

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
    const { folder, identifiant } = req.query

    // Pagination (prevents huge payloads/timeouts through proxies)
    const limit = Math.max(1, Math.min(1000, parseInt((req.query.limit || '200').toString(), 10) || 200))
    const offset = Math.max(0, Math.min(50_000, parseInt((req.query.offset || '0').toString(), 10) || 0))

    let role = req.query.role
    let userDirectionId = req.query.direction_id

    let userIdForFolderGrants = null
    let accessibleDirectionIds = []
    if (identifiant) {
      // Trust DB for role/direction (avoid spoofing via query params)
      const u = await pool.query('SELECT id, direction_id, role FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) {
        userIdForFolderGrants = u.rows[0].id
        role = u.rows[0].role || role
        // Fallback: if direction_id is missing from query, use the user's DB direction.
        if (!userDirectionId && u.rows[0].direction_id) {
          userDirectionId = u.rows[0].direction_id
        }
        if (userDirectionId) accessibleDirectionIds.push(userDirectionId)
        try {
          const grants = await pool.query(
            'SELECT granted_direction_id FROM direction_access_grants WHERE user_id = $1',
            [userIdForFolderGrants]
          )
          for (const row of grants.rows) {
            if (row.granted_direction_id && !accessibleDirectionIds.includes(row.granted_direction_id)) {
              accessibleDirectionIds.push(row.granted_direction_id)
            }
          }
        } catch (_) {
          // ignore
        }
      }
    }

    const params = []
    let sql = 'SELECT id, name, mime_type, size, folder, direction_id, cloudinary_url, icon_url, created_at FROM files'

    const conditions = ['deleted_at IS NULL']

    if (folder) {
      params.push(folder)
      conditions.push(`files.folder = $${params.length}`)
    }

    if (role && role !== 'admin') {
      params.push(role)
      // Default-allow model:
      // only hide a folder when the current role has an explicit deny (can_view = false).
      conditions.push(`
        NOT EXISTS (
          SELECT 1
          FROM folder_role_visibility v
          JOIN roles r ON r.id = v.role_id
          WHERE v.folder_name = files.folder
            AND r.name = $${params.length}
            AND v.can_view = false
        )
      `)

      // Direction-only: visible si public, ou user dans la direction, ou accès accordé via folder_access_grants
      if (userIdForFolderGrants) {
        const dirs = accessibleDirectionIds.length > 0 ? accessibleDirectionIds : (userDirectionId ? [userDirectionId] : [])
        if (dirs.length > 0) {
          params.push(dirs)
          params.push(userIdForFolderGrants)
          conditions.push(`
          (
            NOT EXISTS (
              SELECT 1 FROM folders ff
              WHERE ff.name = files.folder AND ff.direction_id = files.direction_id
                AND ff.visibility = 'direction_only'
                AND NOT (ff.direction_id = ANY($${params.length - 1}::uuid[]))
            )
            OR EXISTS (
              SELECT 1 FROM folders ff
              JOIN folder_access_grants fag ON fag.folder_id = ff.id AND fag.user_id = $${params.length}
              WHERE ff.name = files.folder AND ff.direction_id = files.direction_id
                AND ff.visibility = 'direction_only'
            )
          )
          `)
        } else {
          params.push(userIdForFolderGrants)
          conditions.push(`
            (
              NOT EXISTS (
                SELECT 1 FROM folders ff
                WHERE ff.name = files.folder AND ff.direction_id = files.direction_id
                  AND ff.visibility = 'direction_only'
              )
              OR EXISTS (
                SELECT 1 FROM folders ff
                JOIN folder_access_grants fag ON fag.folder_id = ff.id AND fag.user_id = $${params.length}
                WHERE ff.name = files.folder AND ff.direction_id = files.direction_id
              )
            )
          `)
        }
      } else if (userDirectionId) {
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
    params.push(limit)
    params.push(offset)
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`

    const result = await pool.query(sql, params)

    const rows = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      size: Number(row.size) || 0,
      mime_type: row.mime_type || '',
      folder: normalizeFolderPath(row.folder),
      direction_id: row.direction_id,
      url: row.cloudinary_url || `${BASE_URL}/files/${encodeURIComponent(row.id)}`,
      view_url: `${BASE_URL}/files/${encodeURIComponent(row.id)}`,
      icon_url: row.icon_url || null,
      created_at: row.created_at,
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
        const len = upstream.headers.get('content-length')
        if (len) res.setHeader('Content-Length', len)
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream')
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(file.name)}"`
        )
        // Stream through instead of buffering the whole file (avoids OOM on large videos/PDFs).
        if (upstream.body && typeof Readable.fromWeb === 'function') {
          await pipeline(Readable.fromWeb(upstream.body), res)
          return
        }
        const buf = Buffer.from(await upstream.arrayBuffer())
        res.setHeader('Content-Length', buf.length)
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

    // Soft-delete: move to trash instead of permanent deletion
    await pool.query('UPDATE files SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2', [identifiant || null, id])
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

    // Soft-delete: move folder and its contents to trash
    const now = new Date().toISOString()
    if (directionId) {
      await pool.query('UPDATE links SET deleted_at = $1, deleted_by = $2 WHERE folder = $3 AND direction_id = $4 AND deleted_at IS NULL', [now, identifiant || null, folder, directionId])
      await pool.query('UPDATE files SET deleted_at = $1, deleted_by = $2 WHERE folder = $3 AND direction_id = $4 AND deleted_at IS NULL', [now, identifiant || null, folder, directionId])
      await pool.query('UPDATE folders SET deleted_at = $1, deleted_by = $2 WHERE name = $3 AND direction_id = $4 AND deleted_at IS NULL', [now, identifiant || null, folder, directionId])
    } else {
      await pool.query('UPDATE links SET deleted_at = $1, deleted_by = $2 WHERE folder = $3 AND deleted_at IS NULL', [now, identifiant || null, folder])
      await pool.query('UPDATE files SET deleted_at = $1, deleted_by = $2 WHERE folder = $3 AND deleted_at IS NULL', [now, identifiant || null, folder])
      await pool.query('UPDATE folders SET deleted_at = $1, deleted_by = $2 WHERE name = $3 AND deleted_at IS NULL', [now, identifiant || null, folder])
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
    const { folder, identifiant } = req.query

    // Pagination (prevents huge payloads/timeouts through proxies)
    const limit = Math.max(1, Math.min(1000, parseInt((req.query.limit || '200').toString(), 10) || 200))
    const offset = Math.max(0, Math.min(50_000, parseInt((req.query.offset || '0').toString(), 10) || 0))

    let role = req.query.role
    let userDirectionId = req.query.direction_id

    let userIdForFolderGrants = null
    if (identifiant) {
      // Trust DB for role/direction (avoid spoofing via query params)
      const u = await pool.query('SELECT id, direction_id, role FROM users WHERE identifiant = $1', [identifiant])
      if (u.rows.length > 0) {
        userIdForFolderGrants = u.rows[0].id
        role = u.rows[0].role || role
        // Fallback: if direction_id is missing from query, use the user's DB direction.
        if (!userDirectionId && u.rows[0].direction_id) {
          userDirectionId = u.rows[0].direction_id
        }
      }
    }

    const params = []
    let sql = `
      SELECT l.id, l.folder, l.direction_id, l.url, l.label, l.created_at
      FROM links l
    `
    const conditions = ['l.deleted_at IS NULL']

    if (folder) {
      params.push(folder)
      conditions.push(`l.folder = $${params.length}`)
    }

    if (role && role !== 'admin') {
      params.push(role)
      // Default-allow model:
      // only hide a folder when the current role has an explicit deny (can_view = false).
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM folder_role_visibility v
          JOIN roles r ON r.id = v.role_id
          WHERE v.folder_name = l.folder
            AND r.name = $${params.length}
            AND v.can_view = false
        )
      `)

      // Direction-only: visible si public, ou user dans la direction, ou accès accordé via folder_access_grants
      if (userDirectionId) {
        params.push(userDirectionId)
        if (userIdForFolderGrants) {
          params.push(userIdForFolderGrants)
          conditions.push(`
          (
            NOT EXISTS (
              SELECT 1 FROM folders ff
              WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
                AND ff.visibility = 'direction_only'
                AND ff.direction_id != $${params.length - 1}
            )
            OR EXISTS (
              SELECT 1 FROM folders ff
              JOIN folder_access_grants fag ON fag.folder_id = ff.id AND fag.user_id = $${params.length}
              WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
                AND ff.visibility = 'direction_only'
            )
          )
          `)
        } else {
          conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM folders ff
            WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
              AND ff.visibility = 'direction_only'
              AND ff.direction_id != $${params.length}
          )
          `)
        }
      } else if (userIdForFolderGrants) {
        params.push(userIdForFolderGrants)
        conditions.push(`
          (
            NOT EXISTS (
              SELECT 1 FROM folders ff
              WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
                AND ff.visibility = 'direction_only'
            )
            OR EXISTS (
              SELECT 1 FROM folders ff
              JOIN folder_access_grants fag ON fag.folder_id = ff.id AND fag.user_id = $${params.length}
              WHERE ff.name = l.folder AND ff.direction_id = l.direction_id
            )
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
    params.push(limit)
    params.push(offset)
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`

    const result = await pool.query(sql, params)
    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        folder: normalizeFolderPath(row.folder),
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

    // Soft-delete: move to trash
    await pool.query('UPDATE links SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2', [identifiant || null, id])
    broadcastDataChange('links', 'deleted', { id })
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('link delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du lien.' })
  }
})

// ══════════════════════════════════════════════════════════════
// ─── Corbeille (Trash) – Admin only ──────────────────────────
// ══════════════════════════════════════════════════════════════

// Middleware: check caller is admin
async function requireAdmin(req, res, next) {
  const identifiant = req.query.identifiant || req.body?.identifiant || req.headers['x-identifiant']
  if (!identifiant) return res.status(403).json({ error: 'Identifiant requis.' })
  const r = await pool.query('SELECT role FROM users WHERE identifiant = $1', [identifiant])
  if (r.rows.length === 0 || r.rows[0].role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
  }
  next()
}

// List all soft-deleted items (files, links, folders)
app.get('/api/trash', requireAdmin, async (_req, res) => {
  try {
    const [filesRes, linksRes, foldersRes] = await Promise.all([
      pool.query(`
        SELECT f.id, f.name, f.folder, f.direction_id, f.size, f.deleted_at, f.deleted_by, f.cloudinary_url, d.name AS direction_name
        FROM files f
        LEFT JOIN directions d ON d.id = f.direction_id
        WHERE f.deleted_at IS NOT NULL
        ORDER BY f.deleted_at DESC
      `),
      pool.query(`
        SELECT l.id, l.folder, l.direction_id, l.url, l.label, l.deleted_at, l.deleted_by, d.name AS direction_name
        FROM links l
        LEFT JOIN directions d ON d.id = l.direction_id
        WHERE l.deleted_at IS NOT NULL
        ORDER BY l.deleted_at DESC
      `),
      pool.query(`
        SELECT f.id, f.name, f.direction_id, f.deleted_at, f.deleted_by, d.name AS direction_name
        FROM folders f
        LEFT JOIN directions d ON d.id = f.direction_id
        WHERE f.deleted_at IS NOT NULL
        ORDER BY f.deleted_at DESC
      `),
    ])

    return res.json({
      files: filesRes.rows.map((r) => ({
        id: r.id,
        type: 'file',
        name: r.name,
        folder: r.folder,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        size: Number(r.size) || 0,
        url: r.cloudinary_url || null,
        deleted_at: r.deleted_at,
        deleted_by: r.deleted_by,
      })),
      links: linksRes.rows.map((r) => ({
        id: r.id,
        type: 'link',
        label: r.label,
        url: r.url,
        folder: r.folder,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        deleted_at: r.deleted_at,
        deleted_by: r.deleted_by,
      })),
      folders: foldersRes.rows.map((r) => ({
        id: r.id,
        type: 'folder',
        name: r.name,
        direction_id: r.direction_id,
        direction_name: r.direction_name,
        deleted_at: r.deleted_at,
        deleted_by: r.deleted_by,
      })),
    })
  } catch (err) {
    console.error('trash list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération de la corbeille.' })
  }
})

// Restore a soft-deleted item
app.post('/api/trash/restore', requireAdmin, async (req, res) => {
  try {
    const { id, type } = req.body || {}
    if (!id || !type) return res.status(400).json({ error: 'id et type requis.' })

    let result
    if (type === 'file') {
      result = await pool.query('UPDATE files SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 RETURNING id', [id])
      broadcastDataChange('files', 'created', { id })
    } else if (type === 'link') {
      result = await pool.query('UPDATE links SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 RETURNING id', [id])
      broadcastDataChange('links', 'created', { id })
    } else if (type === 'folder') {
      // Restore folder and all its contents
      const folderRow = await pool.query('SELECT name, direction_id FROM folders WHERE id = $1', [id])
      if (folderRow.rows.length > 0) {
        const { name, direction_id } = folderRow.rows[0]
        await pool.query('UPDATE folders SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', [id])
        await pool.query('UPDATE files SET deleted_at = NULL, deleted_by = NULL WHERE folder = $1 AND direction_id = $2 AND deleted_at IS NOT NULL', [name, direction_id])
        await pool.query('UPDATE links SET deleted_at = NULL, deleted_by = NULL WHERE folder = $1 AND direction_id = $2 AND deleted_at IS NOT NULL', [name, direction_id])
        broadcastDataChange('folders', 'created', { id })
        broadcastDataChange('files', 'created', {})
        broadcastDataChange('links', 'created', {})
      }
      result = { rowCount: folderRow.rows.length }
    } else {
      return res.status(400).json({ error: 'Type invalide. Utilisez file, link ou folder.' })
    }

    if (!result || result.rowCount === 0) {
      return res.status(404).json({ error: 'Élément introuvable dans la corbeille.' })
    }

    return res.json({ ok: true })
  } catch (err) {
    console.error('trash restore error', err)
    return res.status(500).json({ error: 'Erreur lors de la restauration.' })
  }
})

// Rename a soft-deleted item (admin only)
app.patch('/api/trash/:type/:id', requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.params
    const { name, label } = req.body || {}
    const newName = (name || label || '').trim()
    if (!newName) return res.status(400).json({ error: 'Nom requis.' })

    if (type === 'file') {
      const r = await pool.query('UPDATE files SET name = $1 WHERE id = $2 AND deleted_at IS NOT NULL RETURNING id, name', [newName, id])
      if (r.rowCount === 0) return res.status(404).json({ error: 'Fichier introuvable dans la corbeille.' })
      return res.json(r.rows[0])
    }
    if (type === 'link') {
      const r = await pool.query('UPDATE links SET label = $1 WHERE id = $2 AND deleted_at IS NOT NULL RETURNING id, label', [newName, id])
      if (r.rowCount === 0) return res.status(404).json({ error: 'Lien introuvable dans la corbeille.' })
      return res.json({ id: r.rows[0].id, name: r.rows[0].label })
    }
    if (type === 'folder') {
      const folderRow = await pool.query('SELECT name, direction_id FROM folders WHERE id = $1 AND deleted_at IS NOT NULL', [id])
      if (folderRow.rows.length === 0) return res.status(404).json({ error: 'Dossier introuvable dans la corbeille.' })
      const oldName = folderRow.rows[0].name
      const directionId = folderRow.rows[0].direction_id
      await pool.query('UPDATE folders SET name = $1 WHERE id = $2', [newName, id])
      await pool.query('UPDATE files SET folder = $1 WHERE folder = $2 AND direction_id = $3 AND deleted_at IS NOT NULL', [newName, oldName, directionId])
      await pool.query('UPDATE links SET folder = $1 WHERE folder = $2 AND direction_id = $3 AND deleted_at IS NOT NULL', [newName, oldName, directionId])
      return res.json({ id, name: newName })
    }
    return res.status(400).json({ error: 'Type invalide.' })
  } catch (err) {
    console.error('trash rename error', err)
    return res.status(500).json({ error: 'Erreur lors du renommage.' })
  }
})

// Permanently delete a soft-deleted item (admin only)
app.delete('/api/trash/:type/:id', requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.params

    if (type === 'file') {
      // Delete from Cloudinary first
      const fileRow = await pool.query('SELECT cloudinary_public_id FROM files WHERE id = $1', [id])
      if (fileRow.rows.length > 0 && fileRow.rows[0].cloudinary_public_id) {
        try { await cloudinary.uploader.destroy(fileRow.rows[0].cloudinary_public_id, { resource_type: 'raw' }) } catch (_) { /* ignore */ }
        try { await cloudinary.uploader.destroy(fileRow.rows[0].cloudinary_public_id) } catch (_) { /* ignore */ }
      }
      await pool.query('DELETE FROM files WHERE id = $1', [id])
    } else if (type === 'link') {
      await pool.query('DELETE FROM links WHERE id = $1', [id])
    } else if (type === 'folder') {
      const folderRow = await pool.query('SELECT name, direction_id FROM folders WHERE id = $1', [id])
      if (folderRow.rows.length > 0) {
        const { name, direction_id } = folderRow.rows[0]
        // Delete Cloudinary resources for all files in the folder
        const filesToDelete = await pool.query('SELECT cloudinary_public_id FROM files WHERE folder = $1 AND direction_id = $2 AND cloudinary_public_id IS NOT NULL', [name, direction_id])
        for (const f of filesToDelete.rows) {
          try { await cloudinary.uploader.destroy(f.cloudinary_public_id, { resource_type: 'raw' }) } catch (_) { /* ignore */ }
          try { await cloudinary.uploader.destroy(f.cloudinary_public_id) } catch (_) { /* ignore */ }
        }
        await pool.query('DELETE FROM links WHERE folder = $1 AND direction_id = $2', [name, direction_id])
        await pool.query('DELETE FROM files WHERE folder = $1 AND direction_id = $2', [name, direction_id])
        await pool.query('DELETE FROM folders WHERE id = $1', [id])
      }
    } else {
      return res.status(400).json({ error: 'Type invalide.' })
    }

    return res.status(204).send()
  } catch (err) {
    console.error('trash permanent delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression définitive.' })
  }
})

// Empty entire trash (admin only)
app.delete('/api/trash', requireAdmin, async (_req, res) => {
  try {
    // Delete Cloudinary resources for all soft-deleted files
    const filesToDelete = await pool.query('SELECT cloudinary_public_id FROM files WHERE deleted_at IS NOT NULL AND cloudinary_public_id IS NOT NULL')
    for (const f of filesToDelete.rows) {
      try { await cloudinary.uploader.destroy(f.cloudinary_public_id, { resource_type: 'raw' }) } catch (_) { /* ignore */ }
      try { await cloudinary.uploader.destroy(f.cloudinary_public_id) } catch (_) { /* ignore */ }
    }

    await pool.query('DELETE FROM links WHERE deleted_at IS NOT NULL')
    await pool.query('DELETE FROM files WHERE deleted_at IS NOT NULL')
    await pool.query('DELETE FROM folders WHERE deleted_at IS NOT NULL')

    return res.json({ ok: true })
  } catch (err) {
    console.error('empty trash error', err)
    return res.status(500).json({ error: 'Erreur lors du vidage de la corbeille.' })
  }
})

// Automatic trash cleanup: permanently delete items older than 7 days
async function cleanupOldTrash() {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    
    // Get all files to delete (older than 7 days) - including those with Cloudinary resources
    const filesToDelete = await pool.query(
      'SELECT cloudinary_public_id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [oneWeekAgo]
    )
    
    // Delete Cloudinary resources for files that have them
    for (const f of filesToDelete.rows) {
      if (f.cloudinary_public_id) {
        try {
          await cloudinary.uploader.destroy(f.cloudinary_public_id, { resource_type: 'raw' })
        } catch (_) { /* ignore */ }
        try {
          await cloudinary.uploader.destroy(f.cloudinary_public_id)
        } catch (_) { /* ignore */ }
      }
    }
    
    // Count items before deletion for logging
    const linksCountRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM links WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [oneWeekAgo]
    )
    const linksCount = linksCountRes.rows[0]?.count || 0
    
    const filesCountRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM files WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [oneWeekAgo]
    )
    const filesCount = filesCountRes.rows[0]?.count || 0
    
    const foldersCountRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [oneWeekAgo]
    )
    const foldersCount = foldersCountRes.rows[0]?.count || 0
    
    // For folders, delete all associated files and links first, then the folder
    const foldersToDelete = await pool.query(
      'SELECT id, name, direction_id FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < $1',
      [oneWeekAgo]
    )
    
    for (const folder of foldersToDelete.rows) {
      const { name, direction_id } = folder
      // Delete Cloudinary resources for files in this folder
      const folderFiles = await pool.query(
        'SELECT cloudinary_public_id FROM files WHERE folder = $1 AND direction_id = $2 AND cloudinary_public_id IS NOT NULL',
        [name, direction_id]
      )
      for (const f of folderFiles.rows) {
        try {
          await cloudinary.uploader.destroy(f.cloudinary_public_id, { resource_type: 'raw' })
        } catch (_) { /* ignore */ }
        try {
          await cloudinary.uploader.destroy(f.cloudinary_public_id)
        } catch (_) { /* ignore */ }
      }
      // Delete files and links in the folder
      await pool.query('DELETE FROM links WHERE folder = $1 AND direction_id = $2', [name, direction_id])
      await pool.query('DELETE FROM files WHERE folder = $1 AND direction_id = $2', [name, direction_id])
    }
    
    // Permanently delete old items from database
    await pool.query('DELETE FROM links WHERE deleted_at IS NOT NULL AND deleted_at < $1', [oneWeekAgo])
    await pool.query('DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < $1', [oneWeekAgo])
    await pool.query('DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < $1', [oneWeekAgo])
    
    const totalDeleted = linksCount + filesCount + foldersCount
    if (totalDeleted > 0) {
      console.log(`[trash-cleanup] Permanently deleted ${totalDeleted} old items from trash (${linksCount} links, ${filesCount} files, ${foldersCount} folders)`)
    }
  } catch (err) {
    console.error('[trash-cleanup] Error during automatic trash cleanup:', err)
  }
}

const defaultPort = 3000
const port = parseInt(process.env.PORT, 10) || defaultPort

// Create HTTP server from the Express app so we can attach WebSocket
// ---------- Frontend static serving (production) ----------
// Serve Vite build from ../dist when available.
const FRONTEND_DIST_DIR = path.resolve(__dirname, '..', 'dist')
const FRONTEND_INDEX_FILE = path.join(FRONTEND_DIST_DIR, 'index.html')

if (fs.existsSync(FRONTEND_DIST_DIR) && fs.existsSync(FRONTEND_INDEX_FILE)) {
  // Never cache HTML at the edge/browser — stale index.html causes "module script is text/html"
  // when old hashes (e.g. index-XXX.js) 404 and a proxy returns HTML instead of JS.
  app.use(
    express.static(FRONTEND_DIST_DIR, {
      index: 'index.html',
      setHeaders(res, filePath) {
        const base = path.basename(filePath)
        if (base === 'index.html' || filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
          res.setHeader('Pragma', 'no-cache')
          res.setHeader('Expires', '0')
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    })
  )

  // Missing files under /assets (e.g. stale hashed chunk after redeploy): respond with a
  // non-HTML 404 so the browser does not report "module script ... MIME type text/html"
  // (Express default 404 is HTML).
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const isUnderAssets = req.path === '/assets' || req.path.startsWith('/assets/')
    if (!isUnderAssets) return next()
    const ext = path.extname(req.path.replace(/\/$/, ''))
    let body = 'Not found'
    let contentType = 'text/plain; charset=utf-8'
    if (ext === '.css') {
      contentType = 'text/css; charset=utf-8'
      body = '/* asset missing — run `npm run build` and redeploy full dist, or hard refresh */'
    } else if (ext === '.map') {
      contentType = 'application/json; charset=utf-8'
      body = '{}'
    } else if (ext === '.js' || ext === '.mjs' || ext === '') {
      contentType = 'application/javascript; charset=utf-8'
      body =
        '// 404: asset missing — redeploy the full `dist` after `npm run build`, or hard refresh (Ctrl+Shift+R).'
    }
    res.status(404)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', contentType)
    return res.send(body)
  })

  // SPA fallback: serve index.html only for browser navigation routes.
  // Important: do NOT return index.html for asset URLs (.js/.css/...), otherwise
  // browsers fail with "Expected JavaScript module but got text/html".
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/files/') ||
      req.path.startsWith('/ws') ||
      req.path === '/assets' ||
      req.path.startsWith('/assets/') ||
      path.extname(req.path)
    ) {
      return next()
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    return res.sendFile(FRONTEND_INDEX_FILE)
  })
} else {
  console.warn('[frontend] dist/index.html not found. Run `npm run build` to serve frontend from this server.')
}

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
      `SELECT u.role, u.name, u.prenoms, d.name AS direction_name
       FROM users u LEFT JOIN directions d ON d.id = u.direction_id
       WHERE u.identifiant = $1`,
      [identifiant]
    )
    if (userRes.rows.length > 0) {
      const row = userRes.rows[0]
      userRole = row.role
      userDirectionName = row.direction_name || null
      userDisplayCache.set(identifiant, { name: row.name || '', prenoms: row.prenoms || '' })
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
    const cached = userDisplayCache.get(identifiant) || {}
    userPresence.set(identifiant, {
      page: '/dashboard',
      section: null,
      lastSeen: new Date().toISOString(),
      connectedAt: ws._connectedAt,
      role: userRole || 'user',
      direction_name: userDirectionName,
      name: cached.name || '',
      prenoms: cached.prenoms || '',
    })
    recordLiveEvent(identifiant, 'connected', null)
    broadcastLivePresence()
  }

  // Handle incoming messages from clients (presence + action tracking)
  ws.on('message', (raw) => {
    try {
      const msg = raw.toString()
      // Ignore pong frames and empty messages
      if (!msg || msg.length < 2) return
      const data = JSON.parse(msg)

      // Presence update: user navigated to a new page
      if (data.type === 'presence' && userRole !== 'admin') {
        const existing = userPresence.get(identifiant) || {}
        userPresence.set(identifiant, {
          ...existing,
          page: String(data.page || '/dashboard').slice(0, 200),
          section: data.section ? String(data.section).slice(0, 200) : null,
          lastSeen: new Date().toISOString(),
          name: existing.name ?? '',
          prenoms: existing.prenoms ?? '',
        })
        console.log(`[live] presence: ${identifiant} → ${data.page}`)
        broadcastLivePresence()
      }

      // Action event: user performed a meaningful action
      if (data.type === 'action' && userRole !== 'admin') {
        const action = String(data.action || 'unknown').slice(0, 50)
        const detail = data.detail ? String(data.detail).slice(0, 300) : null
        console.log(`[live] action: ${identifiant} → ${action} (${detail})`)
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

// eslint-disable-next-line no-console
console.log(`[boot] PORT=${port} NODE_ENV=${process.env.NODE_ENV || ''} dist=${fs.existsSync(FRONTEND_INDEX_FILE) ? 'yes' : 'no'}`)


server.listen(port, '0.0.0.0', () => {

  console.log(`Server listening on 0.0.0.0:${port} (waiting for DB init…)`)

  console.log(`[ws] WebSocket server path: /ws`)
  initDb()
    .then(() => {
 
      console.log(`Server ready at ${BASE_URL.replace(/:(\d+)$/, ':' + port)} (port ${port})`)
      cleanupOldTrash()
      setInterval(() => {
        cleanupOldTrash()
      }, 6 * 60 * 60 * 1000)
      console.log('[trash-cleanup] Automatic trash cleanup scheduled (runs every 6 hours, deletes items older than 7 days)')
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize database', err)
      process.exit(1)
    })
})

