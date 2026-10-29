/**
 * Trash semantics: soft delete, restore, purge, empty.
 *
 * These are the assertions that make "回收站" mean something: files must land in a
 * sibling directory (so the move is a rename, not a copy), the workspace
 * accounting must follow them out and back, and permanent deletion must only ever
 * be reachable from the trash.
 *
 * Run with: node --test test/trash.test.mjs
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import {
  __testing,
  emptyTrash,
  listTrash,
  purgeSessions,
  restoreSessions,
  trashSession,
} from '../lib/index.js'

const SESSION = 'session-aaaaaaaa-1111-4222-8333-444444444444'
const SIBLING = 'session-bbbbbbbb-1111-4222-8333-444444444444'
const PROJECT = '--C-projects-demo--'
const CWD = join('C:', 'projects', 'demo')

let home
let sessions
let workspaces

/**
 * A workspace registry stand-in that records every call.
 * @returns the fake service.
 */
function createWorkspaces() {
  const calls = { archive: [], unarchive: [], insert: [] }
  return {
    calls,
    async archiveSession(id, options) {
      calls.archive.push({ id, options })
    },
    async unarchiveSession(id) {
      calls.unarchive.push(id)
    },
    async insertSessionBefore(workspaceId, sessionId) {
      calls.insert.push({ workspaceId, sessionId })
    },
  }
}

/**
 * Host-context shim.
 * @param root - sessions root.
 * @returns the shim.
 */
const contextFor = (root) => ({
  get(name) {
    if (name === 'sessionPersistence') return { root }
    if (name === 'sessions') return { get: () => undefined }
    if (name === 'workspaces') return workspaces
    return undefined
  },
})

/**
 * Write one session directory with a fake log.
 * @param id - session id.
 * @param bytes - log size.
 */
async function seedSession(id, bytes = 512) {
  await mkdir(join(sessions, PROJECT, id), { recursive: true })
  await writeFile(join(sessions, PROJECT, id, 'session.v4.jsonl.zstd'), Buffer.alloc(bytes))
}

/**
 * Read the workspace store.
 * @returns parsed JSON.
 */
async function readStore() {
  return JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-trash-'))
  sessions = join(home, 'sessions')
  await mkdir(join(home, 'storages'), { recursive: true })
})

