/*
 * dsh-reelspot — Host half (composition plugin, real Node module).
 *
 * Registers POST /dsh-reelspot/save: the browser client sends a base64-encoded
 * recording, we write it to <workspaceRoot>/recordings/<name>.
 */
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

const MAX_BODY_BYTES = 1024 * 1024 * 1024 // 1 GB cap for base64 JSON payloads

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > cap) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export default {
  name: 'dsh-reelspot',
  inject: ['webServer'],
  apply(ctx) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-reelspot/save',
      handler: async (req, res) => {
        try {
          const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)
          if (pathname !== '/dsh-reelspot/save') { sendJson(res, 404, { ok: false, error: 'not found' }); return }
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST only' }); return }
          const args = JSON.parse(await readBody(req, MAX_BODY_BYTES))
          const name = String(args && args.name || '').replace(/[^\w.-]+/g, '_') || `reelspot-${Date.now()}.mp4`
          const base64 = String(args && args.base64 || '')
          if (!base64) { sendJson(res, 400, { ok: false, error: 'empty payload' }); return }
          const policy = ctx.get('sandboxPolicy')
          const root = policy && policy.workspaceRoot ? String(policy.workspaceRoot) : process.cwd()
          const dir = join(root, 'recordings')
          await fsp.mkdir(dir, { recursive: true })
          const out = join(dir, name)
          await fsp.writeFile(out, Buffer.from(base64, 'base64'))
          sendJson(res, 200, { ok: true, path: out })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error).slice(0, 300) })
        }
      },
    }), 'dsh-reelspot: save route')
  },
}
