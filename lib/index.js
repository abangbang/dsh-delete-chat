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

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
 * Newest modification time under one directory.
 *
 * A session's own last-activity signal is the mtime of its log: `rename` keeps
 * file mtimes, so this survives the move into the trash even though the directory
 * itself is stamped by the move.
 *
 * @param path - directory to scan.
 * @returns ISO timestamp, or undefined when nothing could be read.
 */
async function newestMtime(path) {
  let newest = 0
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      const nested = await newestMtime(child)
      if (nested !== undefined) newest = Math.max(newest, Date.parse(nested))
      continue
    }
    const info = await stat(child).catch(() => undefined)
    if (info !== undefined) newest = Math.max(newest, info.mtimeMs)
  }
  return newest === 0 ? undefined : new Date(newest).toISOString()
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

// ── Trash ──────────────────────────────────────────────────────────────────

/**
 * Deleting a session moves it here instead of unlinking it. The directory stays
 * on the same volume as the sessions root (`~/.dsh/session-trash` next to
 * `~/.dsh/sessions`), so the move is a rename: instant, atomic, and reversible
 * without re-reading a single log line.
 */
const TRASH_DIR = 'session-trash'

/** Manifest that keeps titles, sizes and timestamps without decoding zstd logs. */
const TRASH_MANIFEST = 'index.json'

/** Project directory name used when a session lived in the flat layout. */
const FLAT_PROJECT = 'flat'

/**
 * Absolute trash root under a DSH home.
 * @param home - DSH home.
 * @returns the trash directory path.
 */
function trashRootOf(home) {
  return join(home, TRASH_DIR)
}

/**
 * Read the trash manifest, tolerating a missing or malformed file.
 * @param home - DSH home.
 * @returns `{ file, entries }`.
 */
async function readTrashManifest(home) {
  const file = join(trashRootOf(home), TRASH_MANIFEST)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.sessionId === 'string')
      : []
    return { file, entries }
  } catch {
    return { file, entries: [] }
  }
}

/**
 * Replace the trash manifest in one atomic step.
 * @param home - DSH home.
 * @param entries - entries to persist, newest first.
 */
async function writeTrashManifest(home, entries) {
  const root = trashRootOf(home)
  await mkdir(root, { recursive: true })
  const file = join(root, TRASH_MANIFEST)
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify({ version: 1, entries }, undefined, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Move a directory, falling back to copy+remove when the two paths live on
 * different volumes (`EXDEV`) — the only case where a trash move is not a rename.
 * @param from - source directory.
 * @param to - destination directory.
 * @returns `'renamed'` or `'copied'`.
 */
async function moveDirectory(from, to) {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
    return 'renamed'
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true, force: true })
    await rm(from, { recursive: true, force: true })
    return 'copied'
  }
}

/**
 * Find one session inside the trash, by id, without trusting the manifest.
 * @param home - DSH home.
 * @param sessionId - validated id.
 * @returns `{ path, project }` or undefined.
 */
async function locateTrashed(home, sessionId) {
  const root = trashRootOf(home)
  for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue
    const candidate = join(root, project.name, sessionId)
    const info = await stat(candidate).catch(() => undefined)
    if (info?.isDirectory()) return { path: candidate, project: project.name === FLAT_PROJECT ? null : project.name }
  }
  return undefined
}

/**
 * Collect the ids of one request, de-duplicated, each one validated.
 * @param payload - request body with `sessionId` or `sessionIds`.
 * @returns validated ids.
 */
function requireSessionIds(payload) {
  const raw = Array.isArray(payload?.sessionIds) ? payload.sessionIds : [payload?.sessionId]
  const ids = []
  for (const value of raw) {
    const id = requireSessionId(value)
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length === 0) throw new PluginError('bad-request', 'no session selected')
  return ids
}

