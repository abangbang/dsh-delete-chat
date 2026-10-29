/**
 * dsh-delete-chat — host half.
 *
 * DSH ships archive-only session management: `workspace.json` keeps the
 * accounting, the JSONL store under `<root>/<project>/session-<uuid>/` is
 * append-only, and the persistence backend documents "no delete interface".
 * This plugin adds the missing verb, in the only order that is safe on a live
 * host:
 *
 *   1. `archiveSession(id, { stopActivity: true })` — hides the row from every
 *      grouping surface immediately, stops a running turn, and gates later
 *      `agent/pre-step` wakes, so nothing re-appears while files go away.
 *   2. remove `<root>/<project>/session-<uuid>/` (and the flat
 *      `<root>/session-<uuid>/` layout when a deployment uses it).
 *   3. prune `workspace.json` accounting (`sessionIds`, `archivedSessionIds`,
 *      `pinnedSessionIds`) with an atomic replace, keeping a `.bak-<stamp>`.
 *   4. drop the session's projection cache entries.
 *
 * The plugin never disposes a live session object: DSH's `sessions` service
 * exposes `create`/`get`/`list` only, and archive already removes the session
 * from every user-visible surface. The remaining in-memory object is inert —
 * archived sessions run no model step — and disappears on the next restart.
 *
 * @module dsh-delete-chat
 */

import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Plugin row id used by the profile loader. */
export const name = 'dsh-delete-chat'

/** Services that must exist before the routes mount. */
export const inject = ['webServer', 'connection']

/** Route prefix owned by this plugin. The desktop shell fences it per request. */
const PREFIX = '/delete-chat/api'

/**
 * Session ids are `session-<uuid>` in every layout this plugin has observed.
 * The character class is deliberately narrow: an id reaches `join()` and
 * `rm()`, so separators, dot segments and drive letters must be impossible
 * before the value is ever used as a path segment.
 */
const SESSION_ID_PATTERN = /^session-[0-9A-Za-z][0-9A-Za-z._-]{0,80}$/

/** Projection-cache files are `session_projcache/<id>.*`; match by exact stem. */
const PROJECTION_CACHE_DIRS = ['session_projcache']

// ── HTTP plumbing ──────────────────────────────────────────────────────────

/**
 * Write one JSON response.
 * @param res - Node response.
 * @param status - HTTP status code.
 * @param body - Serialisable payload.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/**
 * Read a JSON request body with a hard size ceiling.
 * @param req - Node request.
 * @returns the parsed object (`{}` for an empty body).
 */
async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 1 << 20) throw new PluginError('bad-request', 'request body too large', 413)
    chunks.push(chunk)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new PluginError('bad-request', 'body must be a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof PluginError) throw error
    throw new PluginError('bad-request', `invalid JSON body: ${String(error)}`)
  }
}

/** A failure with an HTTP shape. */
class PluginError extends Error {
  /**
   * @param code - Stable machine code.
   * @param message - Human message.
   * @param status - HTTP status (default 400).
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'DeleteChatError'
    this.code = code
    this.status = status
  }
}

/**
 * Validate a session id before it is used as a path segment.
 * @param value - Raw request value.
 * @returns the validated id.
 */
function requireSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new PluginError('bad-request', 'sessionId must look like "session-<uuid>"')
  }
  return value
}

// ── Layout discovery ───────────────────────────────────────────────────────

/**
 * The sessions root: the persistence service's resolved root when available,
 * `~/.dsh/sessions` otherwise (the stock desktop layout).
 * @param ctx - host plugin context.
 * @returns absolute sessions root.
 */
function sessionsRootOf(ctx) {
  const persistence = ctx.get('sessionPersistence')
  const root = persistence?.root ?? persistence?.config?.root
  if (typeof root === 'string' && root !== '') return resolve(root)
  return join(homedir(), '.dsh', 'sessions')
}

/**
 * The DSH home that holds `storages/`.
 *
 * The stock layout is `<home>/sessions`, so the parent of the root is the home.
 * A custom root (`/var/lib/dsh/logs`, `D:\logs`) says nothing about where the
 * store lives, and guessing its parent would write a `workspace.json` that no
 * host ever loads — so that case reads the same `DSH_HOME` override the host's
 * own `dsh-home-paths` uses, then falls back to `~/.dsh`.
 *
 * @param ctx - host plugin context.
 * @returns absolute DSH home.
 */
function dshHomeOf(ctx) {
  const root = sessionsRootOf(ctx)
  if (basename(root) === 'sessions') return dirname(root)
  const override = process.env.DSH_HOME
  if (typeof override === 'string' && override.trim() !== '') return resolve(override)
  return join(homedir(), '.dsh')
}

/**
 * Recursive byte size of one directory.
 * @param path - directory to measure.
 * @returns total bytes (0 when it cannot be read).
 */
async function directorySize(path) {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directorySize(child)
    else if (entry.isFile()) total += await stat(child).then((s) => s.size, () => 0)
  }
  return total
}

