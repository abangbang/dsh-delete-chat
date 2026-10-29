#!/usr/bin/env node
/**
 * dsh-delete-chat — command line.
 *
 * The same core the plugin uses: soft delete into the trash, restore, purge,
 * empty. Useful when the GUI half is not mounted, for scripted cleanup, or when
 * DSH is closed and a locked directory would otherwise refuse the move.
 *
 *   node bin/delete-chat.mjs --list                     # sessions on disk + trash count
 *   node bin/delete-chat.mjs --trash-list               # what the trash holds
 *   node bin/delete-chat.mjs --trash session-<uuid>     # soft delete
 *   node bin/delete-chat.mjs --restore session-<uuid>   # bring it back
 *   node bin/delete-chat.mjs --purge session-<uuid> --yes
 *   node bin/delete-chat.mjs --empty --yes
 *   node bin/delete-chat.mjs --preview session-<uuid>
 *
 * `--home` (or DSH_HOME) points at a DSH home other than ~/.dsh. Permanent verbs
 * require `--yes`; the soft ones do not, because they are reversible.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  emptyTrash,
  listSessions,
  listTrash,
  previewSession,
  purgeSessions,
  restoreSessions,
  trashSession,
} from '../lib/index.js'

/**
 * Parse the flags this CLI understands.
 * @param argv - process arguments after the script name.
 * @returns the option bag.
 */
function parseArgs(argv) {
  const out = {
    home: undefined,
    list: false,
    trashList: false,
    preview: false,
    yes: false,
    trash: false,
    restore: false,
    purge: false,
    empty: false,
    sessionId: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') out.list = true
    else if (arg === '--trash-list') out.trashList = true
    else if (arg === '--preview') out.preview = true
    else if (arg === '--trash') out.trash = true
    else if (arg === '--restore') out.restore = true
    else if (arg === '--purge') out.purge = true
    else if (arg === '--empty') out.empty = true
    else if (arg === '--yes' || arg === '-y') out.yes = true
    else if (arg === '--home') {
      out.home = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--home=')) out.home = arg.slice('--home='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: delete-chat --list | --trash-list | --trash <id> | --restore <id> | --purge <id> --yes | --empty --yes | --preview <id>')
      process.exit(0)
    } else if (arg.startsWith('-')) throw new Error(`unknown flag "${arg}"`)
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

/** Host context shim: only the service reads the core performs. */
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') return { root: join(home, 'sessions') }
    if (name === 'sessions') return { get: () => undefined }
    return undefined
  },
}

if (args.list || (args.sessionId === undefined && !args.trashList && !args.empty)) {
  const listing = await listSessions(ctx)
  console.log(`root: ${listing.root}`)
  console.log(`sessions: ${listing.rows.length}\n`)
  for (const row of listing.rows) {
    const flags = [row.archived ? 'archived' : '', row.pinned ? 'pinned' : '', row.live ? 'live' : '']
      .filter(Boolean).join(',')
    console.log(`${row.sessionId}  ${formatBytes(row.bytes).padStart(9)}  ${row.updatedAt ?? '-'}  ${row.project}${flags ? `  [${flags}]` : ''}`)
  }
  const trash = await listTrash(ctx)
  console.log(`\ntrash: ${trash.root} (${trash.rows.length})`)
  process.exit(0)
}

if (args.trashList) {
  const trash = await listTrash(ctx)
  console.log(`root: ${trash.root}`)
  console.log(`sessions: ${trash.rows.length}\n`)
  for (const row of trash.rows) {
    console.log(`${row.sessionId}  ${formatBytes(row.bytes).padStart(9)}  ${row.deletedAt ?? '-'}  ${row.displayTitle}`)
  }
  if (trash.missing.length > 0) {
    console.log(`\n${trash.missing.length} manifest row(s) have no directory on disk`)
  }
  process.exit(0)
}

if (args.preview) {
  if (args.sessionId === undefined) throw new Error('--preview needs a session id')
  console.log(JSON.stringify(await previewSession(ctx, args.sessionId), null, 2))
  process.exit(0)
}

if (args.trash) {
  if (args.sessionId === undefined) throw new Error('--trash needs a session id')
  const preview = await previewSession(ctx, args.sessionId)
  if (!preview.onDisk) {
    console.error(`no session directory for ${args.sessionId}`)
    process.exit(1)
  }
  const report = await trashSession(ctx, { sessionId: args.sessionId, displayTitle: args.sessionId })
  console.log(`archived : ${report.archived}`)
  console.log(`moved    : ${report.moved}`)
  console.log(`trash    : ${report.path}`)
  console.log(`size     : ${formatBytes(report.bytes)}`)
  console.log('\nReversible: use --restore to bring it back, --purge to delete it for good.')
  process.exit(0)
}

if (args.restore) {
  if (args.sessionId === undefined) throw new Error('--restore needs a session id')
  const report = await restoreSessions(ctx, { sessionIds: [args.sessionId] })
  for (const row of report.restored) console.log(`restored ${row.sessionId} -> ${row.path}`)
  for (const failure of report.failures) console.error(`failed   ${failure.path} — ${failure.error}`)
  process.exit(report.restored.length > 0 ? 0 : 1)
}

if (args.purge) {
  if (args.sessionId === undefined) throw new Error('--purge needs a session id')
  if (!args.yes) {
    console.log(`permanent deletion of ${args.sessionId} needs --yes`)
    process.exit(1)
  }
  const report = await purgeSessions(ctx, { sessionIds: [args.sessionId] })
  console.log(`removed : ${report.removedDirectories.length}`)
  console.log(`freed   : ${formatBytes(report.freedBytes)}`)
  for (const failure of report.failures) console.error(`failed  ${failure.path} — ${failure.error}`)
  process.exit(report.deleted ? 0 : 1)
}

if (args.empty) {
  if (!args.yes) {
    const listing = await listTrash(ctx)
    console.log(`emptying ${listing.rows.length} session(s) needs --yes`)
    process.exit(1)
  }
  const report = await emptyTrash(ctx)
  console.log(`removed : ${report.removedDirectories.length}`)
  console.log(`freed   : ${formatBytes(report.freedBytes)}`)
  for (const failure of report.failures) console.error(`failed  ${failure.path} — ${failure.error}`)
  process.exit(report.failures.length === 0 ? 0 : 1)
}

console.error('nothing to do; try --help')
process.exit(1)
