# dsh-delete-chat

**Real session deletion for DeepSeek Harness.** DSH ships archive-only session management:
archiving hides a conversation from every list, but the log stays on disk forever. This plugin
adds the missing verb — archive, remove the directory, prune workspace accounting, clear the
projection cache — behind a confirmation dialog that reports what it actually did.

English | [中文](README.zh-CN.md)

<p align="center">
  <img src="docs/banner.svg" alt="dsh-delete-chat" width="720">
</p>

---

## Why it exists

Two shipped packages document the gap themselves:

> "**Does not delete session files** — logs accumulate under `root` until removed externally.
> The seam has **no delete interface**."
> — `@deepseek-ai/dsh-session-persistence-jsonl`

> "Removing a project keeps its folder, files and session history … while **session deletion and
> folder removal are independent features that are not yet provided**."
> — `@deepseek-ai/dsh-workspace`

"Delete workspace" only touches the list. "Archive" only hides. `~/.dsh/sessions` therefore only
grows — this plugin is the scissors.

## Features

| | |
|---|---|
| **Soft delete** | Session row "⋯" → Delete chat moves the directory into `~/.dsh/session-trash` — a rename on the same volume, never a copy |
| **Trash as a global panel** | The sidebar's panel list gets a Trash row whose icon carries the number of conversations inside; selecting it opens a full page with filter, multi-select, restore, permanent delete and empty |
| **Confirmation modals** | Restore, delete and empty each open a modal that names the count and the bytes before anything touches the disk |
| **Row details** | Size, trash path, last activity and deletion time on every row |
| **Localized** | Wording follows the host language (zh / en) live — rows, dialog and panel all re-render on a switch |
| **Both layouts** | Per-project `<root>/<project>/session-<uuid>/` and flat `<root>/session-<uuid>/` |
| **CLI** | `--trash` / `--trash-list` / `--restore` / `--purge --yes` / `--empty --yes`, usable without the GUI |
| **Self-hosted index** | Ships a format-1 market index — add it as an index source for a private market |

## Install

### Plugin market

Host → **Settings → Plugins → Discover → Index sources**, add:

```
https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USER/dsh-delete-chat@main/market/index.json
```

(Icon paths in the index are relative; jsDelivr serves the whole repo as a static site, so they
resolve.)

### Command line

```bash
dsh plugin --profile <your-profile> add https://github.com/YOUR_GITHUB_USER/dsh-delete-chat/archive/refs/heads/main.tar.gz
```

On the official desktop app the profile belongs to the app's own plugin manager — install through
**Settings → Plugins** instead.

### Script (any OS)

```bash
node scripts/install.mjs                  # install into ~/.dsh/profiles/desktop
node scripts/install.mjs --profile <dir>  # any profile
node scripts/install.mjs --dry-run        # print the patch diff, write nothing
node scripts/install.mjs --uninstall      # unmount + delete the package copy

./install.sh                              # macOS / Linux wrapper
.\install.ps1                             # Windows wrapper (also -Uninstall / -DryRun)
```

The wrappers only translate switches — the installer is one Node script, so all three OSes run the
same code, and it strips the pre-rename mount (`dsh-session-delete`) so an upgraded profile never
ends up with two.

### Manual mount

```bash
git clone https://github.com/YOUR_GITHUB_USER/dsh-delete-chat.git \
  ~/.dsh/profiles/desktop/node_modules/dsh-delete-chat
```

Then append to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: delete-chat
      name: 'dsh-delete-chat'
```

**Restart DSH afterwards.** The plugin tree is composed at boot, and the client bundle is composed
at boot too and served with `immutable` cache headers — a page refresh returns the old bundle.

> ⚠️ Do not mount twice: after installing through `dsh plugin add` (which reads this package's
> `dsh.bundle.patch` and inserts the row itself), delete the hand-written `- insert:` block.

## Usage

**Delete** — session row → **"⋯" → Delete chat** → confirm. The row leaves the list, running
work stops, and the directory moves into the trash:

```
Status        moved to trash
Archive       archived, running work stopped
Size          274.4 KB
Trash         ~/.dsh/session-trash/--proj--/session-…
```

Nothing is lost: this is a rename, and it stays reversible until you say otherwise.

**Trash** — the sidebar's panel list (the nav above the workspaces, `aria-label="全局面板"`) gains a
**Trash** row, whose icon is followed by the count (hidden at zero, `99+` above that). Selecting it opens the panel as a page — the same
kind of page the Plugins manager uses — listing every trashed conversation with its size, project and
deletion time:

- **filter** by title, path or project;
- **select** one row or all of them — the footer counts the selection;
- **Restore** moves the directories back, re-accounts them and unarchives them;
- **Restore**, **Delete permanently** and **Empty trash** each open a confirmation modal that names
  the count, the bytes it will free and whether the action is reversible; only its confirm button
  touches the disk.

Every row shows its own details:

```
alpha conversation
  Size           2.0 KB
  Location       ~/.dsh/session-trash/--proj--/session-…
  Last activity  2026-10-27 17:08:07   ← the log's mtime; rename keeps it
  Deleted        2026-10-29 09:02:03
