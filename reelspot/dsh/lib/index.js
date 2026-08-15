/*
 * dsh-reelspot — Host half (composition plugin, real Node module).
 *
 * Routes:
 *   POST /dsh-reelspot/save       {name, base64} -> <workspaceRoot>/recordings/<name>
 *   POST /dsh-reelspot/transcode  {name(webm), base64} -> transcode to .mp4 via
 *                                 ffmpeg (PATH or REELSPOT_FFMPEG or ffmpeg-static)
 */
import { promises as fsp } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

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

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try { child = spawn(cmd, args, { windowsHide: true }) } catch (e) {
      resolve({ code: -1, stderr: String(e && e.message ? e.message : e) })
      return
    }
    let stderrTail = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch (e) {}
      resolve({ code: -1, stderr: 'timeout' })
    }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stderr: String(e.message || e) }) })
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + String(d)).slice(-600) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code === null ? -1 : code, stderr: stderrTail }) })
  })
}

let ffmpegPath = null // null = not probed yet, '' = not found
async function findFfmpeg() {
  if (ffmpegPath !== null) return ffmpegPath || null
  const candidates = [process.env.REELSPOT_FFMPEG, 'ffmpeg']
  try {
    const req = createRequire(join(process.cwd(), 'package.json'))
    candidates.push(req('ffmpeg-static')) // resolves to a binary path when installed
  } catch (e) { /* ffmpeg-static not installed — fine */ }
  for (const c of candidates) {
    if (!c) continue
    const probe = await run(c, ['-version'], 15000)
    if (probe.code === 0) { ffmpegPath = c; return c }
  }
  ffmpegPath = ''
  return null
}

function workspaceRoot(ctx) {
  const policy = ctx.get('sandboxPolicy')
  return policy && policy.workspaceRoot ? String(policy.workspaceRoot) : process.cwd()
}

async function readRecordingArgs(req) {
  const args = JSON.parse(await readBody(req, MAX_BODY_BYTES))
  const name = String(args && args.name || '').replace(/[^\w.-]+/g, '_')
  const base64 = String(args && args.base64 || '')
  return { name, base64 }
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
          const { name, base64 } = await readRecordingArgs(req)
          if (!base64) { sendJson(res, 400, { ok: false, error: 'empty payload' }); return }
          const dir = join(workspaceRoot(ctx), 'recordings')
          await fsp.mkdir(dir, { recursive: true })
          const out = join(dir, name || `reelspot-${Date.now()}.mp4`)
          await fsp.writeFile(out, Buffer.from(base64, 'base64'))
          sendJson(res, 200, { ok: true, path: out })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error).slice(0, 300) })
        }
      },
    }), 'dsh-reelspot: save route')

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-reelspot/transcode',
      handler: async (req, res) => {
        try {
          const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)
          if (pathname !== '/dsh-reelspot/transcode') { sendJson(res, 404, { ok: false, error: 'not found' }); return }
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST only' }); return }
          const ffmpeg = await findFfmpeg()
          if (!ffmpeg) {
            sendJson(res, 200, { ok: false, error: '主机未检测到 ffmpeg —— 安装后重试（Windows: winget install ffmpeg），或设置环境变量 REELSPOT_FFMPEG 指向 ffmpeg 可执行文件' })
            return
          }
          const { name, base64 } = await readRecordingArgs(req)
          if (!base64) { sendJson(res, 400, { ok: false, error: 'empty payload' }); return }
          const dir = join(workspaceRoot(ctx), 'recordings')
          await fsp.mkdir(dir, { recursive: true })
          const base = (name || `reelspot-${Date.now()}.webm`).replace(/\.webm$/i, '')
          const src = join(dir, base + '.webm')
          const out = join(dir, base + '.mp4')
          await fsp.writeFile(src, Buffer.from(base64, 'base64'))
          const r = await run(ffmpeg, [
            '-y', '-i', src,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
            '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart',
            out,
          ], 10 * 60 * 1000)
          if (r.code === 0) {
            await fsp.rm(src, { force: true })
            sendJson(res, 200, { ok: true, path: out })
          } else {
            await fsp.rm(out, { force: true })
            sendJson(res, 200, { ok: false, error: 'ffmpeg 转码失败: ' + (r.stderr || 'exit ' + r.code).slice(0, 300) })
          }
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error).slice(0, 300) })
        }
      },
    }), 'dsh-reelspot: transcode route')
  },
}
