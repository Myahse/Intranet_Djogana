const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const multer = require('multer')
const cors = require('cors')
const { Pool } = require('pg')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')

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

const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    'DATABASE_URL is not set. Backend will not be able to connect to Neon/Postgres.'
  )
}

const pool = new Pool({
  connectionString: DATABASE_URL,
})

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      identifiant text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id uuid PRIMARY KEY,
      name text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      mime_type text NOT NULL,
      size bigint NOT NULL,
      folder text NOT NULL,
      uploaded_by uuid,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_uploaded_by
        FOREIGN KEY (uploaded_by)
        REFERENCES users(id)
        ON DELETE SET NULL
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
      can_delete_folder boolean NOT NULL DEFAULT false
    );
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

  // Give admin full permissions by default
  await pool.query(
    `
      INSERT INTO role_permissions (role_id, can_create_folder, can_upload_file, can_delete_file, can_delete_folder)
      SELECT id, true, true, true, true
      FROM roles
      WHERE name = 'admin'
      ON CONFLICT (role_id)
      DO UPDATE SET
        can_create_folder = EXCLUDED.can_create_folder,
        can_upload_file = EXCLUDED.can_upload_file,
        can_delete_file = EXCLUDED.can_delete_file,
        can_delete_folder = EXCLUDED.can_delete_folder
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

// ---------- Auth ----------

app.get('/api/users', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, identifiant, role, created_at FROM users ORDER BY created_at DESC'
    )
    return res.json(result.rows)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('list users error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' })
  }
})

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' })
    }
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('delete user error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression de l’utilisateur.' })
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { identifiant, password, role } = req.body || {}
    if (!identifiant || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe sont requis.' })
    }

    const hashed = await bcrypt.hash(password, 10)
    const id = uuidv4()

    // If a role is provided and exists in the roles table, use it.
    // Otherwise, fall back to the simple rule: identifiant '1234567890' => admin, others => user.
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

    await pool.query(
      'INSERT INTO users (id, identifiant, password_hash, role) VALUES ($1, $2, $3, $4)',
      [id, identifiant, hashed, finalRole]
    )

    return res.status(201).json({ id, identifiant, role: finalRole })
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
      'SELECT id, identifiant, password_hash, role FROM users WHERE identifiant = $1',
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

    return res.json({ id: user.id, identifiant: user.identifiant, role: user.role })
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

// ---------- Roles & permissions (RBAC) ----------

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
        COALESCE(p.can_delete_folder, false) AS can_delete_folder
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
    } = req.body || {}

    // Ensure the role exists
    const roleRes = await pool.query('SELECT id FROM roles WHERE id = $1', [id])
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rôle introuvable.' })
    }

    // Upsert permissions row
    await pool.query(
      `
        INSERT INTO role_permissions (role_id, can_create_folder, can_upload_file, can_delete_file, can_delete_folder)
        VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, false), COALESCE($5, false))
        ON CONFLICT (role_id)
        DO UPDATE SET
          can_create_folder = COALESCE($2, role_permissions.can_create_folder),
          can_upload_file = COALESCE($3, role_permissions.can_upload_file),
          can_delete_file = COALESCE($4, role_permissions.can_delete_file),
          can_delete_folder = COALESCE($5, role_permissions.can_delete_folder)
      `,
      [id, canCreateFolder, canUploadFile, canDeleteFile, canDeleteFolder]
    )

    const updated = await pool.query(
      `
        SELECT
          r.id,
          r.name,
          p.can_create_folder,
          p.can_upload_file,
          p.can_delete_file,
          p.can_delete_folder
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

app.post('/api/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const folder = (req.body && req.body.folder) || 'default'
    const uploadedBy = (req.body && req.body.uploadedBy) || null

    const id = uuidv4()
    const folderId = uuidv4()

    // Ensure the folder/group exists in folders table
    await pool.query(
      `
        INSERT INTO folders (id, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `,
      [folderId, folder]
    )

    await pool.query(
      `
        INSERT INTO files (id, name, mime_type, size, folder, uploaded_by, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        id,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        folder,
        uploadedBy,
        req.file.buffer,
      ]
    )

    const publicUrl = `${BASE_URL}/files/${encodeURIComponent(id)}`

    return res.json({
      id,
      name: req.file.originalname,
      size: req.file.size,
      url: publicUrl,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('file upload error', err)
    return res.status(500).json({ error: 'Erreur lors de l’upload du fichier.' })
  }
})

// Explicit folders / groups
app.get('/api/folders', async (_req, res) => {
  try {
    const { role } = _req.query

    let sql = 'SELECT name, created_at FROM folders'
    const params = []

    if (role && role !== 'admin') {
      // Rule:
      // - If a folder has no explicit visibility rows, it is visible to all roles
      // - If it has visibility rows, only roles with can_view = true can see it
      sql += `
        WHERE NOT EXISTS (
          SELECT 1
          FROM folder_role_visibility v
          JOIN roles r ON r.id = v.role_id
          WHERE v.folder_name = folders.name
        )
        OR EXISTS (
          SELECT 1
          FROM folder_role_visibility v
          JOIN roles r ON r.id = v.role_id
          WHERE v.folder_name = folders.name
            AND r.name = $1
            AND v.can_view = true
        )
      `
      params.push(role)
    }

    sql += ' ORDER BY created_at DESC'

    const result = await pool.query(sql, params)
    return res.json(result.rows.map((row) => ({ name: row.name, createdAt: row.created_at })))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('folders list error', err)
    return res.status(500).json({ error: 'Erreur lors de la récupération des dossiers.' })
  }
})

app.post('/api/folders', async (req, res) => {
  try {
    const { folder } = req.body || {}
    const name = (folder || '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Nom de dossier requis.' })
    }

    const id = uuidv4()
    await pool.query(
      `
        INSERT INTO folders (id, name)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `,
      [id, name]
    )

    return res.status(201).json({ name })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('folder create error', err)
    return res.status(500).json({ error: 'Erreur lors de la création du dossier.' })
  }
})

app.get('/api/files', async (req, res) => {
  try {
    const { folder, role } = req.query

    const params = []
    let sql = 'SELECT id, name, mime_type, size, folder, created_at FROM files'

    const conditions = []

    if (folder) {
      params.push(folder)
      conditions.push(`folder = $${params.length}`)
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

    sql += ' ORDER BY created_at DESC'

    const result = await pool.query(sql, params)

    const rows = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      size: Number(row.size) || 0,
      folder: row.folder,
      url: `${BASE_URL}/files/${encodeURIComponent(row.id)}`,
    }))

    return res.json(rows)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('files list error', err)
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

app.delete('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params
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
    await pool.query('DELETE FROM files WHERE folder = $1', [folder])
    await pool.query('DELETE FROM folders WHERE name = $1', [folder])
    return res.status(204).send()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('folder delete error', err)
    return res.status(500).json({ error: 'Erreur lors de la suppression du dossier.' })
  }
})

const port = process.env.PORT || 3000

initDb()
  .then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running at ${BASE_URL} (port ${port})`)
    })
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize database', err)
    process.exit(1)
  })