beforeEach(async () => {
  workspaces = createWorkspaces()
  await rm(join(home, 'sessions'), { recursive: true, force: true })
  await rm(join(home, 'session-trash'), { recursive: true, force: true })
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
    global: { archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: 'w1', workspaceIds: ['w1'] },
    tables: { workspaces: { w1: { path: CWD, title: 'demo', sessionIds: [SESSION, SIBLING] } } },
  }, null, 2)}\n`)
  await seedSession(SESSION)
  await seedSession(SIBLING)
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

describe('layout', () => {
  it('keeps the trash beside the sessions root, so a move is a rename', () => {
    assert.equal(__testing.trashRootOf(home), join(home, 'session-trash'))
  })
})

describe('soft delete', () => {
  it('moves the directory out of the sessions root and records it', async () => {
    const ctx = contextFor(sessions)
    const report = await trashSession(ctx, { sessionId: SESSION, displayTitle: 'AI 助手功能介绍', cwd: CWD })

    assert.equal(report.trashed, true)
    assert.equal(report.moved, 'renamed')
    assert.equal(report.archived, 'ok')
    assert.equal(report.path, join(home, 'session-trash', PROJECT, SESSION))
    assert.equal(report.bytes, 512)

    await assert.rejects(stat(join(sessions, PROJECT, SESSION)), 'the session must leave the sessions root')
    assert.ok(await stat(join(home, 'session-trash', PROJECT, SESSION, 'session.v4.jsonl.zstd')))

    const manifest = await __testing.readTrashManifest(home)
    assert.equal(manifest.entries.length, 1)
    assert.equal(manifest.entries[0].sessionId, SESSION)
    assert.equal(manifest.entries[0].displayTitle, 'AI 助手功能介绍')
    assert.equal(manifest.entries[0].cwd, CWD)
    assert.ok(typeof manifest.entries[0].deletedAt === 'string')
  })

  it('archives first, so the row is hidden while the move happens', async () => {
    await trashSession(contextFor(sessions), { sessionId: SESSION })
    assert.equal(workspaces.calls.archive.length, 1)
    assert.equal(workspaces.calls.archive[0].id, SESSION)
    assert.deepEqual(workspaces.calls.archive[0].options, { stopActivity: true })
  })

  it('drops the workspace accounting for the trashed session only', async () => {
    await trashSession(contextFor(sessions), { sessionId: SESSION })
    const store = await readStore()
    assert.deepEqual(store.tables.workspaces.w1.sessionIds, [SIBLING])
  })

  it('refuses an id with no directory, instead of inventing one', async () => {
    await assert.rejects(
      trashSession(contextFor(sessions), { sessionId: 'session-ffffffff-1111-4222-8333-444444444444' }),
      /no session directory/,
    )
  })

  it('replaces a stale copy instead of failing on rename', async () => {
    await mkdir(join(home, 'session-trash', PROJECT, SESSION), { recursive: true })
    const report = await trashSession(contextFor(sessions), { sessionId: SESSION })
    assert.equal(report.trashed, true)
    assert.equal((await __testing.readTrashManifest(home)).entries.length, 1)
  })
})

describe('listing', () => {
  it('reports title, size and timestamp, newest first', async () => {
    await trashSession(contextFor(sessions), { sessionId: SESSION, displayTitle: 'first' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await trashSession(contextFor(sessions), { sessionId: SIBLING, displayTitle: 'second' })

    const listing = await listTrash(contextFor(sessions))
    assert.equal(listing.rows.length, 2)
    assert.equal(listing.rows[0].displayTitle, 'second', 'newest first')
    assert.equal(listing.rows[1].displayTitle, 'first')
    assert.ok(listing.rows.every((row) => row.bytes === 512))
  })

  it('carries the trash path, the size and both timestamps', async () => {
    const logPath = join(sessions, PROJECT, SESSION, 'session.v4.jsonl.zstd')
    const before = await stat(logPath)
    await trashSession(contextFor(sessions), { sessionId: SESSION, displayTitle: 'demo' })

    const listing = await listTrash(contextFor(sessions))
    const row = listing.rows[0]
    assert.equal(row.path, join(home, 'session-trash', PROJECT, SESSION), 'the row names where it lives now')
    assert.equal(row.bytes, 512)
    assert.equal(row.lastActiveAt, new Date(before.mtimeMs).toISOString(), 'rename keeps the log mtime, so it survives the move')
    assert.match(String(row.deletedAt), /^\d{4}-\d{2}-\d{2}T/)
  })

  it('trusts the directory tree: unknown dirs appear, vanished rows are reported', async () => {
    await trashSession(contextFor(sessions), { sessionId: SESSION, displayTitle: 'known' })
    const stranger = 'session-cccccccc-1111-4222-8333-444444444444'
    await mkdir(join(home, 'session-trash', PROJECT, stranger), { recursive: true })

    let listing = await listTrash(contextFor(sessions))
    assert.deepEqual(listing.rows.map((row) => row.sessionId).sort(), [SESSION, stranger].sort())
    assert.ok(listing.rows.some((row) => row.sessionId === stranger && row.displayTitle === stranger))
    assert.equal(listing.missing.length, 0, 'a directory the manifest knows nothing about is simply listed')

    // A manifest row whose directory vanished is reported, not silently dropped.
    await rm(join(home, 'session-trash', PROJECT, SESSION), { recursive: true, force: true })
    listing = await listTrash(contextFor(sessions))
    assert.deepEqual(listing.rows.map((row) => row.sessionId), [stranger])
    assert.equal(listing.missing.length, 1)
    assert.equal(listing.missing[0].sessionId, SESSION)
  })
})

describe('restore', () => {
  it('puts the directory back and re-accounts it', async () => {
    const ctx = contextFor(sessions)
    await trashSession(ctx, { sessionId: SESSION, displayTitle: 'demo', cwd: CWD })
    const report = await restoreSessions(ctx, { sessionIds: [SESSION] })

    assert.equal(report.restored.length, 1)
    assert.deepEqual(report.failures, [])
    assert.ok(await stat(join(sessions, PROJECT, SESSION)), 'the session returns to its project')

    const store = await readStore()
    assert.ok(store.tables.workspaces.w1.sessionIds.includes(SESSION), 'the row comes back')

    assert.equal(workspaces.calls.insert.length, 1, 'the live projection is asked first')
    assert.equal(workspaces.calls.insert[0].workspaceId, 'w1')
    assert.deepEqual(workspaces.calls.unarchive, [SESSION])
    assert.equal((await __testing.readTrashManifest(home)).entries.length, 0)
  })

  it('reports an id that is not in the trash instead of throwing the batch away', async () => {
    await trashSession(contextFor(sessions), { sessionId: SESSION })
    const report = await restoreSessions(contextFor(sessions), {
      sessionIds: [SESSION, 'session-ffffffff-1111-4222-8333-444444444444'],
    })
    assert.equal(report.restored.length, 1)
    assert.equal(report.failures.length, 1)
    assert.match(report.failures[0].error, /not in the trash/)
  })
})

describe('permanent deletion', () => {
  it('is only reachable from the trash', async () => {
    const ctx = contextFor(sessions)
    // The sessions root is untouched by purge: the id is resolved inside the trash.
    const report = await purgeSessions(ctx, { sessionIds: [SESSION] })
    assert.equal(report.removedDirectories.length, 0)
    assert.equal(report.failures.length, 1)
    assert.ok(await stat(join(sessions, PROJECT, SESSION)), 'a live session is never purged')
  })

  it('removes the directory, frees its bytes and forgets the row', async () => {
    const ctx = contextFor(sessions)
    await trashSession(ctx, { sessionId: SESSION })
    const report = await purgeSessions(ctx, { sessionIds: [SESSION] })

    assert.deepEqual(report.sessionIds, [SESSION])
    assert.equal(report.deleted, true)
    assert.equal(report.freedBytes, 512)
    await assert.rejects(stat(join(home, 'session-trash', PROJECT, SESSION)))
    assert.equal((await __testing.readTrashManifest(home)).entries.length, 0)
  })

  it('purges a multi-selection and reports the ones that missed', async () => {
    const ctx = contextFor(sessions)
    await trashSession(ctx, { sessionId: SESSION })
    await trashSession(ctx, { sessionId: SIBLING })
    const report = await purgeSessions(ctx, {
      sessionIds: [SESSION, SIBLING, 'session-ffffffff-1111-4222-8333-444444444444'],
    })
    assert.equal(report.removedDirectories.length, 2)
    assert.equal(report.freedBytes, 1024)
    assert.equal(report.failures.length, 1)
    assert.equal(report.deleted, false, 'a partial batch is not a clean deletion')
  })

  it('empties everything in one call', async () => {
    const ctx = contextFor(sessions)
    await trashSession(ctx, { sessionId: SESSION })
    await trashSession(ctx, { sessionId: SIBLING })

    const report = await emptyTrash(ctx)
    assert.equal(report.removedDirectories.length, 2)
    assert.equal(report.deleted, true)
    const listing = await listTrash(ctx)
    assert.equal(listing.rows.length, 0)
    assert.equal(listing.missing.length, 0)
  })

  it('is a no-op on an empty trash', async () => {
    const report = await emptyTrash(contextFor(sessions))
    assert.deepEqual(report.sessionIds, [])
    assert.equal(report.deleted, false)
  })
})
