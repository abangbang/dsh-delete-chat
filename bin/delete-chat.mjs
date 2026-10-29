#!/usr/bin/env node
/**
 * dsh-delete-chat — command line fallback.
 *
 * Same core as the plugin, without a running host: useful when the GUI half is
 * not mounted yet, when you want a scripted cleanup, or when DSH is closed and
 * you would rather not start it.
 *
 *   node bin/delete-chat.mjs --list
 *   node bin/delete-chat.mjs --preview session-<uuid>
 *   node bin/delete-chat.mjs --yes session-<uuid>
 *
 * `--home` (or DSH_HOME) points at a DSH home other than ~/.dsh.
 *
 * Caveat the GUI does not have: with DSH running, a session that is still live
 * in memory keeps its row and may error on the next write. Archive it in the UI
 * first, or close DSH.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { deleteSession, listSessions, previewSession } from '../lib/index.js'

/**
 * Parse the flags this CLI understands.
 * @param argv - process arguments after the script name.
 * @returns `{ home, list, preview, yes, sessionId }`.
 */
function parseArgs(argv) {
  const out = { home: undefined, list: false, preview: false, yes: false, sessionId: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') out.list = true
    else if (arg === '--preview') out.preview = true
    else if (arg === '--yes' || arg === '-y') out.yes = true
    else if (arg === '--home') {
      out.home = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--home=')) out.home = arg.slice('--home='.length)
    else if (arg.startsWith('-')) throw new Error(`unknown flag "${arg}"`)
    else if (out.sessionId === undefined) out.sessionId = arg
    else throw new Error(`unexpected argument "${arg}"`)
  }
  return out
}

/**
 * Human byte size.
 * @param bytes - raw count.
 * @returns e.g. `274.4 KB`.
 */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

const args = parseArgs(process.argv.slice(2))
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))

/** Host context shim: only the two service reads the core performs. */
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') return { root: join(home, 'sessions') }
    if (name === 'sessions') return { get: () => undefined }
    return undefined
  },
}

if (args.list || args.sessionId === undefined) {
  const listing = await listSessions(ctx)
  console.log(`root: ${listing.root}`)
  console.log(`sessions: ${listing.rows.length}\n`)
  for (const row of listing.rows) {
    const flags = [row.archived ? 'archived' : '', row.pinned ? 'pinned' : '', row.live ? 'live' : '']
      .filter(Boolean).join(',')
    console.log(`${row.sessionId}  ${formatBytes(row.bytes).padStart(9)}  ${row.updatedAt ?? '-'}  ${row.project}${flags ? `  [${flags}]` : ''}`)
  }
  process.exit(0)
}

if (args.preview) {
  const preview = await previewSession(ctx, args.sessionId)
  console.log(JSON.stringify(preview, null, 2))
  process.exit(0)
}

const preview = await previewSession(ctx, args.sessionId)
console.log(`session : ${preview.sessionId}`)
console.log(`root    : ${preview.root}`)
console.log(`size    : ${formatBytes(preview.bytes)}`)
for (const dir of preview.directories) console.log(`dir     : ${dir.path} (${formatBytes(dir.bytes)})`)
if (!preview.onDisk) console.log('dir     : 磁盘上没有该会话目录')
if (!args.yes) {
  console.log('\n未删除。确认后加 --yes 重跑。')
  process.exit(1)
}

const report = await deleteSession(ctx, args.sessionId)
console.log(`\narchived: ${report.archived}`)
console.log(`removed : ${report.removedDirectories.length} 个目录，释放 ${formatBytes(report.freedBytes)}`)
console.log(`accounting: ${report.workspaceAccounting === null ? '无变化' : JSON.stringify(report.workspaceAccounting)}`)
console.log(`projection cache: ${report.projectionCacheRemoved} 项`)
for (const failure of report.failures) console.log(`failure : ${failure.path} — ${failure.error}`)
process.exit(report.deleted ? 0 : 1)
