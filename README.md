# dsh-delete-chat

[![ci](https://github.com/abangbang/dsh-delete-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/abangbang/dsh-delete-chat/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.2-555)

**Delete a DSH conversation without losing it.**

DeepSeek Harness only archives: the row disappears from every list, the log stays on disk forever.
This plugin adds the real delete — with a safety net first. The directory is *moved* into
`~/.dsh/session-trash`, the sidebar gains a Trash page listing what is inside, and only an explicit
"delete permanently", behind a confirmation modal, ever unlinks a file.

English | [中文](README.zh-CN.md)

<p align="center">
  <img src="docs/banner.svg" alt="dsh-delete-chat" width="720">
</p>

## Why it exists

Two shipped DSH packages document the gap themselves:

> "**Does not delete session files** — logs accumulate under `root` until removed externally.
> The seam has **no delete interface**."
> — `@deepseek-ai/dsh-session-persistence-jsonl`

> "Removing a project keeps its folder, files and session history … while **session deletion and
> folder removal are independent features that are not yet provided**."
> — `@deepseek-ai/dsh-workspace`

"Delete workspace" only touches the list, "archive" only hides, so `~/.dsh/sessions` only grows.
This plugin is the scissors.

## What you get

| | |
|---|---|
| **Soft delete** | Session row "⋯" → Delete chat `rename`s the directory into `~/.dsh/session-trash`. Same volume, so it is instant, atomic, and copies nothing |
| **A trash page** | The sidebar's panel list gains "🗄 Trash · 3"; selecting it replaces the centre column with a page (the same kind the Plugins manager uses): filter, multi-select, restore, permanent delete, empty |
| **A modal for every verb** | Restore, delete and empty each open a confirmation naming the count, the bytes it frees and whether it is reversible. Only the confirm button touches the disk |
| **Full row details** | Size, absolute path inside the trash, last activity and deletion time (`YYYY-MM-DD HH:mm:ss`) |
| **Hard to lose by accident** | The permanent verbs exist only inside the trash; every other entry point is reversible |
| **Localized** | Wording follows the host language (zh / en) live — row, modal and page all re-render on a switch |
| **Both layouts** | Per-project `<root>/<project>/session-<uuid>/` and flat `<root>/session-<uuid>/` |
| **CLI** | `--trash` / `--trash-list` / `--restore` / `--purge --yes` / `--empty --yes`, usable without the GUI |
| **Self-hosted index** | Ships a format-1 market index — add it as an index source for a private market |

## Requirements

- **DSH 0.2.x** (built against `0.2.1-rc.2`). It occupies `sidebar.workspaces.session.menu.item`,
  `main`, `sidebar.panellist` and `shell.overlay`
- **Node 20+** for the CLI and the installer only; the plugin itself runs inside the host

## Install

### From the plugin market

Host → **Settings → Plugins → Discover → Index sources**, add:

```
https://cdn.jsdelivr.net/gh/abangbang/dsh-delete-chat@main/market/index.json
```

(Icon paths in the index are relative; jsDelivr serves the whole repo as a static site, so they
resolve.)

### With `dsh plugin add`

```bash
dsh plugin --profile <your-profile> add https://github.com/abangbang/dsh-delete-chat/archive/refs/heads/main.tar.gz
```

On the official desktop app the profile belongs to the app's own plugin manager — install through
**Settings → Plugins** instead.

### With the script (any OS)

```bash
node scripts/install.mjs                  # install into ~/.dsh/profiles/desktop
node scripts/install.mjs --profile <dir>  # any profile
node scripts/install.mjs --dry-run        # print the patch diff, write nothing
node scripts/install.mjs --uninstall      # unmount + delete the package copy

./install.sh                              # macOS / Linux wrapper
.\install.ps1                             # Windows wrapper (also -Uninstall / -DryRun)
```

The wrappers only translate switches — the installer is one Node script, so all three OSes run the
same code. It also strips the pre-rename mount (`dsh-session-delete`), so an upgraded profile never
ends up with two.

### Manual mount

```bash
git clone https://github.com/abangbang/dsh-delete-chat.git \
  ~/.dsh/profiles/desktop/node_modules/dsh-delete-chat
```

Then append to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: delete-chat
      name: 'dsh-delete-chat'
```

**Restart DSH afterwards.** The plugin tree is composed at boot, and the client bundle is composed at
boot too and served with `immutable` cache headers — a page refresh returns the old bundle.

> ⚠️ Do not mount twice: after installing through `dsh plugin add` (which reads this package's
> `dsh.bundle.patch` and inserts the row itself), delete the hand-written `- insert:` block.

## Usage

### Delete

Session row → **"⋯" → Delete chat** → confirm. The row leaves the list, running work stops, and the
directory moves into the trash:

```
Status   moved to trash
Size     274.4 KB
```

Nothing is lost: this is a rename, and it stays reversible until you say otherwise.

### The trash

The sidebar's panel list (the nav above the workspaces, `aria-label="全局面板"`) gains a
**🗄 Trash · 3** row:

- the count follows the row's own text colour, is **hidden at zero**, shows `99+` above that, and
  moves the moment a delete lands;
- collapsed to the 56px rail it drops the name, keeping icon and count;
- selecting it opens a **page** listing every trashed conversation:

```
alpha conversation
  Size           2.0 KB
  Location       ~/.dsh/session-trash/--proj--/session-…
  Last activity  2026-10-27 17:08:07   ← the log's mtime; rename keeps it
  Deleted        2026-10-29 09:02:03
```

On that page:

- **filter** by title, path or project;
- **select** one row or all of them — the footer counts the selection;
- **Restore** moves the directories back, re-accounts them and unarchives them;
- **Delete permanently** and **Empty trash** live only here, and each asks first: a modal naming the
  count, the bytes it frees and that it cannot be undone.

The restore confirmation is amber; only the deleting ones are red. Colour is meaning here, not
decoration.

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
| 4 | Update `<home>/session-trash/index.json` | Keeps title, cwd, size, last activity and deletion time without decoding a single zstd frame |

### The trash layout

```
~/.dsh/
├── sessions/                      # live sessions
│   └── <project>/session-<uuid>/
└── session-trash/                 # everything you deleted
    ├── index.json                 # titles, cwd, sizes, timestamps
    └── <project>/session-<uuid>/  # the directory, byte for byte
```

**The directory tree is the truth**: a directory the manifest does not know is listed with its id as
the title, and a manifest row whose directory vanished is reported as `missing` instead of being
shown.

Restore reverses steps 2–3 and asks the live registry to re-project the row (`insertSessionBefore`)
when it can. Permanent deletion — only ever reachable from the trash — unlinks the directory,
forgets the manifest row and clears the projection cache.

### Why the panel row draws itself

The shell renders a panel-list row as `[glyph][title]`: the glyph is whatever occupies
`sidebar.panellist`, and the title is projected from the `label` passed at registration. Anything
*after* the name is therefore not yours — you cannot append a count from the glyph.

So this entry draws **icon, name and count** inside the glyph and hides the shell's duplicate title
with one row-scoped rule:

```css
button[aria-label="回收站"] > span[aria-hidden="true"] + span,
button[aria-label="Trash"]   > span[aria-hidden="true"] + span { display: none !important }
```

The selector anchors only on things this plugin owns — the exact `aria-label` it registers, and the
`aria-hidden` glyph span the shell wraps around it — so no other row is touched. The `aria-label`
itself stays, keeping the screen-reader name and the rail tooltip intact.

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
| A purge cannot unlink | the page lists path + reason, and `N failed` | The other selections were deleted; the failing one is still listed |
| Restore cannot move back | `N failed` with the path | The directory is still in the trash; nothing was half-moved |

Recovery, in the order to try it:

1. **Restore** — anything in the trash comes back with one click; that is the whole point.
2. **Retry** — the dialog and the page are idempotent: run them again after fixing the cause (close
   the handle, quit the sync client).
3. **CLI fallback** — quit DSH first; the lock that blocks a directory is usually the host's own
   handle. `dsh-delete-chat --trash | --restore | --purge --yes`.
4. **Roll back the store** — every rewrite leaves `workspace.json.bak-<stamp>` next to it.

## Platform support

| | Windows | macOS | Linux |
|---|---|---|---|
| Plugin runtime (host + client half) | ✅ verified locally | ✅ CI, `macos-latest` | ✅ CI, `ubuntu-latest` |
| Installer (`scripts/install.mjs` + wrappers) | ✅ verified locally | ✅ same suite | ✅ same suite |
| A directory another process holds | refused (`EBUSY`) → reported | removed (POSIX `unlink`) | removed (POSIX `unlink`) |
| Sessions root behind a symlink (macOS `tmpdir` shape) | n/a | ✅ covered | ✅ covered |
| Path derivation | drive-letter roots | POSIX roots | POSIX roots |

Windows and POSIX assertions live in one file (`test/platform.test.mjs`) and are mutually exclusive:
the branch that does not belong to the running OS is skipped **with a reason**, so a green run on one
platform never stands in for another.

The only platform difference users actually hit is the third row: on Windows a directory held open by
another process cannot be moved, so the dialog reports `EBUSY` and the fallback is
`dsh-delete-chat --trash <id>` after quitting DSH. On macOS and Linux that same move just succeeds.

## Known limitations

- **The trash is not the OS recycle bin.** It lives at `<DSH home>/session-trash`; deleting that
  directory by hand is a permanent delete that bypasses every confirmation.
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
npm test                 # 88 tests: host logic, trash, HTTP envelope, client, platform matrix, installer
npm run pack             # release/dsh-delete-chat-<version>.tgz
npm run market-index     # regenerate market/index.json from HEAD
```

Every suite runs against `mkdtemp` fixtures and a fake context — no running DSH, no real data. The
client suite renders the real components through a fake React, so the assertions read the text a
user would see.

## License

[MIT](LICENSE). Listing ≠ endorsement: this is third-party code; install only from sources you
trust.
