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
| **Row menu** | Session row "⋯" → Delete session, trash glyph, danger red, red-tinted hover |
| **Localized** | Wording follows the host language (zh / en) live — the row and an already-open dialog both re-render on a switch |
| **Confirmation** | Title, disk usage, directory count; then a field-by-field report |
| **Actually deletes** | Archive (stops running work) → recursive directory removal → atomic `workspace.json` rewrite (with backup) → projection-cache purge |
| **Both layouts** | Per-project `<root>/<project>/session-<uuid>/` and flat `<root>/session-<uuid>/` |
| **CLI fallback** | `dsh-delete-chat --list / --preview / --yes`, usable without the GUI |
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

Sidebar → session row → **"⋯" → Delete session** → confirm.

The dialog shows disk usage first, then the outcome:

```
Status        deleted
Archive       archived, running work stopped
Directories   1 removed
Freed         274.4 KB
Accounting    3 references removed
Proj. cache   1 entry cleared
```

### CLI

```bash
dsh-delete-chat --list                    # every session: size, archived, pinned, live
dsh-delete-chat --preview session-<uuid>  # read-only
dsh-delete-chat --yes session-<uuid>      # delete
dsh-delete-chat --home D:\other\.dsh --list
```

Without `--yes` it prints the preview and exits `1`.

## How it works

One deletion, four actions, fixed order:

| Step | Action | Why this order |
|---|---|---|
| 1 | `archiveSession(id, { stopActivity: true })` | Hides the row everywhere immediately, stops a running turn, and `ArchivedSessionGate` refuses later wakes — nothing re-surfaces while files disappear |
| 2 | Recursively remove `<sessions-root>/…/session-<uuid>/` | Takes `session.v4.jsonl.zstd` with it |
| 3 | Rewrite `storages/workspace.json` | Drops `sessionIds` / `archivedSessionIds` / `pinnedSessionIds`; temp file + atomic rename, original kept as `.bak-<stamp>` |
| 4 | Purge `storages/session_projcache/<id>.*` | Otherwise search keeps entries that cannot be opened |

A step-1 failure is not fatal — a session unknown to the workspace registry still gets its files
removed, and the report says so.

### API

`POST /delete-chat/api/{list,preview,delete}`, fenced by the host's own
`connection.requestRejection`. `sessionId` must start with `session-` and contain only
`[0-9A-Za-z._-]`: it is validated before it ever reaches `join()`/`rm()`, so `../`, drive letters
and separators cannot become path segments.

## Known limitations

- **No cascade**: subagent and forked child sessions survive, and their `parent_session` dangles.
- **Attachments untouched**: `~/.dsh/attachments/v1/objects` is content-addressed and shared, so
  deleting one session must not delete objects other sessions still reference.
- **In-memory object lingers**: the `sessions` service exposes only `create`/`get`/`list`, no
  dispose. An archived session runs no model step, and the object disappears on restart.
- **`workspace.json` may be rewritten once** by the host from its in-memory projection. The
  archive set still hides the row; a restart leaves it fully clean.

## Development

```bash
npm test                 # 30 tests: host logic / HTTP envelope / client bundle contract
npm run pack             # release/dsh-delete-chat-<version>.tgz
npm run market-index     # regenerate market/index.json from HEAD
npm run rename-owner --  <github-user> [display-name]
```

All three suites run against `mkdtemp` fixtures and a fake context — no running DSH, no real data.

## License

[MIT](LICENSE). Listing ≠ endorsement: this is third-party code; install only from sources you
trust.
