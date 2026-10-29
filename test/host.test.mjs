/**
 * Offline fixture test for the host half.
 *
 * Builds a throwaway DSH home (sessions root + storages/workspace.json +
 * projection cache), points the plugin's context shim at it, and asserts that
 * one deletion removes the directory, prunes every accounting reference, clears
 * the cache entry, and refuses a traversal-shaped id before touching a path.
 *
 * Run with: node --test test/host.test.mjs
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  __testing,
  deleteSession,
  listSessions,
  previewSession,
} from '../lib/index.js'

const SESSION = 'session-11111111-2222-3333-4444-555555555555'
const OTHER = 'session-66666666-7777-8888-9999-000000000000'
const PROJECT = '--C-Users-test-demo--'

let home
let ctx

/**
 * Minimal host context: the plugin only asks for `sessionPersistence`,
 * `sessions` and `workspaces`.
 * @param root - sessions root.
 * @returns the shim.
 */
function contextFor(root) {
  return {
    get(name) {
      if (name === 'sessionPersistence') return { root }
      if (name === 'sessions') return { get: () => undefined }
      return undefined
    },
  }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const sessions = join(home, 'sessions')
  await mkdir(join(sessions, PROJECT, SESSION), { recursive: true })
  await mkdir(join(sessions, PROJECT, OTHER), { recursive: true })
  await writeFile(join(sessions, PROJECT, SESSION, 'session.v4.jsonl.zstd'), Buffer.alloc(2048))
  await writeFile(join(sessions, PROJECT, OTHER, 'session.v4.jsonl.zstd'), Buffer.alloc(64))

  const cache = join(home, 'storages', 'session_projcache')
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, `${SESSION}.json`), '{}')
  await writeFile(join(cache, `${OTHER}.json`), '{}')

  await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: 'w1',
      workspaceIds: ['w1'],
      archivedSessionIds: [SESSION],
      pinnedSessionIds: [SESSION],
    },
    tables: {
      workspaces: {
        w1: {
          path: 'C:\\Users\\test\\demo',
          title: 'demo',
          sessionIds: [SESSION, OTHER],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      },
    },
  }, null, 2)}\n`)

  ctx = contextFor(sessions)
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

describe('layout discovery', () => {
  it('finds the sessions root from the persistence service', () => {
    assert.equal(__testing.sessionsRootOf(ctx), join(home, 'sessions'))
  })

  it('derives the DSH home from a root named sessions', () => {
    assert.equal(__testing.dshHomeOf(ctx), home)
  })

  it('locates exactly one directory for the session', async () => {
    const located = await __testing.locateSession(ctx, SESSION)
    assert.equal(located.matches.length, 1)
    assert.equal(located.matches[0].project, PROJECT)
    assert.ok(located.matches[0].bytes >= 2048, `unexpected size ${located.matches[0].bytes}`)
  })
})

describe('id validation', () => {
  for (const bad of ['../../etc', 'session-..%2f..', 'session-', 'other-1111', '', 'session-a/b']) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => __testing.requireSessionId(bad), /must look like/)
    })
  }

  it('accepts a uuid-shaped id', () => {
    assert.equal(__testing.requireSessionId(SESSION), SESSION)
  })
})

describe('preview', () => {
  it('reports size, location and liveness without mutating anything', async () => {
    const preview = await previewSession(ctx, SESSION)
    assert.equal(preview.sessionId, SESSION)
    assert.equal(preview.onDisk, true)
    assert.equal(preview.live, false)
    assert.ok(preview.bytes >= 2048)
    assert.equal(preview.directories[0].project, PROJECT)
    assert.ok(await stat(join(home, 'sessions', PROJECT, SESSION)))
  })
})

describe('delete', () => {
  it('removes the directory, prunes accounting and clears the cache', async () => {
    const report = await deleteSession(ctx, SESSION)

    assert.equal(report.deleted, true)
    assert.deepEqual(report.failures, [])
    assert.equal(report.removedDirectories.length, 1)
    assert.ok(report.freedBytes >= 2048)
    assert.equal(report.archived, 'skipped', 'no workspace service in the shim')
    assert.deepEqual(report.workspaceAccounting, { workspaces: 1, archived: 1, pinned: 1 })
    assert.equal(report.projectionCacheRemoved, 1)

    await assert.rejects(stat(join(home, 'sessions', PROJECT, SESSION)))

    const store = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
    assert.deepEqual(store.global.archivedSessionIds, [])
    assert.deepEqual(store.global.pinnedSessionIds, [])
    assert.deepEqual(store.tables.workspaces.w1.sessionIds, [OTHER])
  })

  it('keeps a backup of the store it rewrote', async () => {
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(join(home, 'storages')))
    assert.ok(entries.some((name) => name.startsWith('workspace.json.bak-')), entries.join(', '))
  })

  it('leaves the sibling session untouched', async () => {
    assert.ok(await stat(join(home, 'sessions', PROJECT, OTHER)))
    const store = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
    assert.ok(store.tables.workspaces.w1.sessionIds.includes(OTHER))
  })

  it('is idempotent for an id already gone', async () => {
    const report = await deleteSession(ctx, SESSION)
    assert.equal(report.deleted, false)
    assert.deepEqual(report.removedDirectories, [])
    assert.deepEqual(report.failures, [])
  })
})

describe('list', () => {
  it('reports the surviving session with its archive state', async () => {
    const listing = await listSessions(ctx)
    assert.equal(listing.root, join(home, 'sessions'))
    assert.equal(listing.rows.length, 1)
    assert.equal(listing.rows[0].sessionId, OTHER)
    assert.equal(listing.rows[0].archived, false)
  })
})
