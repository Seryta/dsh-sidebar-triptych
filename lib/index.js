/**
 * dsh-sidebar-triptych — host half.
 *
 * 职责只有一件事：把「三段折叠状态」存成 Host 侧的一份状态，并让所有连上来的
 * 浏览器保持同一份值（跨设备同步）。
 *
 *   GET  /plugins/dsh-sidebar-triptych/state   读取当前状态
 *   POST /plugins/dsh-sidebar-triptych/state   写入（body: { collapsed: {...} }）
 *   GET  /plugins/dsh-sidebar-triptych/events  SSE：状态变化实时推送
 *
 * 状态文件：$DSH_HOME/sidebar-triptych.json（默认 ~/.dsh/sidebar-triptych.json）
 *
 * 语义：collapsed[key] === true 表示该区折叠。
 * 默认：panels 折叠、foot 折叠、region 展开（只留工作区）。
 *
 * 这里不碰会话、不读项目文件、不联网；只读写一个小 JSON。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-sidebar-triptych'
export const inject = ['webServer']

const PREFIX = '/plugins/dsh-sidebar-triptych'
const KEYS = ['panels', 'region', 'foot']
const DEFAULT_COLLAPSED = { panels: true, region: false, foot: true }
const MAX_BODY = 8 * 1024
const HEARTBEAT_MS = 25_000

function stateFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'sidebar-triptych.json')
}

function normalizeCollapsed(input) {
  const out = { ...DEFAULT_COLLAPSED }
  if (input && typeof input === 'object') {
    for (const key of KEYS) {
      const value = input[key]
      if (typeof value === 'boolean') out[key] = value
    }
  }
  return out
}

function readState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      collapsed: normalizeCollapsed(parsed && parsed.collapsed),
      rev: Number.isFinite(parsed && parsed.rev) ? Math.trunc(parsed.rev) : 0,
      updatedAt: typeof (parsed && parsed.updatedAt) === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return { collapsed: { ...DEFAULT_COLLAPSED }, rev: 0, updatedAt: new Date().toISOString() }
  }
}

/** 原子写：先写临时文件再 rename，避免半截 JSON。失败只告警，不打断 UI。 */
function writeState(state) {
  const file = stateFile()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
    return true
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
    console.warn('[dsh-sidebar-triptych] state write failed:', error && error.message ? error.message : error)
    return false
  }
}

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers && req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apply(ctx) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const subscribers = new Set()
  let state = readState()

  const broadcast = () => {
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`
    for (const res of subscribers) {
      try {
        res.write(payload)
      } catch {
        subscribers.delete(res)
      }
    }
  }

  const stateHandler = async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin rejected' })
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end()
        return
      }
      return sendJson(res, 200, state)
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let body
    try {
      body = await readBody(req)
    } catch (error) {
      return sendJson(res, 413, { error: error && error.message ? error.message : 'bad body' })
    }
    let parsed
    try {
      parsed = body === '' ? {} : JSON.parse(body)
    } catch {
      return sendJson(res, 400, { error: 'invalid json' })
    }
    const collapsed = normalizeCollapsed(parsed && parsed.collapsed)
    state = { collapsed, rev: state.rev + 1, updatedAt: new Date().toISOString() }
    writeState(state)
    broadcast()
    return sendJson(res, 200, state)
  }

  const eventsHandler = (req, res) => {
    if (!sameOrigin(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('cross-origin rejected')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    res.write(`retry: 3000\n\n`)
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
    subscribers.add(res)

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`)
      } catch {
        clearInterval(heartbeat)
        subscribers.delete(res)
      }
    }, HEARTBEAT_MS)
    if (typeof heartbeat.unref === 'function') heartbeat.unref()

    const cleanup = () => {
      clearInterval(heartbeat)
      subscribers.delete(res)
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
    res.on('close', cleanup)
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/state`, handler: stateHandler }),
    'dsh-sidebar-triptych: state route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/events`, handler: eventsHandler }),
    'dsh-sidebar-triptych: events route',
  )
  ctx.effect(() => () => {
    for (const res of subscribers) {
      try { res.end() } catch { /* ignore */ }
    }
    subscribers.clear()
  }, 'dsh-sidebar-triptych: close subscribers')
}
