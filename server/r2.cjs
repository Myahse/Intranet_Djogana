'use strict'

const crypto = require('crypto')
const fs = require('fs')

/**
 * Cloudflare R2 (S3-compatible). Free tier: 10 GB + 1M writes + 10M reads / month.
 *
 * Env:
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_PUBLIC_BASE_URL  optional, e.g. https://pub-xxxxx.r2.dev
 */

function hmac(key, str) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest()
}

function hashHex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

function getConfig() {
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim()
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim()
  const bucket = (process.env.R2_BUCKET || '').trim()
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBase,
    host: `${accountId}.r2.cloudflarestorage.com`,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
  }
}

function isConfigured() {
  return Boolean(getConfig())
}

function encodeKey(key) {
  return String(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function objectKey(directionCode, folder, fileId, fileName) {
  const code = String(directionCode || 'DEF').replace(/[^A-Za-z0-9_-]/g, '') || 'DEF'
  const folderPart = String(folder || 'default')
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 180) || 'default'
  const safeName = String(fileName || 'document')
    .replace(/^.*[/\\]/, '')
    .replace(/[^\w.\-()+ ]+/g, '_')
    .slice(0, 120) || 'document'
  return `intranet/${code}/${folderPart}/${fileId}/${safeName}`
}

function presign({ method, key, contentType, expiresSec = 3600, extraQuery = {} }) {
  const cfg = getConfig()
  if (!cfg) throw new Error('R2 is not configured')

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`
  const credential = `${cfg.accessKeyId}/${credentialScope}`
  const encodedKey = encodeKey(key)
  const canonicalUri = `/${cfg.bucket}/${encodedKey}`

  const signedHeaders = contentType ? 'content-type;host' : 'host'
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaders,
    ...extraQuery,
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')

  const canonicalHeaders = contentType
    ? `content-type:${contentType}\nhost:${cfg.host}\n`
    : `host:${cfg.host}\n`

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join('\n')

  const kDate = hmac('AWS4' + cfg.secretAccessKey, dateStamp)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

function publicUrlForKey(key) {
  const cfg = getConfig()
  if (!cfg) return null
  if (cfg.publicBase) return `${cfg.publicBase}/${encodeKey(key)}`
  return null
}

function presignPut(key, contentType, expiresSec = 3600) {
  return presign({
    method: 'PUT',
    key,
    contentType: contentType || 'application/octet-stream',
    expiresSec,
  })
}

function presignGet(key, { fileName, contentType, expiresSec = 3600 } = {}) {
  const extraQuery = {}
  if (contentType) extraQuery['response-content-type'] = contentType
  if (fileName) {
    extraQuery['response-content-disposition'] =
      `inline; filename="${String(fileName).replace(/["\\]/g, '')}"`
  }
  return presign({ method: 'GET', key, expiresSec, extraQuery })
}

function readUrl(key, { fileName, contentType } = {}) {
  return publicUrlForKey(key) || presignGet(key, { fileName, contentType, expiresSec: 3600 })
}

async function putFile(localPath, key, contentType) {
  const url = presignPut(key, contentType || 'application/octet-stream', 600)
  const stat = fs.statSync(localPath)
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(stat.size),
    },
    body: fs.createReadStream(localPath),
    duplex: 'half',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 300)}`)
  }
}

async function deleteObject(key) {
  if (!key) return
  try {
    const url = presign({ method: 'DELETE', key, expiresSec: 300 })
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      console.error('[r2] delete failed', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[r2] delete error', err?.message || err)
  }
}

module.exports = {
  isConfigured,
  objectKey,
  presignPut,
  presignGet,
  publicUrlForKey,
  readUrl,
  putFile,
  deleteObject,
}