/**
 * Every on-disk directory that belongs to one session. Both documented layouts
 * are covered: per-project (`<root>/<project>/session-<uuid>`) and flat
 * (`<root>/session-<uuid>`).
 * @param ctx - host plugin context.
 * @param sessionId - validated session id.
 * @returns `{ root, matches }` where each match carries its path and size.
 */
async function locateSession(ctx, sessionId) {
  const root = sessionsRootOf(ctx)
  const matches = []

  const flat = join(root, sessionId)
  const flatInfo = await stat(flat).catch(() => undefined)
  if (flatInfo?.isDirectory()) {
    matches.push({ path: flat, project: null, bytes: await directorySize(flat) })
  }

  let projects = []
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch {
    projects = []
  }
  for (const entry of projects) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, sessionId)
    const info = await stat(candidate).catch(() => undefined)
    if (info?.isDirectory()) {
      matches.push({ path: candidate, project: entry.name, bytes: await directorySize(candidate) })
    }
  }
  return { root, matches }
}

/**
 * Read `workspace.json`, or `undefined` when the profile has never written one.
 * @param home - DSH home.
 * @returns the parsed store or undefined.
 */
async function readWorkspaceStore(home) {
  const file = join(home, 'storages', 'workspace.json')
  try {
    return { file, value: JSON.parse(await readFile(file, 'utf8')) }
  } catch {
    return undefined
  }
}

/**
 * Drop every reference to one session id from the workspace store, writing
 * through a sibling temp file and an atomic rename so a crash cannot leave a
 * half-written store behind. The original is kept as `<file>.bak-<stamp>`.
 * @param home - DSH home.
 * @param sessionId - id to forget.
 * @returns per-collection counts of removed references, or undefined when no
 *   store exists.
 */
