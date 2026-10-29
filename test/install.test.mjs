/**
 * Installer test: drives `scripts/install.mjs` as a child process against a
 * throwaway profile, on whatever OS runs it. The installer is the one part of
 * this package that edits a file the user owns (`cordis.patch.yml`), so its
 * behaviour — idempotence, legacy cleanup, uninstall — is asserted rather than
 * described.
 *
 * Run with: node --test test/install.test.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

const INSTALLER = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url))
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The installed copy does not ship `scripts/`, so this suite can only run in the repo. */
const installerPresent = await stat(INSTALLER).then((info) => info.isFile(), () => false)
const skipReason = installerPresent ? false : 'scripts/install.mjs is not shipped with the installed package'

/** Unrelated profile configuration that must survive every operation. */
const BASE_PATCH = `# profile patch
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
- id: ui-theme
  name: "@deepseek-ai/dsh-client-ui-theme"
  config:
    preference: dark
`

/** A profile still carrying the pre-rename mounts, marker and hand-written. */
const LEGACY_PATCH = `${BASE_PATCH}
# --- dsh-session-delete (managed by install.ps1) ---
- insert:
    - id: session-delete
      name: 'dsh-session-delete'
# --- end dsh-session-delete ---

- insert:
    - id: session-delete
      name: 'dsh-session-delete'
`

let root

/**
 * Create a profile directory with a patch file.
 * @param name - subdirectory name.
 * @param patch - patch file contents.
 * @returns the profile directory.
 */
async function makeProfile(name, patch) {
  const dir = join(root, name)
  await mkdir(join(dir, 'node_modules'), { recursive: true })
  await writeFile(join(dir, 'cordis.patch.yml'), patch)
  return dir
}

/**
 * Run the installer.
 * @param profile - profile directory.
 * @param extra - additional flags.
 * @returns `{ status, stdout, stderr }`.
 */
function runInstaller(profile, extra = []) {
  const result = spawnSync(process.execPath, [INSTALLER, '--profile', profile, ...extra], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * Count non-overlapping occurrences of a literal.
 * @param haystack - text to search.
 * @param needle - literal to count.
 * @returns the count.
 */
const count = (haystack, needle) => haystack.split(needle).length - 1

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-install-'))
})

after(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

describe('install', () => {
  it('mounts the plugin and keeps the rest of the patch', { skip: skipReason }, async () => {
    const profile = await makeProfile('fresh', BASE_PATCH)
    const run = runInstaller(profile)
    assert.equal(run.status, 0, run.stderr)

    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.equal(count(patch, '- insert:'), 1)
    assert.ok(patch.includes("name: 'dsh-delete-chat'"))
    assert.ok(patch.includes('id: delete-chat'))
    assert.ok(patch.includes('id: agent-default-model'), 'unrelated entries survive')
    assert.ok(patch.includes('id: ui-theme'))

    const entry = join(profile, 'node_modules', 'dsh-delete-chat', 'lib', 'index.js')
    assert.ok(await stat(entry), 'the payload must be copied')
  })

  it('backs the patch up once, and is idempotent on a second run', { skip: skipReason }, async () => {
    const profile = await makeProfile('idempotent', BASE_PATCH)
    assert.equal(runInstaller(profile).status, 0)
    const afterFirst = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')

    const run = runInstaller(profile)
    assert.equal(run.status, 0, run.stderr)
    const afterSecond = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')

    assert.equal(afterSecond, afterFirst, 'a second run must not rewrite the patch')
    assert.equal(count(afterSecond, '- insert:'), 1, 'and must not mount twice')
    assert.match(run.stdout, /already up to date/)

    const backups = (await readdir(profile)).filter((name) => name.startsWith('cordis.patch.yml.bak-'))
    assert.equal(backups.length, 1, `one backup expected, got ${backups.join(', ')}`)
  })

  it('replaces the pre-rename mounts instead of adding a second one', { skip: skipReason }, async () => {
    const profile = await makeProfile('legacy', LEGACY_PATCH)
    await mkdir(join(profile, 'node_modules', 'dsh-session-delete'), { recursive: true })

    const run = runInstaller(profile)
    assert.equal(run.status, 0, run.stderr)

    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.equal(count(patch, 'dsh-session-delete'), 0, 'the old identity must be gone')
    assert.equal(count(patch, 'session-delete'), 0)
    assert.equal(count(patch, '- insert:'), 1, 'exactly one mount')
    assert.ok(patch.includes('id: agent-default-model'))

    await assert.rejects(stat(join(profile, 'node_modules', 'dsh-session-delete')), 'the old package dir goes too')
  })
})

describe('uninstall', () => {
  it('removes the mount, the package copy and the old identity', { skip: skipReason }, async () => {
    const profile = await makeProfile('uninstall', LEGACY_PATCH)
    assert.equal(runInstaller(profile).status, 0)
    assert.equal(runInstaller(profile, ['--uninstall']).status, 0)

    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.equal(count(patch, '- insert:'), 0, 'no mount must remain')
    assert.equal(count(patch, 'dsh-delete-chat'), 0)
    assert.equal(count(patch, 'dsh-session-delete'), 0)
    assert.ok(patch.includes('id: agent-default-model'), 'unrelated entries survive an uninstall')
    assert.ok(patch.includes('id: ui-theme'))

    await assert.rejects(stat(join(profile, 'node_modules', 'dsh-delete-chat')))
  })
})

describe('dry run', () => {
  it('prints the patch diff and writes nothing', { skip: skipReason }, async () => {
    const profile = await makeProfile('dry', BASE_PATCH)
    const run = runInstaller(profile, ['--dry-run'])
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /patch: after/)
    assert.match(run.stdout, /dsh-delete-chat/)

    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.equal(patch, BASE_PATCH, 'the patch must be untouched')
    await assert.rejects(stat(join(profile, 'node_modules', 'dsh-delete-chat')))
  })
})

describe('error handling', () => {
  it('refuses a directory that is not a profile', { skip: skipReason }, async () => {
    const dir = join(root, 'not-a-profile')
    await mkdir(dir, { recursive: true })
    const run = runInstaller(dir)
    assert.equal(run.status, 1)
    assert.match(`${run.stderr}${run.stdout}`, /cordis\.patch\.yml/)
  })
})

/** Surface the platform in the report so a CI log names the OS it proved this on. */
describe('platform', () => {
  it('reports the OS this installer was verified on', () => {
    assert.ok(['win32', 'darwin', 'linux', 'freebsd', 'openbsd', 'android'].includes(platform), platform)
    assert.ok(PACKAGE_ROOT.length > 0)
  })
})
