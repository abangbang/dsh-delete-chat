/**
 * Route-level test for the host half: mounts the plugin through `apply()`
 * against a fake webServer, then drives the registered handler with synthetic
 * requests — the same envelope shapes the browser client sends.
 *
 * Run with: node --test test/http.test.mjs
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

const SESSION = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PROJECT = '--C-Users-test-demo--'

let home
let route

/**
 * Collect one fake request into the async-iterable shape the handler reads.
 * @param url - request target.
 * @param body - JSON payload, or undefined for none.
 * @param method - HTTP method.
 * @returns request object.
 */
function request(url, body, method = 'POST') {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (text !== '') yield Buffer.from(text, 'utf8')
    },
  }
}

/**
 * Capture the response the handler writes.
 * @returns `{ res, read }`.
 */
function response() {
  const captured = { status: 0, headers: {}, body: '' }
  const res = {
    set statusCode(value) { captured.status = value },
    get statusCode() { return captured.status },
    setHeader(name, value) { captured.headers[name.toLowerCase()] = value },
    end(text) { captured.body = text ?? '' },
  }
  return { res, read: () => ({ status: captured.status, headers: captured.headers, json: JSON.parse(captured.body) }) }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-delete-chat-http-'))
  const sessions = join(home, 'sessions')
  await mkdir(join(sessions, PROJECT, SESSION), { recursive: true })
  await writeFile(join(sessions, PROJECT, SESSION, 'session.v4.jsonl.zstd'), Buffer.alloc(512))
  await mkdir(join(home, 'storages', 'session_projcache'), { recursive: true })
  await writeFile(join(home, 'storages', 'session_projcache', `${SESSION}.json`), '{}')
  await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
    global: { archivedSessionIds: [], pinnedSessionIds: [], workspaceIds: ['w1'] },
    tables: { workspaces: { w1: { sessionIds: [SESSION] } } },
  })}\n`)

  const ctx = {
    get(name) {
      if (name === 'sessionPersistence') return { root: sessions }
      if (name === 'sessions') return { get: () => undefined }
      if (name === 'connection') return { requestRejection: () => undefined }
      return undefined
    },
    effect(fn) { fn() },
    webServer: {
      register(config) {
        route = config
        return () => {}
      },
    },
  }
  apply(ctx)
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

describe('mount', () => {
  it('registers one prefix route', () => {
    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/delete-chat/api')
    assert.equal(typeof route.handler, 'function')
  })
})

describe('envelope', () => {
  it('rejects GET', async () => {
    const { res, read } = response()
    await route.handler(request('/delete-chat/api/list', undefined, 'GET'), res)
    const out = read()
    assert.equal(out.status, 405)
    assert.equal(out.json.ok, false)
  })

  it('answers unknown methods with 404 and no prototype fallthrough', async () => {
    for (const method of ['constructor', 'toString', 'hasOwnProperty', 'nope']) {
      const { res, read } = response()
      await route.handler(request(`/delete-chat/api/${method}`, {}), res)
      assert.equal(read().status, 404, method)
    }
  })

  it('rejects a traversal-shaped id before touching the filesystem', async () => {
    const { res, read } = response()
    await route.handler(request('/delete-chat/api/delete', { sessionId: '../../etc/passwd' }), res)
    const out = read()
    assert.equal(out.status, 400)
    assert.match(out.json.error.message, /must look like/)
    assert.ok(await stat(join(home, 'sessions', PROJECT, SESSION)), 'fixture must survive')
  })

  it('rejects a non-object body', async () => {
    const { res, read } = response()
    await route.handler(request('/delete-chat/api/delete', [1, 2, 3]), res)
    assert.equal(read().status, 400)
  })
})

describe('operations', () => {
  it('previews', async () => {
    const { res, read } = response()
    await route.handler(request('/delete-chat/api/preview', { sessionId: SESSION }), res)
    const out = read()
    assert.equal(out.status, 200)
    assert.equal(out.json.ok, true)
    assert.equal(out.json.value.onDisk, true)
    assert.equal(out.json.value.bytes, 512)
  })

  it('lists', async () => {
    const { res, read } = response()
    await route.handler(request('/delete-chat/api/list', {}), res)
    const out = read()
    assert.equal(out.status, 200)
    assert.equal(out.json.value.rows.length, 1)
  })

  it('deletes and reports', async () => {
    const { res, read } = response()
    await route.handler(request('/delete-chat/api/delete', { sessionId: SESSION }), res)
    const out = read()
    assert.equal(out.status, 200)
    assert.equal(out.json.value.deleted, true)
    assert.equal(out.json.value.freedBytes, 512)
    await assert.rejects(stat(join(home, 'sessions', PROJECT, SESSION)))
    const store = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
    assert.deepEqual(store.tables.workspaces.w1.sessionIds, [])
  })
})