async function pruneWorkspaceStore(home, sessionId) {
  const read = await readWorkspaceStore(home)
  if (read === undefined) return undefined

  const { file, value: store } = read
  const removed = { workspaces: 0, archived: 0, pinned: 0 }

  const drop = (list) => {
    const before = Array.isArray(list) ? list.length : 0
    const after = (Array.isArray(list) ? list : []).filter((id) => id !== sessionId)
    return { after, dropped: before - after.length }
  }

  const global = store.global ?? {}
  const archived = drop(global.archivedSessionIds)
  const pinned = drop(global.pinnedSessionIds)
  global.archivedSessionIds = archived.after
  global.pinnedSessionIds = pinned.after
  store.global = global
  removed.archived += archived.dropped
  removed.pinned += pinned.dropped

  const tables = store.tables?.workspaces
  if (tables !== undefined && tables !== null && typeof tables === 'object') {
    for (const row of Object.values(tables)) {
      if (row === null || typeof row !== 'object') continue
      const next = drop(row.sessionIds)
      row.sessionIds = next.after
      removed.workspaces += next.dropped
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(file, `${file}.bak-${stamp}`)
  await rename(temporary, file)
  return removed
}

/**
 * Remove projection-cache artefacts whose name starts with the session id.
 * @param home - DSH home.
 * @param sessionId - id to purge.
 * @returns number of removed files.
 */
async function pruneProjectionCache(home, sessionId) {
  let removed = 0
  const failures = []
  for (const dir of PROJECTION_CACHE_DIRS) {
    const path = join(home, 'storages', dir)
    let entries = []
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      const stem = name.includes('.') ? name.slice(0, name.indexOf('.')) : name
      if (stem !== sessionId && !name.startsWith(`${sessionId}.`)) continue
      const target = join(path, name)
      try {
        await rm(target, { recursive: true, force: true })
        removed += 1
      } catch (error) {
        // A cache entry is disposable, but a refused removal is still work that
        // did not happen: report it instead of counting it as cleared.
        failures.push({ path: target, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return { removed, failures }
}

// ── The operation ──────────────────────────────────────────────────────────

/**
 * Resolve the workspace registry service under any of the names a deployment
 * may have registered it as.
 * @param ctx - host plugin context.
 * @returns the service face, or undefined.
 */
function workspaceServiceOf(ctx) {
  for (const service of ['workspaces', 'workspace', 'workspaceRegistry']) {
    let face
    try {
      face = ctx.get(service)
    } catch {
      face = undefined
    }
    if (face !== undefined && face !== null && typeof face.archiveSession === 'function') return face
  }
  return undefined
}

/**
 * Describe one session without touching it: what a confirmation dialog needs.
 * @param ctx - host plugin context.
 * @param sessionId - validated id.
 * @returns size, location and live-state summary.
 */
export async function previewSession(ctx, sessionId) {
  const id = requireSessionId(sessionId)
  const located = await locateSession(ctx, id)
  const live = ctx.get('sessions')?.get?.(id) !== undefined
  return {
    sessionId: id,
    root: located.root,
    directories: located.matches.map((match) => ({
      path: match.path,
      project: match.project,
      bytes: match.bytes,
    })),
    bytes: located.matches.reduce((sum, match) => sum + match.bytes, 0),
    onDisk: located.matches.length > 0,
    live,
  }
}

/**
 * Delete one session: archive, remove files, prune accounting.
 *
 * Archiving comes first and is best-effort — a session that is unknown to the
 * workspace registry (already archived, or created outside it) still gets its
 * files removed. A failure to archive is reported, never fatal.
 *
 * @param ctx - host plugin context.
 * @param sessionId - validated id.
 * @returns a report of what happened, field by field.
 */
export async function deleteSession(ctx, sessionId) {
  const id = requireSessionId(sessionId)
  const home = dshHomeOf(ctx)
  const before = await previewSession(ctx, id)

  let archived = 'skipped'
  const workspaces = workspaceServiceOf(ctx)
  if (workspaces !== undefined) {
    try {
      await workspaces.archiveSession(id, { stopActivity: true })
      archived = 'ok'
    } catch (error) {
      // The archive set may already contain the id, or the registry may not
      // know a session whose files survive on disk. Neither blocks deletion.
      archived = `failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const removedDirs = []
  const failures = []
  for (const match of before.directories) {
    try {
      await rm(match.path, { recursive: true, force: true })
      removedDirs.push(match.path)
    } catch (error) {
      failures.push({ path: match.path, error: error instanceof Error ? error.message : String(error) })
    }
  }

  let pruned
  try {
    pruned = await pruneWorkspaceStore(home, id)
  } catch (error) {
    failures.push({ path: join(home, 'storages', 'workspace.json'), error: error instanceof Error ? error.message : String(error) })
    pruned = undefined
  }

  const cache = await pruneProjectionCache(home, id)
  // A cache entry that would not go away does not make the session undeleted —
  // the log is already gone — so `deleted` is decided before these are merged.
  const deleted = failures.length === 0 && removedDirs.length > 0
  for (const failure of cache.failures) failures.push(failure)

  return {
    sessionId: id,
    archived,
    removedDirectories: removedDirs,
    freedBytes: before.bytes,
    workspaceAccounting: pruned ?? null,
    projectionCacheRemoved: cache.removed,
    failures,
    deleted: failures.length === 0 && removedDirs.length > 0,
  }
}

/**
 * List every session directory under the root, newest first, with size and
 * archive state — the data behind the plugin's own picker and a quick way for
 * an operator to see what a profile is actually holding.
 * @param ctx - host plugin context.
 * @returns one row per session directory.
 */
export async function listSessions(ctx) {
  const root = sessionsRootOf(ctx)
  const home = dshHomeOf(ctx)
  const store = (await readWorkspaceStore(home))?.value
  const archived = new Set(store?.global?.archivedSessionIds ?? [])
  const pinned = new Set(store?.global?.pinnedSessionIds ?? [])

  const rows = []
  for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue
    const projectPath = join(root, project.name)
    for (const entry of await readdir(projectPath, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue
      const path = join(projectPath, entry.name)
      const info = await stat(path).catch(() => undefined)
      rows.push({
        sessionId: entry.name,
        project: project.name,
        path,
        bytes: await directorySize(path),
        updatedAt: info?.mtime?.toISOString?.() ?? null,
        archived: archived.has(entry.name),
        pinned: pinned.has(entry.name),
        live: ctx.get('sessions')?.get?.(entry.name) !== undefined,
      })
    }
  }
  rows.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  return { root, rows }
}

// ── Mount ──────────────────────────────────────────────────────────────────

/**
 * Mount the plugin: one fenced POST prefix whose last segment names the
 * operation, dispatched through an own-property table.
 * @param ctx - host plugin context (webServer + connection).
 */
export function apply(ctx) {
  /** Request admission: the host's own fence rejects foreign origins. */
  const admitted = (req) => {
    const connection = ctx.get('connection')
    return typeof connection?.requestRejection !== 'function' || connection.requestRejection(req) === undefined
  }

  const api = {
    list: async () => listSessions(ctx),
    preview: async (payload) => previewSession(ctx, payload.sessionId),
    delete: async (payload) => deleteSession(ctx, payload.sessionId),
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!admitted(req)) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'POST only' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith(`${PREFIX}/`) ? pathname.slice(PREFIX.length + 1) : undefined
      try {
        if (method === undefined || method === '' || method.includes('/')) {
          throw new PluginError('not-found', 'unknown method', 404)
        }
        if (!Object.hasOwn(api, method)) {
          throw new PluginError('not-found', `unknown method "${method}"`, 404)
        }
        const payload = await readJson(req)
        const value = await api[method](payload)
        sendJson(res, 200, { ok: true, value })
      } catch (error) {
        const status = error instanceof PluginError ? error.status : 500
        sendJson(res, status, {
          ok: false,
          error: {
            code: error instanceof PluginError ? error.code : 'internal',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
    },
  }), 'dsh-delete-chat: /delete-chat/api routes')
}

/** Internals exposed for the offline fixture test. Not part of the plugin API. */
export const __testing = {
  dshHomeOf,
  directorySize,
  locateSession,
  pruneProjectionCache,
  pruneWorkspaceStore,
  requireSessionId,
  sessionsRootOf,
}
