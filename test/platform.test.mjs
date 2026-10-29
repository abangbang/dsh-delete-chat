/**
 * Platform matrix.
 *
 * Windows and POSIX differ in exactly the places this plugin touches: how a path
 * is derived, what blocks a directory removal, and whether a symlinked home (the
 * macOS `/var` → `/private/var` shape) survives a join. Every case below runs on
 * the OS that owns it and is skipped with a reason elsewhere, so a green run on
 * one platform never silently stands in for another.
 *
 * CI runs this file on windows-latest, ubuntu-latest and macos-latest.
 *
 * Run with: node --test test/platform.test.mjs
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { __testing, deleteSession, previewSession } from '../lib/index.js'

const WINDOWS = platform === 'win32'
const POSIX = !WINDOWS

const SESSION = 'session-00000000-1111-4222-8333-444444444444'
const PROJECT = '--proj--'

/**
 * Host-context shim: only the two service reads the core performs.
 * @param root - sessions root to report.
 * @returns the shim.
 */
const contextFor = (root) => ({
  get(name) {
    if (name === 'sessionPersistence') return { root }
    if (name === 'sessions') return { get: () => undefined }
    return undefined
  },
})

/** Milliseconds to let a spawned holder actually take its cwd. */
const SETTLE = 200

// ── home derivation ────────────────────────────────────────────────────────

describe('home derivation', () => {
  it('takes the parent of a stock `<home>/sessions` root', () => {
    const root = WINDOWS ? join('C:\\Users\\dev', '.dsh', 'sessions') : join('/Users/dev', '.dsh', 'sessions')
    const ctx = contextFor(root)
    const expected = WINDOWS ? join('C:\\Users\\dev', '.dsh') : join('/Users/dev', '.dsh')

    assert.equal(__testing.sessionsRootOf(ctx), root)
    assert.equal(__testing.dshHomeOf(ctx), expected)
  })

  it('reads DSH_HOME for a custom root instead of guessing its parent', () => {
    const custom = WINDOWS ? join('D:\\dsh-data', 'logs') : join('/var/lib/dsh', 'logs')
    const ctx = contextFor(custom)
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = WINDOWS ? 'E:\\dsh-home' : '/srv/dsh-home'
    try {
      assert.equal(__testing.dshHomeOf(ctx), WINDOWS ? 'E:\\dsh-home' : '/srv/dsh-home')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('falls back to the default home when a custom root has no DSH_HOME', () => {
    const custom = WINDOWS ? join('D:\\dsh-data', 'logs') : join('/var/lib/dsh', 'logs')
    const ctx = contextFor(custom)
    const previous = process.env.DSH_HOME
    delete process.env.DSH_HOME
    try {
      assert.equal(__testing.dshHomeOf(ctx), join(homedir(), '.dsh'))
    } finally {
      if (previous !== undefined) process.env.DSH_HOME = previous
    }
  })
})

// ── id validation ──────────────────────────────────────────────────────────

describe('session id validation', () => {
  const REJECTED = [
    'session-a/b',
    'session-a\\b',
    'session-a:b',
    'session-a*b',
    'session-a?b',
    'session-a|b',
    'session-a"b',
    'session-a<b',
    'session-..',
    'session-',
    '',
    '../session-x',
    'C:\\session-x',
    'session-x\u0000',
  ]

  for (const bad of REJECTED) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => __testing.requireSessionId(bad), /must look like/)
    })
  }

  it('accepts the uuid shape and survives both separators being refused', () => {
    assert.equal(__testing.requireSessionId(SESSION), SESSION)
    assert.equal(__testing.requireSessionId('session-abc_DEF-123'), 'session-abc_DEF-123')
  })
})

// ── a root reached through a symlink ───────────────────────────────────────

describe('symlinked sessions root', () => {
  it('resolves through the link, as macOS tmpdir does', { skip: skipReason('POSIX') }, async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-link-'))
    const real = join(base, 'real')
    const link = join(base, 'link')
    await mkdir(join(real, 'sessions', PROJECT, SESSION), { recursive: true })
    await writeFile(join(real, 'sessions', PROJECT, SESSION, 'session.v4.jsonl.zstd'), Buffer.alloc(128))
    await mkdir(join(real, 'storages'), { recursive: true })
    await writeFile(join(real, 'storages', 'workspace.json'), `${JSON.stringify({
      global: { archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: { w1: { sessionIds: [SESSION] } } },
    })}\n`)
    await symlink(real, link, 'dir')

    try {
      const ctx = contextFor(join(link, 'sessions'))
      const preview = await previewSession(ctx, SESSION)
      assert.equal(preview.onDisk, true)
      assert.equal(preview.bytes, 128)

      const report = await deleteSession(ctx, SESSION)
      assert.equal(report.deleted, true)
      await assert.rejects(stat(join(real, 'sessions', PROJECT, SESSION)), 'the real directory must be gone')

      const store = JSON.parse(await readFile(join(real, 'storages', 'workspace.json'), 'utf8'))
      assert.deepEqual(store.tables.workspaces.w1.sessionIds, [])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

// ── a removal blocked by a live holder ─────────────────────────────────────

describe('removal blocked by a live holder', () => {
  let home
  let sessionDir

  before(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-holder-'))
    sessionDir = join(home, 'sessions', PROJECT, SESSION)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.alloc(256))
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      global: { archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: { w1: { sessionIds: [SESSION] } } },
    })}\n`)
  })

  after(async () => {
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })

  it(
    WINDOWS ? 'fails with EBUSY while another process holds the directory as its cwd' : 'succeeds even while another process sits in the directory',
    async () => {
      // A child process whose cwd is the session directory: on Windows that pins
      // the directory (EBUSY), on POSIX an unlinked cwd is legal and the removal
      // goes through.
      const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], {
        cwd: sessionDir,
        stdio: 'ignore',
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, SETTLE))
        assert.equal(holder.exitCode, null, 'the holder must still be running')

        const report = await deleteSession(contextFor(join(home, 'sessions')), SESSION)

        if (WINDOWS) {
          assert.equal(report.deleted, false, 'a blocked directory is not a deletion')
          assert.ok(report.failures.length > 0, 'the refusal must be reported')
          assert.match(report.failures[0].error, /EBUSY|EPERM|EACCES/, `unexpected error: ${report.failures[0].error}`)
          assert.equal(report.failures[0].path, sessionDir)
          assert.ok(await stat(sessionDir), 'the directory must survive a refused removal')
        } else {
          assert.equal(report.deleted, true, 'POSIX allows removing a held directory')
          assert.deepEqual(report.failures, [])
          await assert.rejects(stat(sessionDir))
        }

        // Accounting is independent of the removal outcome, on both platforms.
        const store = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
        assert.deepEqual(store.tables.workspaces.w1.sessionIds, [], 'the reference is pruned either way')
      } finally {
        holder.kill()
        await Promise.race([once(holder, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))])
        if (WINDOWS) {
          // Give Windows a moment to release the pinned directory before cleanup.
          await new Promise((resolve) => setTimeout(resolve, SETTLE))
          await rm(sessionDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    },
  )
})

/**
 * Build a `skip` reason for a branch that does not belong to this OS.
 * @param wanted - `'POSIX'` or `'WINDOWS'`.
 * @returns `false` when this OS owns the branch, otherwise the reason.
 */
function skipReason(wanted) {
  const owns = wanted === 'POSIX' ? POSIX : WINDOWS
  return owns ? false : `posix-only case, running on ${platform}`
}
