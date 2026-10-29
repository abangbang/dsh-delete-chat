#!/usr/bin/env node
/**
 * install.mjs — mount this plugin into a DSH profile. One implementation for
 * every OS, because the alternative (a PowerShell script plus a bash script) is
 * two state machines nobody can review side by side.
 *
 *   node scripts/install.mjs                     # install into ~/.dsh/profiles/desktop
 *   node scripts/install.mjs --profile <dir>     # another profile
 *   node scripts/install.mjs --uninstall         # unmount and delete the package copy
 *   node scripts/install.mjs --dry-run           # print the patch diff, write nothing
 *
 * It is idempotent: the mount block is stripped before it is written, and the
 * pre-rename identities (`dsh-session-delete`, entry id `session-delete`) are
 * stripped too, so a profile that still carries them ends up with exactly one
 * mount instead of a duplicate-plugin boot failure.
 */

import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package name this installer mounts. */
const NAME = 'dsh-delete-chat'
/** Entry id inside the patch layer. */
const ENTRY_ID = 'delete-chat'
/** Identities the plugin used before the rename, still cleaned up on sight. */
const LEGACY_NAMES = ['dsh-session-delete']
const LEGACY_ENTRY_IDS = ['session-delete']
/** Everything this installer may have to remove. */
const IDENTITIES = [NAME, ...LEGACY_NAMES]
const ENTRY_IDS = [ENTRY_ID, ...LEGACY_ENTRY_IDS]
/** Files and directories copied into the profile. */
const COPY_FILES = ['package.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.zh-CN.md', 'LICENSE']
const COPY_DIRS = ['lib', 'bin', 'test']

const source = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Parse the flags this installer understands.
 * @param argv - arguments after the script path.
 * @returns `{ uninstall, dryRun, profile }`.
 */
function parseArgs(argv) {
  const options = { uninstall: false, dryRun: false, profile: join(homedir(), '.dsh', 'profiles', 'desktop') }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--uninstall' || arg === '-u') options.uninstall = true
    else if (arg === '--dry-run' || arg === '-n') options.dryRun = true
    else if (arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--profile needs a directory')
      options.profile = value
      index += 1
    } else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/install.mjs [--profile <dir>] [--uninstall] [--dry-run]')
      process.exit(0)
    } else throw new Error(`unknown argument "${arg}"`)
  }
  return options
}

/**
 * The mount block this installer writes.
 * @returns the YAML text, newline-terminated.
 */
function mountBlock() {
  return [
    `# --- ${NAME} (managed by install.mjs) ---`,
    '- insert:',
    `    - id: ${ENTRY_ID}`,
    `      name: '${NAME}'`,
    `# --- end ${NAME} ---`,
    '',
  ].join('\n')
}

/**
 * Drop every mount this plugin may have written, of either generation.
 *
 * Two shapes are recognised: the marker block (`# --- <id> (managed by …) ---`
 * through `# --- end <id> ---`), and a bare three-line insert row, which is what
 * a hand-written mount looks like and what older docs suggested.
 *
 * @param text - current patch file contents.
 * @returns the text with this plugin's mounts removed.
 */
function stripMounts(text) {
  const lines = text.split('\n')
  const kept = []
  let marker = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (marker !== null) {
      if (line.trim() === `# --- end ${marker} ---`) marker = null
      continue
    }

    const open = /^# --- (.+?) \(managed by install\.(?:ps1|mjs)\) ---$/.exec(line.trim())
    if (open !== null && IDENTITIES.includes(open[1])) {
      marker = open[1]
      continue
    }

    const insert = /^\s*- insert:\s*$/.exec(line)
    if (insert !== null) {
      const id = /^\s*- id:\s*(.+?)\s*$/.exec(lines[index + 1] ?? '')
      const name = /^\s*name:\s*'?([^'\s]+)'?\s*$/.exec(lines[index + 2] ?? '')
      if (id !== null && name !== null && ENTRY_IDS.includes(id[1]) && IDENTITIES.includes(name[1])) {
        index += 2
        continue
      }
    }

    kept.push(line)
  }

  // Collapse the blank runs a removal leaves behind, but never touch a block's
  // own single separating blank line.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * Copy the package payload into the profile.
 * @param target - `<profile>/node_modules/<name>`.
 */
async function copyPayload(target) {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const file of COPY_FILES) {
    const from = join(source, file)
    const present = await stat(from).catch(() => undefined)
    if (present?.isFile()) await copyFile(from, join(target, file))
  }
  for (const dir of COPY_DIRS) {
    const from = join(source, dir)
    const present = await stat(from).catch(() => undefined)
    if (present?.isDirectory() === true) {
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const child = join(from, entry.name)
        const to = join(target, dir, entry.name)
        await mkdir(dirname(to), { recursive: true })
        if (entry.isDirectory()) await copyTree(child, to)
        else await copyFile(child, to)
      }
    }
  }
}

/**
 * Recursive directory copy.
 * @param from - source directory.
 * @param to - destination directory.
 */
async function copyTree(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const child = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await copyTree(child, target)
    else await copyFile(child, target)
  }
}

/**
 * Remove package directories left by the previous identity.
 * @param nodes - `<profile>/node_modules`.
 * @param report - collector for the console output.
 */
async function removeLegacyDirs(nodes, report) {
  for (const legacy of LEGACY_NAMES) {
    const dir = join(nodes, legacy)
    const present = await stat(dir).catch(() => undefined)
    if (present?.isDirectory() !== true) continue
    await rm(dir, { recursive: true, force: true })
    report.push(`removed legacy package directory: ${dir}`)
  }
}

const options = parseArgs(process.argv.slice(2))
const profile = options.profile
const patchFile = join(profile, 'cordis.patch.yml')
const nodes = join(profile, 'node_modules')
const target = join(nodes, NAME)

const patchInfo = await stat(patchFile).catch(() => undefined)
if (patchInfo?.isFile() !== true) {
  console.error(`no profile patch at ${patchFile}\nPoint --profile at a DSH profile directory (it must contain cordis.patch.yml).`)
  process.exit(1)
}

const before = await readFile(patchFile, 'utf8')
// Normalise the tail before appending: a strip leaves the blank line that used
// to separate the old block, so appending verbatim would grow a newline per run
// and the "already up to date" check would never fire.
const body = stripMounts(before).replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
const next = options.uninstall ? `${body}\n` : `${body}\n\n${mountBlock()}`
const report = []

if (options.uninstall) {
  await rm(target, { recursive: true, force: true })
  report.push(`removed ${target}`)
  await removeLegacyDirs(nodes, report)
} else {
  if (!options.dryRun) await copyPayload(target)
  report.push(`${options.dryRun ? 'would install' : 'installed'} ${target}`)
  if (!options.dryRun) await removeLegacyDirs(nodes, report)
}

if (options.dryRun) {
  console.log('--- patch: before ---')
  console.log(before)
  console.log('--- patch: after ---')
  console.log(next)
  for (const line of report) console.log(line)
  process.exit(0)
}

if (next !== before) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await copyFile(patchFile, `${patchFile}.bak-${stamp}`)
  await writeFile(patchFile, next, 'utf8')
  report.push(`updated ${relative(profile, patchFile)} (backup: cordis.patch.yml.bak-${stamp})`)
} else {
  report.push('patch already up to date')
}

for (const line of report) console.log(line)
console.log(options.uninstall
  ? 'Restart DSH: the menu entry disappears.'
  : 'Restart DSH: the session row menu gains "删除会话 / Delete chat".')