```

### CLI

```bash
dsh-delete-chat --list                     # sessions on disk + trash count
dsh-delete-chat --trash-list               # what the trash holds
dsh-delete-chat --trash session-<uuid>     # soft delete
dsh-delete-chat --restore session-<uuid>   # bring it back
dsh-delete-chat --purge session-<uuid> --yes
dsh-delete-chat --empty --yes
dsh-delete-chat --preview session-<uuid>
```

Permanent verbs refuse to run without `--yes`; the soft ones do not, because they are reversible.

## How it works

### Moving a conversation to the trash

| Step | Action | Why this order |
|---|---|---|
| 1 | `archiveSession(id, { stopActivity: true })` | Hides the row everywhere immediately, stops a running turn, and `ArchivedSessionGate` refuses later wakes |
| 2 | `rename` `<sessions-root>/…/session-<uuid>/` → `<home>/session-trash/<project>/session-<uuid>/` | Same volume, so the move is instant and atomic; a root on another volume falls back to copy + remove (`EXDEV`) |
| 3 | Rewrite `storages/workspace.json` | Drops the id from `sessionIds` so the sidebar row cannot come back; `.bak-<stamp>` kept |
| 4 | Append `<home>/session-trash/index.json` | Keeps title, cwd, size and deletion time without decoding a single zstd frame |

### The trash

```
~/.dsh/
├── sessions/                      # live sessions
│   └── <project>/session-<uuid>/
└── session-trash/                 # everything you deleted
    ├── index.json                 # titles, cwd, sizes, timestamps
    └── <project>/session-<uuid>/  # the directory, byte for byte
```

The directory tree is the truth: a directory the manifest does not know is listed with its id as the
title, and a manifest row whose directory vanished is reported as missing instead of being shown.

Restore reverses steps 2–3 and asks the live registry to re-project the row (`insertSessionBefore`)
when it can. Permanent deletion — only ever reachable from the trash — unlinks the directory,
forgets the manifest row and clears the projection cache.

### API

`POST /delete-chat/api/{trash,trashList,restore,purge,empty}` plus `{list,preview,delete}`, where
`delete` is the permanent single-shot kept for scripts. All of them are fenced by the host's own
`connection.requestRejection`, and `sessionId` is validated before it ever reaches `join()`/`rm()`:
`../`, drive letters and separators cannot become path segments.

## When it fails

| What failed | What you see | What is actually true |
|---|---|---|
| The host call itself | dialog phase `error`, red box | Nothing was written |
| The move refused (on Windows: a directory another process holds) | dialog error carrying `EBUSY`/`EPERM` | The archive already ran; the directory is still in the sessions root, so unarchive it and it is back |
| `workspace.json` rewrite refused after a good move | the trash row exists, the sidebar row may linger | Files are safe in the trash; restore them, or clear the stale reference by hand |
| A purge cannot unlink | panel lists path + reason, and `N failed` | The other selections were deleted; the failing one is still listed |
| Restore cannot move back | `N failed` with the path | The directory is still in the trash; nothing was half-moved |

Recovery, in the order to try it:

1. **Restore** — anything in the trash can come back with one click; that is the whole point.
2. **Retry** — the dialog and the panel are idempotent: run them again after fixing the cause
   (close the handle, quit the sync client).
3. **CLI fallback** — quit DSH first; the lock that blocks a directory is usually the host's own
   handle. `dsh-delete-chat --trash | --restore | --purge --yes`.
4. **Roll back the store** — every rewrite leaves `workspace.json.bak-<stamp>` next to it.

## Platform support

| | Windows | macOS | Linux |
|---|---|---|---|
| Plugin runtime (host + client half) | ✅ verified locally | ✅ CI, `macos-latest` | ✅ CI, `ubuntu-latest` |
| Installer (`scripts/install.mjs` + wrappers) | ✅ verified locally | ✅ same suite | ✅ same suite |
| A directory another process holds | refused (`EBUSY`) → reported, retry offered | removed (POSIX `unlink`) | removed (POSIX `unlink`) |
| Sessions root behind a symlink (macOS `tmpdir` shape) | n/a | ✅ covered | ✅ covered |
| Path derivation | drive-letter roots | POSIX roots | POSIX roots |

Windows and POSIX assertions live in one file (`test/platform.test.mjs`) and are mutually exclusive:
the branch that does not belong to the running OS is skipped **with a reason**, so a green run on one
platform never stands in for another. `npm test` is 80 tests.

The only platform difference users actually hit is the third row: on Windows a directory held open by
another process cannot be moved, so the dialog reports `EBUSY`, and the CLI fallback is
`dsh-delete-chat --trash <id>` after quitting DSH. On macOS and Linux that same move simply succeeds.

## Known limitations

- **The trash is not the OS recycle bin.** It lives at `<DSH home>/session-trash`; deleting
  that directory by hand is a permanent delete that bypasses every confirmation.
- **Restore may need a restart.** The live row comes back immediately when the workspace registry
  exposes `insertSessionBefore`; without it the directory is restored and the row reappears on the
  next boot.
- **No cascade**: subagent and forked child sessions survive on their own, and their
  `parent_session` dangles.
- **Attachments untouched**: `~/.dsh/attachments/v1/objects` is content-addressed and shared, so
  neither trashing nor purging one session deletes objects other sessions still reference.
- **In-memory object lingers**: the `sessions` service exposes only `create`/`get`/`list`, so a
  trashed session's object stays until restart. It runs no model step while archived.

## Development

```bash
npm test                 # 80 tests: host logic, trash, HTTP envelope, client, platform matrix, installer
npm run pack             # release/dsh-delete-chat-<version>.tgz
npm run market-index     # regenerate market/index.json from HEAD
npm run rename-owner --  <github-user> [display-name]
```

Every suite runs against `mkdtemp` fixtures and a fake context — no running DSH, no real data. The
client suite renders the real components through a fake React, so the assertions read the text a
user would see.

## License

[MIT](LICENSE). Listing ≠ endorsement: this is third-party code; install only from sources you
trust.
