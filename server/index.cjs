const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const multer = require('multer')
const cors = require('cors')
const { Pool } = require('pg')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')

const app = express()
app.use(cors())
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
    const { identifiant, password } = req.body || {}
    if (!identifiant || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe sont requis.' })
    }

    const hashed = await bcrypt.hash(password, 10)
    const id = uuidv4()

    // simple rule: identifiant '1234567890' => admin, others => user
    const role = identifiant === '1234567890' ? 'admin' : 'user'

    await pool.query(
      'INSERT INTO users (id, identifiant, password_hash, role) VALUES ($1, $2, $3, $4)',
      [id, identifiant, hashed, role]
    )

    return res.status(201).json({ id, identifiant, role })
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
    const result = await pool.query(
      'SELECT name, created_at FROM folders ORDER BY created_at DESC'
    )
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
    const { folder } = req.query

    const params = []
    let sql = 'SELECT id, name, mime_type, size, folder, created_at FROM files'

    if (folder) {
      sql += ' WHERE folder = $1'
      params.push(folder)
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