/**
 * Match two paths the way the host would: case-insensitively on Windows, and
 * tolerating a trailing separator on both.
 * @param left - first path.
 * @param right - second path.
 * @returns whether they name the same directory.
 */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const normalize = (value) => resolve(value).replace(/[\\/]+$/, '')
  const a = normalize(left)
  const b = normalize(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Put one session id back into the workspace accounting, under the workspace the
 * session's own directory belongs to (or the default one).
 * @param home - DSH home.
 * @param sessionId - id to re-account.
 * @param cwd - stored working directory, used to pick the workspace row.
 * @returns true when a reference was added.
 */
async function reinsertIntoWorkspace(home, sessionId, cwd) {
  const read = await readWorkspaceStore(home)
  if (read === undefined) return false
  const { file, value: store } = read
  const tables = store.tables?.workspaces
  if (tables === undefined || tables === null || typeof tables !== 'object') return false

  const rows = Object.entries(tables).filter(([, row]) => row !== null && typeof row === 'object')
  const byCwd = rows.find(([, row]) => samePath(row.path, cwd))
  const byDefault = rows.find(([id]) => id === store.global?.defaultWorkspaceId)
  const target = byCwd ?? byDefault ?? rows[0]
  if (target === undefined) return false

  const row = target[1]
  // Dedupe defensively: a live projection insert may already have landed.
  const current = [...new Set(Array.isArray(row.sessionIds) ? row.sessionIds : [])]
  if (current.includes(sessionId)) return false
  row.sessionIds = [...current, sessionId]
  row.updatedAt = new Date().toISOString()

  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await rename(temporary, file)
  return true
}

/**
 * Which workspace a restored session belongs to: the row whose directory owns
 * the stored cwd, else the default workspace, else the first row.
 * @param home - DSH home.
 * @param cwd - stored working directory.
 * @returns the workspace id, or undefined when no store exists.
 */
async function workspaceIdFor(home, cwd) {
  const read = await readWorkspaceStore(home)
  if (read === undefined) return undefined
  const store = read.value
  const tables = store.tables?.workspaces
  if (tables === undefined || tables === null || typeof tables !== 'object') return undefined
  const rows = Object.entries(tables).filter(([, row]) => row !== null && typeof row === 'object')
  const byCwd = rows.find(([, row]) => samePath(row.path, cwd))
  const byDefault = rows.find(([id]) => id === store.global?.defaultWorkspaceId)
  return (byCwd ?? byDefault ?? rows[0])?.[0]
}

/**
 * Soft delete: archive, move the directory into the trash, drop the accounting.
 *
 * The order matches the permanent path for one reason: archiving first hides the
 * row and stops running work, so nothing re-materializes the session while its
 * directory is being moved.
 *
 * @param ctx - host plugin context.
 * @param payload - `{ sessionId, displayTitle?, cwd? }`.
 * @returns what happened, field by field.
 */
export async function trashSession(ctx, payload) {
  const id = requireSessionId(payload?.sessionId)
  const home = dshHomeOf(ctx)
  const located = await locateSession(ctx, id)
  if (located.matches.length === 0) {
    throw new PluginError('not-found', `no session directory for "${id}"`, 404)
  }
  const match = located.matches[0]

  let archived = 'skipped'
  const workspaces = workspaceServiceOf(ctx)
  if (workspaces !== undefined) {
    try {
      await workspaces.archiveSession(id, { stopActivity: true })
      archived = 'ok'
    } catch (error) {
      archived = `failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const destination = join(trashRootOf(home), match.project ?? FLAT_PROJECT, id)
  // A stale copy from an earlier attempt would make rename fail; replace it.
  await rm(destination, { recursive: true, force: true })
  const how = await moveDirectory(match.path, destination)

  let pruned
  try {
    pruned = await pruneWorkspaceStore(home, id)
  } catch {
    pruned = undefined
  }

  const lastActiveAt = await newestMtime(destination)
  const manifest = await readTrashManifest(home)
  const deletedAt = new Date().toISOString()
  const entry = {
    sessionId: id,
    project: match.project,
    displayTitle: typeof payload?.displayTitle === 'string' && payload.displayTitle !== '' ? payload.displayTitle : id,
    cwd: typeof payload?.cwd === 'string' && payload.cwd !== '' ? payload.cwd : undefined,
    bytes: match.bytes,
    lastActiveAt,
    deletedAt,
    how,
  }
  await writeTrashManifest(home, [entry, ...manifest.entries.filter((row) => row.sessionId !== id)])

  return {
    sessionId: id,
    trashed: true,
    archived,
    deletedAt,
    path: destination,
    bytes: match.bytes,
    moved: how,
    workspaceAccounting: pruned ?? null,
  }
}

/**
 * Everything currently in the trash, newest first. The directory tree is the
 * truth: manifest rows whose directory vanished are reported as `missing` and
 * dropped by the next write, and directories the manifest does not know are
 * listed with their id as the title.
 * @param ctx - host plugin context.
 * @returns `{ root, rows, missing }`.
 */
export async function listTrash(ctx) {
  const home = dshHomeOf(ctx)
  const root = trashRootOf(home)
  const manifest = await readTrashManifest(home)
  const known = new Map(manifest.entries.map((entry) => [entry.sessionId, entry]))
  const rows = []

  for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue
    for (const entry of await readdir(join(root, project.name), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue
      const path = join(root, project.name, entry.name)
      const meta = known.get(entry.name)
      const info = await stat(path).catch(() => undefined)
      rows.push({
        sessionId: entry.name,
        project: project.name === FLAT_PROJECT ? null : project.name,
        displayTitle: typeof meta?.displayTitle === 'string' ? meta.displayTitle : entry.name,
        cwd: typeof meta?.cwd === 'string' ? meta.cwd : undefined,
        path,
        bytes: typeof meta?.bytes === 'number' ? meta.bytes : await directorySize(path),
        // Falls back to the newest file mtime for entries trashed before this
        // field existed: the log's own stamp is the honest answer either way.
        lastActiveAt: typeof meta?.lastActiveAt === 'string' ? meta.lastActiveAt : (await newestMtime(path)) ?? null,
        deletedAt: typeof meta?.deletedAt === 'string' ? meta.deletedAt : (info?.mtime?.toISOString?.() ?? null),
      })
      known.delete(entry.name)
    }
  }

  rows.sort((left, right) => String(right.deletedAt ?? '').localeCompare(String(left.deletedAt ?? '')))
  return { root, rows, missing: [...known.values()] }
}

/**
 * Bring trashed sessions back: move the directory home, re-account it, unarchive.
 * @param ctx - host plugin context.
 * @param payload - `{ sessionIds }` or `{ sessionId }`.
 * @returns `{ restored, failures }`.
 */
export async function restoreSessions(ctx, payload) {
  const ids = requireSessionIds(payload)
  const home = dshHomeOf(ctx)
  const sessionsRoot = sessionsRootOf(ctx)
  const manifest = await readTrashManifest(home)
  const restored = []
  const failures = []

  for (const id of ids) {
    const trashed = await locateTrashed(home, id)
    if (trashed === undefined) {
      failures.push({ path: id, error: 'not in the trash' })
      continue
    }
    const meta = manifest.entries.find((entry) => entry.sessionId === id)
    const destination = trashed.project === null
      ? join(sessionsRoot, id)
      : join(sessionsRoot, trashed.project, id)
    try {
      await moveDirectory(trashed.path, destination)
      const workspaces = workspaceServiceOf(ctx)
      const workspaceId = await workspaceIdFor(home, meta?.cwd)
      // A live projection insert makes the row appear without a restart; the
      // store edit below is the fallback when the registry has no such verb.
      if (workspaceId !== undefined && typeof workspaces?.insertSessionBefore === 'function') {
        await workspaces.insertSessionBefore(workspaceId, id).catch(() => {})
      }
      await reinsertIntoWorkspace(home, id, meta?.cwd)
      if (workspaces !== undefined && typeof workspaces.unarchiveSession === 'function') {
        await workspaces.unarchiveSession(id).catch(() => {})
      }
      restored.push({ sessionId: id, path: destination })
    } catch (error) {
      failures.push({ path: trashed.path, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (restored.length > 0) {
    const done = new Set(restored.map((row) => row.sessionId))
    await writeTrashManifest(home, manifest.entries.filter((entry) => !done.has(entry.sessionId)))
  }
  return { restored, failures }
}

/**
 * Permanent deletion, only ever reachable from the trash: unlink the directory,
 * forget the manifest row and clear the projection cache.
 * @param ctx - host plugin context.
 * @param payload - `{ sessionIds }` or `{ sessionId }`.
 * @returns the aggregate report.
 */
export async function purgeSessions(ctx, payload) {
  const ids = requireSessionIds(payload)
  const home = dshHomeOf(ctx)
  const manifest = await readTrashManifest(home)
  const removedDirectories = []
  const failures = []
  let freedBytes = 0
  let cacheRemoved = 0

  for (const id of ids) {
    const trashed = await locateTrashed(home, id)
    if (trashed === undefined) {
      failures.push({ path: id, error: 'not in the trash' })
      continue
    }
    const bytes = await directorySize(trashed.path)
    try {
      await rm(trashed.path, { recursive: true, force: true })
      removedDirectories.push(trashed.path)
      freedBytes += bytes
    } catch (error) {
      failures.push({ path: trashed.path, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    const cache = await pruneProjectionCache(home, id)
    cacheRemoved += cache.removed
    for (const failure of cache.failures) failures.push(failure)
  }

  const purged = new Set(removedDirectories.map((path) => basename(path)))
  const kept = manifest.entries.filter((entry) => !purged.has(entry.sessionId))
  if (kept.length !== manifest.entries.length) await writeTrashManifest(home, kept)

  return {
    sessionIds: [...purged],
    deleted: purged.size > 0 && failures.length === 0,
    removedDirectories,
    freedBytes,
    projectionCacheRemoved: cacheRemoved,
    failures,
  }
}

/**
 * One-click empty: purge every session the trash currently holds.
 * @param ctx - host plugin context.
 * @returns the purge report plus the ids it covered.
 */
export async function emptyTrash(ctx) {
  const listing = await listTrash(ctx)
  const ids = listing.rows.map((row) => row.sessionId)
  if (ids.length === 0) {
    return { sessionIds: [], deleted: false, removedDirectories: [], freedBytes: 0, projectionCacheRemoved: 0, failures: [] }
  }
  return purgeSessions(ctx, { sessionIds: ids })
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
    // Soft delete: the UI never calls `delete`.
    trash: async (payload) => trashSession(ctx, payload),
    trashList: async () => listTrash(ctx),
    restore: async (payload) => restoreSessions(ctx, payload),
    purge: async (payload) => purgeSessions(ctx, payload),
    empty: async () => emptyTrash(ctx),
    // Permanent, single-shot. Kept for the CLI and for scripted cleanup.
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
  FLAT_PROJECT,
  TRASH_DIR,
  listTrash,
  locateTrashed,
  moveDirectory,
  newestMtime,
  purgeSessions,
  readTrashManifest,
  restoreSessions,
  samePath,
  trashRootOf,
  trashSession,
  writeTrashManifest,
  workspaceIdFor,
  dshHomeOf,
  directorySize,
  locateSession,
  pruneProjectionCache,
  pruneWorkspaceStore,
  requireSessionId,
  sessionsRootOf,
}
