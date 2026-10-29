/**
 * dsh-delete-chat — client half.
 *
 * Deleting a conversation is a soft delete: the row moves to the trash, and the
 * trash is where the permanent verbs live.
 *
 * Two slot entries carry three surfaces:
 *
 *   `sidebar.workspaces.session.menu.item` — two rows: "Delete chat" (danger) and
 *   "Trash" (opens the panel). The provider passes `{ sessionId, displayTitle }`
 *   plus the open-state hook as the occurrence's hook context.
 *
 *   `shell.overlay` — the confirmation dialog and the trash panel. Both are
 *   always mounted and render nothing until a store asks for them, which keeps
 *   them above every pane without portal plumbing.
 *
 * Every mutation is a host call; the client never touches the filesystem.
 *
 * @module dsh-delete-chat/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-delete-chat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    /** Primitives are optional: a stripped host still gets working rows. */
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = null
    }

    const h = React.createElement

    /**
     * Build marker. It lands in the console on load so a stale client bundle — the
     * only failure mode that looks like "the plugin is ignoring me" — is visible
     * instead of guessed at.
     */
    const BUILD = '0.3.0+footer-row'

    /** Console trace that can never take the plugin down with it. */
    function log(message, ...rest) {
      try {
        console.info(`[dsh-delete-chat] ${message}`, ...rest)
      } catch {
        // a host without a console keeps working
      }
    }

    /** Error trace that can never take the plugin down with it. */
    function warn(message, ...rest) {
      try {
        console.error(`[dsh-delete-chat] ${message}`, ...rest)
      } catch {
        // a host without a console keeps working
      }
    }

    // ── copy (i18n) ────────────────────────────────────────────────────────

    /**
     * Locale namespace owned by this plugin. The host's locale service keeps the
     * dictionaries and resolves the active language; on a namespace miss it
     * repeats the lookup in `common` before showing the raw key.
     */
    const NAMESPACE = 'deleteChat'

    /** Both locales carry the same key set; `en` is the runtime's terminal fallback. */
    const DICTIONARIES = {
      zh: {
        menu: '删除会话',
        footerTrash: '回收站',
        title: '删除会话',
        body: '该会话会被移入回收站：从列表移除并停止运行中的工作，会话文件暂时保留。可在「回收站」中恢复，或在那里永久删除。',
        cancel: '取消',
        confirm: '移入回收站',
        working: '正在移入回收站…',
        done: '已移入回收站',
        close: '关闭',
        failedWith: '移入回收站失败：{message}',
        archivedOk: '已归档并停止运行中的工作',
        archivedSkipped: '归档被跳过',
        archivedFailedWith: '归档未完成（{detail}）',
        notFound: '磁盘上找不到该会话目录',
        keptNote: '可在「回收站」中恢复或永久删除。',
        statusLabel: '状态',
        archiveLabel: '归档',
        sizeLabel: '占用空间',
        locationLabel: '回收站位置',
        panelTitle: '回收站',
        panelSubtitle: '{n} 个会话',
        panelEmpty: '回收站是空的',
        panelLoading: '正在读取回收站…',
        filterPlaceholder: '筛选会话（标题 / 目录 / 项目）',
        selectAll: '全选',
        selectNone: '取消全选',
        selectedCount: '已选 {n} 项',
        restore: '恢复',
        purge: '永久删除',
        emptyTrash: '清空回收站',
        armPurge: '确认永久删除 {n} 项',
        armEmpty: '确认清空 {n} 项',
        refresh: '刷新',
        resultRestore: '已恢复 {ok} 项',
        resultPurge: '已永久删除 {ok} 项',
        resultEmpty: '回收站已清空，共删除 {ok} 项',
        freedSuffix: '，释放 {size}',
        failedSuffix: '，{n} 项失败',
        panelError: '回收站读取失败：{message}',
        panelHint: '永久删除不可撤销；恢复会把会话放回原来的目录。',
        detailSize: '大小',
        detailLocation: '文件位置',
        detailLastActive: '最后对话',
        detailDeletedAt: '删除时间',
        confirmPurgeTitle: '永久删除 {n} 项？',
        confirmPurgeBody: '这些会话（共 {size}）将从磁盘上彻底删除，无法恢复。',
        confirmEmptyTitle: '清空回收站？',
        confirmEmptyBody: '回收站里的 {n} 个会话（共 {size}）将被彻底删除，无法恢复。',
        confirmRestoreTitle: '恢复 {n} 项？',
        confirmRestoreBody: '这些会话会回到原来的目录，并从回收站移除。',
        confirmPurgeOk: '确认永久删除',
        confirmEmptyOk: '确认清空',
        confirmRestoreOk: '确认恢复',
      },
      en: {
        menu: 'Delete chat',
        footerTrash: 'Trash',
        title: 'Delete chat',
        body: 'This conversation moves to the trash: it leaves the list, running work stops, and its files are kept for now. Restore it, or delete it permanently, from the trash.',
        cancel: 'Cancel',
        confirm: 'Move to trash',
        working: 'Moving to trash…',
        done: 'Moved to trash',
        close: 'Close',
        failedWith: 'Could not move to trash: {message}',
        archivedOk: 'archived, running work stopped',
        archivedSkipped: 'archive skipped',
        archivedFailedWith: 'archive did not complete ({detail})',
        notFound: 'no session directory on disk',
        keptNote: 'Restore it or delete it permanently from the trash.',
        statusLabel: 'Status',
        archiveLabel: 'Archive',
        sizeLabel: 'Size',
        locationLabel: 'Trash location',
        panelTitle: 'Trash',
        panelSubtitle: '{n} conversations',
        panelEmpty: 'The trash is empty',
        panelLoading: 'Reading the trash…',
        filterPlaceholder: 'Filter by title, path or project',
        selectAll: 'Select all',
        selectNone: 'Clear selection',
        selectedCount: '{n} selected',
        restore: 'Restore',
        purge: 'Delete permanently',
        emptyTrash: 'Empty trash',
        armPurge: 'Confirm permanent deletion of {n}',
        armEmpty: 'Confirm emptying {n}',
        refresh: 'Refresh',
        resultRestore: 'Restored {ok}',
        resultPurge: 'Permanently deleted {ok}',
        resultEmpty: 'Trash emptied, {ok} deleted',
        freedSuffix: ', freed {size}',
        failedSuffix: ', {n} failed',
        panelError: 'Could not read the trash: {message}',
        panelHint: 'Permanent deletion cannot be undone; restore puts a conversation back where it was.',
        detailSize: 'Size',
        detailLocation: 'Location',
        detailLastActive: 'Last activity',
        detailDeletedAt: 'Deleted',
        confirmPurgeTitle: 'Delete {n} permanently?',
        confirmPurgeBody: 'These conversations ({size} in total) are removed from disk. This cannot be undone.',
        confirmEmptyTitle: 'Empty the trash?',
        confirmEmptyBody: 'All {n} conversations ({size} in total) are removed from disk. This cannot be undone.',
        confirmRestoreTitle: 'Restore {n}?',
        confirmRestoreBody: 'They go back to their original directories and leave the trash.',
        confirmPurgeOk: 'Confirm permanent deletion',
        confirmEmptyOk: 'Confirm empty',
        confirmRestoreOk: 'Confirm restore',
      },
    }

    /**
     * Fill `{name}` placeholders. The host runtime interpolates the same way; this
     * copy only runs on the bootstrap path, where no host resolver exists.
     * @param template - resolved template text.
     * @param params - substitution values.
     * @returns the interpolated string.
     */
    function interpolate(template, params) {
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /** Locale used before (or without) the host service: the browser's own language. */
    const bootstrapLocale = (() => {
      try {
        const tag = typeof navigator === 'undefined' ? '' : String(navigator.language ?? '')
        return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    })()

    /** Active resolver; {@link wireLocale} swaps in the host service's bound `t`. */
    let resolve = (key, params) => interpolate(DICTIONARIES[bootstrapLocale][key] ?? DICTIONARIES.en[key] ?? key, params)

    /**
     * The one text lookup every component uses.
     * @param key - dictionary key.
     * @param params - `{n}` / `{message}` / `{detail}` / `{size}` substitution values.
     * @returns the localized string.
     */
    function t(key, params) {
      return resolve(key, params)
    }

    /** Locale-change plumbing; swapped in by {@link wireLocale}. */
    let subscribeImpl = () => () => {}
    let revisionImpl = () => 0

    /**
     * Stable `useSyncExternalStore` subscriber: a language switch must re-render
     * every string this plugin draws, including an open panel.
     * @param listener - React invalidator.
     * @returns unsubscribe.
     */
    function subscribeLocale(listener) {
      return subscribeImpl(listener)
    }

    /** Snapshot is a primitive revision, so React compares it cheaply. */
    function getLocaleRevision() {
      return revisionImpl()
    }

    /** Re-render this component whenever the active language changes. */
    function useLocale() {
      React.useSyncExternalStore(subscribeLocale, getLocaleRevision, () => 0)
    }

    /**
     * Bind to the host locale service: register both dictionaries, take its
     * resolver, follow its notifications. A stripped host (or a test harness) has
     * no service, and the bootstrap resolver stays in place.
     * @param ctx - client plugin context.
     */
    function wireLocale(ctx) {
      let service
      try {
        service = typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale
      } catch {
        service = undefined
      }
      if (service === undefined || service === null) return
      try {
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => service.register(NAMESPACE, DICTIONARIES), 'dsh-delete-chat: locale dictionaries')
        } else {
          service.register(NAMESPACE, DICTIONARIES)
        }
      } catch (error) {
        // Re-applying over a live namespace throws; the first registration wins.
        console.warn('dsh-delete-chat: locale registration skipped:', error)
      }
      const bound = service.bind(NAMESPACE)
      resolve = (key, params) => bound(key, params)
      subscribeImpl = (listener) => service.subscribe(listener)
      revisionImpl = () => service.getSnapshot().revision
    }

    // ── danger styling ────────────────────────────────────────────────────

    /**
     * The design system exposes no `danger` prop on `MenuItemButton`, so the row
     * is coloured where a plugin can prove it wins: label and glyph are wrapped in
     * spans carrying an explicit colour, and the row gets a class plus a runtime
     * stylesheet for the hover wash.
     */
    /** Amber: the restore path only, so it never reads as "danger". */
    const ACCENT = 'rgb(226, 179, 68)'
    const ACCENT_FILL = 'rgba(226, 179, 68, 0.92)'
    const DANGER = 'rgb(255, 123, 114)'
    const DANGER_HOVER = 'rgba(255, 123, 114, 0.15)'
    const DANGER_ROW_CLASS = 'dsh-delete-chat__danger-row'
    const STYLE_ID = 'dsh-delete-chat-style'

    /** Install the row's hover rules once per page. */
    function installRowStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      // The panel-list row is rendered by the shell as `[glyph][title]`, with the
      // title carrying the same text this entry draws inside the glyph. Hiding it
      // is scoped to this row only, and anchored on two things we own: the exact
      // aria-label (the shell sets it from our `label`) and the aria-hidden glyph
      // span that precedes it.
      const labels = [DICTIONARIES.zh.footerTrash, DICTIONARIES.en.footerTrash]
      const hideDuplicateTitle = labels
        .map((label) => `button[aria-label="${label}"] > span[aria-hidden="true"] + span`)
        .join(',\n')

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        `.${DANGER_ROW_CLASS}:hover,`,
        `.${DANGER_ROW_CLASS}:focus-visible,`,
        `.${DANGER_ROW_CLASS}[data-highlighted="true"] {`,
        `  background: ${DANGER_HOVER} !important;`,
        '}',
        `${hideDuplicateTitle} {`,
        '  display: none !important;',
        '}',
      ].join('\n')
      document.head.appendChild(style)
    }

    /**
     * The trash glyph, or undefined when the surface has none.
     * @returns the icon component.
     */
    function resolveTrashIcon() {
      return primitives?.IconTrashOutlineRegular
        ?? primitives?.IconTrashOutlineMedium
        ?? primitives?.IconDeleteOutlineRegular
    }

    /**
     * The archive glyph used by the trash row, falling back to the trash glyph.
     * @returns the icon component.
     */
    function resolveArchiveIcon() {
      return primitives?.IconArchiveOutlineRegular
        ?? primitives?.IconArchiveOutlineMedium
        ?? resolveTrashIcon()
    }

    /**
     * Wrap an icon in a coloured span. Fluent icons stroke with `currentColor`, so
     * the wrapper decides the stroke.
     * @param Icon - icon component.
     * @param size - pixel size.
     * @param color - CSS colour, or undefined to inherit.
     * @returns the wrapped node, or null.
     */
    function glyph(Icon, size, color) {
      if (typeof Icon !== 'function') return null
      return h('span', {
        style: {
          color,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      }, h(Icon, { size }))
    }

    // ── stores ────────────────────────────────────────────────────────────

    /**
     * A minimal external store with stable reader and subscriber identities, so
     * `useSyncExternalStore` never re-subscribes on render.
     * @param initial - initial value.
     * @returns `{ get, set, subscribe }`.
     */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      const wake = () => {
        for (const listener of [...listeners]) listener()
      }
      return {
        get: () => value,
        set(next) {
          value = next
          wake()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    /** The global panel id: the `main` key and the panel-list row id are the same. */
    const TRASH_PANEL_ID = 'delete-chat:trash'

    /** The soft-delete dialog: null when closed. */
    const dialogStore = createStore(null)
    /** The trash page state: `idle` until the panel is first selected. */
    const panelStore = createStore({
      phase: 'idle',
      rows: [],
      selected: [],
      filter: '',
      busy: null,
      /** A verb waiting for its confirmation modal. */
      pending: null,
      result: null,
      error: undefined,
    })
    /** How many conversations the trash holds — the sidebar footer badge. */
    const trashCountStore = createStore(0)

    // ── transport ─────────────────────────────────────────────────────────

    /**
     * Absolute API base. The web GUI and the desktop shell both serve this
     * plugin's routes from the page origin.
     * @returns base URL without a trailing slash.
     */
    function apiBase() {
      const location = globalThis.location
      if (location !== undefined && /^https?:$/.test(location.protocol)) return location.origin
      return ''
    }

    /**
     * One fenced host call.
     * @param method - route tail: `trash`, `trashList`, `restore`, `purge`, `empty`.
     * @param payload - JSON body.
     * @returns the `value` field of an ok envelope.
     */
    async function callHost(method, payload) {
      const response = await fetch(`${apiBase()}/delete-chat/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
      }
      return body.value
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

    /**
     * Short local date for a timestamp, or an empty string when unknown.
     * @param iso - ISO timestamp.
     * @returns e.g. `10-29 14:02`.
     */
    function formatDateTime(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      try {
        const date = new Date(iso)
        if (Number.isNaN(date.getTime())) return ''
        const pad = (value) => String(value).padStart(2, '0')
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      } catch {
        return ''
      }
    }

    /** No-op open-state hook for hosts that do not pass the hook context. */
    const useNoMenuState = () => [false, () => {}]

    // ── soft delete dialog ────────────────────────────────────────────────

    /**
     * Open the confirmation for one session.
     * @param props - `{ sessionId, displayTitle, cwd? }`.
     */
    function openDeleteDialog(props) {
      dialogStore.set({
        phase: 'confirm',
        sessionId: props.sessionId,
        displayTitle: props.displayTitle ?? props.sessionId,
        cwd: typeof props.cwd === 'string' ? props.cwd : undefined,
        report: undefined,
        error: undefined,
      })
    }

    /**
     * The confirmation dialog. Confirm moves the session to the trash; nothing
     * here deletes anything for good.
     * @returns the dialog element, or null while closed.
     */
    function DeleteDialog() {
      useLocale()
      const current = React.useSyncExternalStore(dialogStore.subscribe, dialogStore.get, dialogStore.get)
      if (current === null) return null

      const close = () => dialogStore.set(null)

      const run = async () => {
        dialogStore.set({ ...current, phase: 'working', error: undefined })
        try {
          const report = await callHost('trash', {
            sessionId: current.sessionId,
            displayTitle: current.displayTitle,
            cwd: current.cwd,
          })
          dialogStore.set({ ...current, phase: 'done', report })
          // The sidebar count lives on its own store: the trash page is not open,
          // so nothing else would move it.
          void refreshTrashCount()
        } catch (error) {
          dialogStore.set({ ...current, phase: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const busy = current.phase === 'working'
      const finished = current.phase === 'done'
      const report = current.report

      return h('div', {
        style: styles.backdrop,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) close()
        },
        onKeyDown: (event) => {
          if (event.key === 'Escape' && !busy) close()
        },
        tabIndex: -1,
      }, h('div', { style: styles.card, role: 'dialog', 'aria-modal': 'true' },
        h('div', { style: styles.header },
          h('span', { style: styles.heading }, glyph(resolveTrashIcon(), 15, DANGER), t('title')),
          h('button', {
            type: 'button',
            onClick: () => { if (!busy) close() },
            style: styles.iconButton,
            'aria-label': t('close'),
            disabled: busy,
          }, '×')),

        h('div', { style: styles.sessionName }, current.displayTitle),

        h('div', { style: styles.body },
          finished
            ? h('div', { style: styles.reportTable },
              [
                [t('statusLabel'), t('done')],
                [t('archiveLabel'), report?.archived === 'ok'
                  ? t('archivedOk')
                  : report?.archived === 'skipped'
                    ? t('archivedSkipped')
                    : t('archivedFailedWith', { detail: report?.archived })],
                [t('sizeLabel'), formatBytes(report?.bytes ?? 0)],
                [t('locationLabel'), report?.path ?? ''],
              ].map(([label, value]) => h('div', { key: label, style: styles.reportRow },
                h('span', { style: styles.reportLabel }, label),
                h('span', { style: styles.reportValue }, value))))
            : h('p', { style: styles.paragraph }, t('body'))),

        current.phase === 'error' || current.error !== undefined
          ? h('div', { style: styles.errorBox }, t('failedWith', { message: current.error ?? '' }))
          : null,

        h('div', { style: styles.footer },
          h('span', { style: styles.hint }, busy ? t('working') : t('keptNote')),
          h('div', { style: styles.buttons },
            h('button', {
              type: 'button',
              onClick: () => { if (!busy) close() },
              style: styles.secondaryButton,
              disabled: busy,
            }, finished ? t('close') : t('cancel')),
            finished
              ? null
              : h('button', {
                type: 'button',
                onClick: run,
                style: busy ? { ...styles.dangerButton, opacity: 0.6 } : styles.dangerButton,
                disabled: busy,
              }, glyph(resolveTrashIcon(), 15), busy ? t('working') : t('confirm'))))))
    }

    // ── trash panel ───────────────────────────────────────────────────────

    /**
     * Refresh the footer badge without opening anything. A failed read keeps the
     * last known count: the badge is a hint, not a contract.
     */
    async function refreshTrashCount() {
      try {
        const listing = await callHost('trashList', {})
        trashCountStore.set(Array.isArray(listing?.rows) ? listing.rows.length : 0)
      } catch {
        // offline, or a host without the route: leave the badge alone
      }
    }

    /**
     * Load the page the first time it is selected. Later visits keep the rows and
     * a manual refresh; the seeded `idle` phase makes this safe to call on every
     * render, which is why the panel needs no mount lifecycle of its own.
     */
    function ensureTrashLoaded() {
      const state = panelStore.get()
      if (state.phase !== 'idle') return
      panelStore.set({ ...state, phase: 'loading' })
      void reloadTrash()
    }

    /** Refetch the trash, keeping the filter and dropping vanished selections. */
    async function reloadTrash() {
      const state = panelStore.get()
      if (state === null) return
      try {
        const listing = await callHost('trashList', {})
        const rows = Array.isArray(listing?.rows) ? listing.rows : []
        trashCountStore.set(rows.length)
        const latest = panelStore.get()
        if (latest === null) return
        panelStore.set({
          ...latest,
          phase: 'ready',
          rows,
          selected: (latest.selected ?? []).filter((id) => rows.some((row) => row.sessionId === id)),
          error: undefined,
        })
      } catch (error) {
        const latest = panelStore.get()
        if (latest === null) return
        panelStore.set({
          ...latest,
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    /**
     * Rows matching the filter, case-insensitively, across title, cwd and project.
     * @param state - panel state.
     * @returns the visible rows.
     */
    function visibleRows(state) {
      const needle = (state.filter ?? '').trim().toLowerCase()
      if (needle === '') return state.rows ?? []
      return (state.rows ?? []).filter((row) => [row.displayTitle, row.cwd, row.project]
        .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)))
    }

    /**
     * Run one bulk action and fold its outcome into a single result line.
     * @param kind - `restore` | `purge` | `empty`.
     */
    async function runPanelAction(kind, ids) {
      const state = panelStore.get()
      if (state === null) return
      const targets = Array.isArray(ids) ? ids : state.selected
      panelStore.set({ ...state, busy: kind, pending: null, error: undefined })
      try {
        let result
        if (kind === 'restore') {
          const report = await callHost('restore', { sessionIds: targets })
          result = { kind, ok: (report?.restored ?? []).length, freedBytes: 0, failures: report?.failures ?? [] }
        } else if (kind === 'purge') {
          const report = await callHost('purge', { sessionIds: targets })
          result = { kind, ok: (report?.removedDirectories ?? []).length, freedBytes: report?.freedBytes ?? 0, failures: report?.failures ?? [] }
        } else {
          const report = await callHost('empty', {})
          result = { kind, ok: (report?.removedDirectories ?? []).length, freedBytes: report?.freedBytes ?? 0, failures: report?.failures ?? [] }
        }
        const latest = panelStore.get()
        if (latest === null) return
        panelStore.set({ ...latest, busy: null, result })
        await reloadTrash()
      } catch (error) {
        const latest = panelStore.get()
        if (latest === null) return
        panelStore.set({ ...latest, busy: null, error: error instanceof Error ? error.message : String(error) })
      }
    }

    /**
     * The trash panel: filter, multi-select, restore, purge, empty.
     * @returns the panel element, or null while closed.
     */
    function TrashPage() {
      useLocale()
      React.useEffect(() => {
        ensureTrashLoaded()
      })
      const state = React.useSyncExternalStore(panelStore.subscribe, panelStore.get, panelStore.get)
      const rows = visibleRows(state)
      const selected = new Set(state.selected ?? [])
      const busy = state.busy !== null
      const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.sessionId))
      const count = selected.size

      const patch = (next) => {
        const latest = panelStore.get()
        if (latest !== null) panelStore.set({ ...latest, ...next })
      }

      const toggle = (id) => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        patch({ selected: [...next] })
      }

      const toggleAll = () => patch({
        selected: allSelected ? [] : rows.map((row) => row.sessionId),
      })

      /**
       * Open the confirmation modal for one verb. The click itself does nothing:
       * the modal names the verb, the count and the bytes, so the second click is
       * an informed one.
       * @param kind - `restore` | `purge` | `empty`.
       */
      const ask = (kind) => {
        const all = state.rows ?? []
        const targets = kind === 'empty' ? all.map((row) => row.sessionId) : [...selected]
        if (targets.length === 0) return
        const chosen = all.filter((row) => targets.includes(row.sessionId))
        const bytes = chosen.reduce((sum, row) => sum + (typeof row.bytes === 'number' ? row.bytes : 0), 0)
        patch({ pending: { kind, ids: targets, count: targets.length, bytes } })
      }

      const resultLine = state.result === null || state.result === undefined
        ? null
        : [
          state.result.kind === 'restore'
            ? t('resultRestore', { ok: state.result.ok })
            : state.result.kind === 'purge'
              ? t('resultPurge', { ok: state.result.ok })
              : t('resultEmpty', { ok: state.result.ok }),
          state.result.kind === 'restore' ? '' : t('freedSuffix', { size: formatBytes(state.result.freedBytes) }),
          (state.result.failures ?? []).length > 0 ? t('failedSuffix', { n: state.result.failures.length }) : '',
        ].join('')

      return h('div', { style: styles.page },
        h('div', { style: styles.header },
          h('span', { style: styles.heading }, glyph(resolveArchiveIcon(), 15, undefined), t('panelTitle')),
          h('span', { style: styles.subtitle }, t('panelSubtitle', { n: (state.rows ?? []).length })),
          h('span', { style: styles.pagePath }, panelStore.get()?.root ?? '')),

        h('div', { style: styles.toolbar },
          h('input', {
            type: 'search',
            value: state.filter ?? '',
            placeholder: t('filterPlaceholder'),
            onChange: (event) => patch({ filter: event.target.value }),
            style: styles.search,
          }),
          h('button', {
            type: 'button',
            onClick: toggleAll,
            style: styles.secondaryButton,
            disabled: rows.length === 0 || busy,
          }, allSelected ? t('selectNone') : t('selectAll')),
          h('button', {
            type: 'button',
            onClick: () => { reloadTrash() },
            style: styles.secondaryButton,
            disabled: busy,
          }, t('refresh'))),

        h('div', { style: styles.listBox },
          state.phase === 'loading'
            ? h('div', { style: styles.emptyNote }, t('panelLoading'))
            : rows.length === 0
              ? h('div', { style: styles.emptyNote }, t('panelEmpty'))
              : rows.map((row) => h('label', {
                key: row.sessionId,
                style: { ...styles.row, background: selected.has(row.sessionId) ? 'rgba(255,255,255,0.06)' : 'transparent' },
              },
              h('input', {
                type: 'checkbox',
                checked: selected.has(row.sessionId),
                onChange: () => toggle(row.sessionId),
                disabled: busy,
              }),
              h('span', { style: styles.rowText },
                h('span', { style: styles.rowTitle }, row.displayTitle),
                h('span', { style: styles.detailGrid },
                  ...[
                    [t('detailSize'), formatBytes(row.bytes ?? 0)],
                    [t('detailLocation'), row.path ?? '—'],
                    [t('detailLastActive'), formatDateTime(row.lastActiveAt) || '—'],
                    [t('detailDeletedAt'), formatDateTime(row.deletedAt) || '—'],
                  ].flatMap(([label, value]) => [
                    h('span', { key: `${label}`, style: styles.detailLabel }, label),
                    h('span', { key: `${label}:value`, style: styles.detailValue, title: String(value) }, String(value)),
                  ])))))),

        state.error !== undefined
          ? h('div', { style: styles.errorBox }, t('panelError', { message: state.error }))
          : null,

        resultLine === null ? null : h('div', { style: styles.resultLine }, resultLine),

        h('div', { style: styles.footer },
          h('span', { style: styles.hint }, t('panelHint')),
          h('div', { style: styles.buttons },
            h('span', { style: styles.selectedCount }, t('selectedCount', { n: count })),
            h('button', {
              type: 'button',
              onClick: () => { if (!busy && count > 0) ask('restore') },
              style: count > 0 ? styles.restoreButton : styles.secondaryButton,
              disabled: busy || count === 0,
            }, t('restore')),
            h('button', {
              type: 'button',
              onClick: () => { if (!busy && count > 0) ask('purge') },
              style: count > 0 ? styles.dangerOutlineButton : styles.secondaryButton,
              disabled: busy || count === 0,
            }, t('purge')),
            h('button', {
              type: 'button',
              onClick: () => { if (!busy && (state.rows ?? []).length > 0) ask('empty') },
              style: (state.rows ?? []).length > 0 ? styles.dangerOutlineButton : styles.secondaryButton,
              disabled: busy || (state.rows ?? []).length === 0,
            }, t('emptyTrash')))),
        state.pending === null || state.pending === undefined ? null : h(TrashConfirm, { pending: state.pending }))
    }

    // ── sidebar footer ────────────────────────────────────────────────────

    /**
     * The trash entry that lives in the sidebar footer, always visible. The seat
     * `sidebar.footer.action` exists for exactly this: a persistent control rather
     * than a per-session menu item. The badge counts what the trash holds.
     * @returns the footer button.
     */
    function TrashGlyph(props) {
      useLocale()
      const count = React.useSyncExternalStore(trashCountStore.subscribe, trashCountStore.get, trashCountStore.get)
      const size = typeof props?.size === 'number' ? props.size : 16
      // The shell renders the row as `[glyph][label]`, so a count placed after the
      // label cannot come from the glyph alone. This entry therefore draws the
      // whole row itself — icon, name, count — and `installRowStyles` hides the
      // shell's own title for this one row (matched by its aria-label, which is
      // ours) so the name is not printed twice.
      const wide = size <= 16
      const shown = count > 99 ? '99+' : String(count)
      return h('span', { style: styles.panelGlyph },
        glyph(resolveArchiveIcon(), size, undefined),
        wide ? h('span', { style: styles.panelName }, t('footerTrash')) : null,
        count > 0 ? h('span', { style: styles.panelCount }, shown) : null)
    }

    // ── session row menu ──────────────────────────────────────────────────

    // ── confirmation modal ────────────────────────────────────────────────

    /**
     * The modal every verb in the panel goes through. It names the verb, the count
     * and the bytes, so the second click is an informed one.
     * @param props - `{ pending }` from the page store.
     * @returns the modal element.
     */
    function TrashConfirm(props) {
      useLocale()
      const pending = props.pending
      const state = panelStore.get()
      const busy = state !== null && state.busy !== null
      const close = () => {
        const latest = panelStore.get()
        if (latest !== null) panelStore.set({ ...latest, pending: null })
      }

      const title = pending.kind === 'empty'
        ? t('confirmEmptyTitle')
        : pending.kind === 'restore'
          ? t('confirmRestoreTitle', { n: pending.count })
          : t('confirmPurgeTitle', { n: pending.count })

      const body = pending.kind === 'empty'
        ? t('confirmEmptyBody', { n: pending.count, size: formatBytes(pending.bytes) })
        : pending.kind === 'restore'
          ? t('confirmRestoreBody')
          : t('confirmPurgeBody', { n: pending.count, size: formatBytes(pending.bytes) })

      const okLabel = pending.kind === 'restore'
        ? t('confirmRestoreOk')
        : pending.kind === 'empty'
          ? t('confirmEmptyOk')
          : t('confirmPurgeOk')

      return h('div', {
        style: styles.backdrop,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) close()
        },
        onKeyDown: (event) => {
          if (event.key === 'Escape' && !busy) close()
        },
        tabIndex: -1,
      }, h('div', { style: styles.card, role: 'dialog', 'aria-modal': 'true' },
        h('div', { style: styles.header },
          h('span', { style: styles.heading }, title),
          h('button', {
            type: 'button',
            onClick: () => { if (!busy) close() },
            style: styles.iconButton,
            'aria-label': t('close'),
            disabled: busy,
          }, '×')),
        h('p', { style: styles.paragraph }, body),
        h('div', { style: styles.footer },
          h('span', { style: styles.hint }, pending.kind === 'restore' ? t('confirmRestoreBody') : t('panelHint')),
          h('div', { style: styles.buttons },
            h('button', {
              type: 'button',
              onClick: () => { if (!busy) close() },
              style: styles.secondaryButton,
              disabled: busy,
            }, t('cancel')),
            h('button', {
              type: 'button',
              onClick: () => { if (!busy) runPanelAction(pending.kind, pending.ids) },
              style: pending.kind === 'restore' ? styles.primaryButton : styles.dangerButton,
              disabled: busy,
            }, okLabel)))))
    }

    /**
     * The two rows this plugin adds to a session's "⋯" menu: the soft delete, and
     * the trash panel that owns the permanent verbs.
     * @param props - `{ sessionId, displayTitle, cwd?, useMenuOpenState? }`.
     * @returns a fragment holding both rows.
     */
    function SessionMenuRows(props) {
      useLocale()
      const useMenuOpenState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState : useNoMenuState
      const [, setMenuOpen] = useMenuOpenState()
      const Item = primitives?.MenuItemButton
      const close = () => setMenuOpen(false)

      const onDelete = () => {
        close()
        openDeleteDialog(props)
      }

      /** One row, through the design system when it is available. */
      const row = (key, icon, label, onSelect, danger) => {
        if (typeof Item === 'function') {
          return h(Item, {
            key,
            icon: glyph(icon, 14, danger ? DANGER : undefined),
            className: danger ? DANGER_ROW_CLASS : undefined,
            style: danger ? { color: DANGER } : undefined,
            onSelect,
          }, danger ? h('span', { style: { color: DANGER } }, label) : label)
        }
        return h('button', {
          key,
          type: 'button',
          className: danger ? DANGER_ROW_CLASS : undefined,
          onClick: onSelect,
          style: { ...styles.fallbackRow, color: danger ? DANGER : 'inherit' },
        }, glyph(icon, 14, danger ? DANGER : undefined), danger ? h('span', { style: { color: DANGER } }, label) : label)
      }

      return row('delete', resolveTrashIcon(), t('menu'), onDelete, true)
    }

    // ── overlay host ──────────────────────────────────────────────────────

    /**
     * Both surfaces live behind one `shell.overlay` entry: each store decides
     * whether its surface is on screen.
     * @returns a fragment holding whichever surface is open.
     */
    function Overlays() {
      useLocale()
      const dialog = React.useSyncExternalStore(dialogStore.subscribe, dialogStore.get, dialogStore.get)
      if (dialog === null) return null
      return h(DeleteDialog)
    }

    // ── styles ────────────────────────────────────────────────────────────

    const styles = {
      fallbackRow: {
        display: 'block',
        width: '100%',
        padding: '7px 12px',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
      backdrop: {
        position: 'fixed',
        inset: '0',
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
      },
      card: {
        width: 'min(520px, calc(100vw - 48px))',
        maxHeight: 'calc(100vh - 96px)',
        overflow: 'auto',
        background: '#1f1f23',
        color: '#e9e9ec',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '14px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        padding: '18px 20px 16px',
        font: '14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      },
      panel: {
        width: 'min(720px, calc(100vw - 48px))',
        maxHeight: 'calc(100vh - 72px)',
        display: 'flex',
        flexDirection: 'column',
        background: '#1f1f23',
        color: '#e9e9ec',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '14px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        padding: '18px 20px 16px',
        font: '14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      },
      header: { display: 'flex', alignItems: 'center', gap: '10px' },
      heading: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '15px',
        fontWeight: 600,
        letterSpacing: '0.01em',
      },
      subtitle: { color: 'rgba(233,233,236,0.5)', fontSize: '12.5px', flex: '1 1 auto' },
      iconButton: {
        border: 'none',
        background: 'transparent',
        color: 'rgba(233,233,236,0.62)',
        fontSize: '20px',
        lineHeight: 1,
        cursor: 'pointer',
        padding: '0 4px',
        marginLeft: 'auto',
      },
      sessionName: {
        marginTop: '10px',
        padding: '8px 10px',
        borderRadius: '8px',
        background: 'rgba(255,255,255,0.05)',
        color: 'rgba(233,233,236,0.86)',
        wordBreak: 'break-all',
      },
      body: { marginTop: '12px', color: 'rgba(233,233,236,0.78)' },
      paragraph: { margin: 0 },
      toolbar: { display: 'flex', gap: '8px', marginTop: '14px', alignItems: 'center' },
      search: {
        flex: '1 1 auto',
        minWidth: '0',
        padding: '7px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.04)',
        color: 'inherit',
        font: 'inherit',
      },
      listBox: {
        marginTop: '12px',
        flex: '1 1 auto',
        minHeight: '120px',
        maxHeight: '46vh',
        overflow: 'auto',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px',
      },
      emptyNote: { padding: '28px 16px', textAlign: 'center', color: 'rgba(233,233,236,0.45)' },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        cursor: 'pointer',
      },
      rowText: { display: 'flex', flexDirection: 'column', minWidth: '0', gap: '2px' },
      rowTitle: { color: 'rgba(233,233,236,0.94)', wordBreak: 'break-word' },
      rowMeta: { color: 'rgba(233,233,236,0.45)', fontSize: '12px' },
      errorBox: {
        marginTop: '12px',
        padding: '9px 11px',
        borderRadius: '8px',
        background: 'rgba(226,80,80,0.13)',
        border: '1px solid rgba(226,80,80,0.36)',
        color: '#ffb4b4',
        fontSize: '12.5px',
        wordBreak: 'break-word',
      },
      resultLine: {
        marginTop: '12px',
        padding: '8px 11px',
        borderRadius: '8px',
        background: 'rgba(255,255,255,0.05)',
        color: 'rgba(233,233,236,0.8)',
        fontSize: '12.5px',
      },
      footer: {
        marginTop: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      },
      hint: { color: 'rgba(233,233,236,0.45)', fontSize: '12px', flex: '1 1 220px' },
      buttons: { display: 'flex', gap: '8px', flex: '0 0 auto', alignItems: 'center' },
      selectedCount: { color: 'rgba(233,233,236,0.55)', fontSize: '12px', marginRight: '2px' },
      secondaryButton: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
      dangerButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(226, 80, 80, 0.85)',
        background: '#c93b3b',
        color: '#fff',
        font: 'inherit',
        fontWeight: 600,
        cursor: 'pointer',
      },
      page: {
        boxSizing: 'border-box',
        height: '100%',
        width: '100%',
        overflow: 'auto',
        padding: 'calc(var(--dsh-frame-top-clearance, 0px) + 20px) 28px 24px',
        color: 'inherit',
        font: '14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      },
      pagePath: {
        color: 'rgba(233,233,236,0.35)',
        fontSize: '11.5px',
        maxWidth: '46%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        direction: 'rtl',
      },
      panelGlyph: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
        maxWidth: '100%',
      },
      panelName: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '13px',
        lineHeight: '20px',
      },
      panelCount: {
        flex: 'none',
        fontSize: '11px',
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: '0.02em',
        // No colour of its own: the count reads as part of the row's own label.
        color: 'inherit',
        opacity: 0.72,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      },
      footerBadge: {
        minWidth: '20px',
        padding: '0 6px',
        borderRadius: '10px',
        background: 'rgba(255,255,255,0.10)',
        color: 'rgba(233,233,236,0.75)',
        fontSize: '11.5px',
        lineHeight: '18px',
        textAlign: 'center',
      },
      detailGrid: {
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        columnGap: '10px',
        rowGap: '1px',
        marginTop: '3px',
      },
      detailLabel: { color: 'rgba(233,233,236,0.42)', fontSize: '12px' },
      detailValue: {
        color: 'rgba(233,233,236,0.66)',
        fontSize: '12px',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      dangerOutlineButton: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(226, 80, 80, 0.55)',
        background: 'rgba(226, 80, 80, 0.10)',
        color: '#ffb4b4',
        font: 'inherit',
        cursor: 'pointer',
      },
      primaryButton: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: `1px solid ${ACCENT}`,
        background: ACCENT_FILL,
        color: '#2a1e00',
        font: 'inherit',
        fontWeight: 600,
        cursor: 'pointer',
      },
      restoreButton: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: `1px solid rgba(226, 179, 68, 0.55)`,
        background: 'rgba(226, 179, 68, 0.12)',
        color: ACCENT,
        font: 'inherit',
        cursor: 'pointer',
      },
      reportTable: { display: 'grid', gap: '6px' },
      reportRow: { display: 'flex', justifyContent: 'space-between', gap: '12px' },
      reportLabel: { color: 'rgba(233,233,236,0.52)' },
      reportValue: { color: 'rgba(233,233,236,0.92)', wordBreak: 'break-all', textAlign: 'right' },
    }

    // ── mount ─────────────────────────────────────────────────────────────

    /** Client services this plugin touches. */
    const inject = ['slots']

    /**
     * Attach one component to one seat.
     *
     * Every seat is registered on its own: a seat that is missing, renamed, or
     * stricter about its options must cost only itself, and it must leave a trace
     * in the console rather than disappearing quietly.
     *
     * @param ctx - client plugin context.
     * @param seat - slot name.
     * @param id - this plugin's cell id inside the seat.
     * @param component - the occupant.
     * @param options - extra register options (`order`, `label`).
     * @returns the disposer, or a no-op when the seat refused.
     */
    function attachSeat(ctx, seat, descriptor, component) {
      try {
        const disposer = ctx.slots.inject(seat, () => ctx.slots.register({ name: seat, ...descriptor }, component))
        log(`attached to ${seat} (${descriptor.id ?? descriptor.key ?? 'default'})`)
        return disposer
      } catch (error) {
        warn(`could not attach to ${seat}:`, error)
        return () => {}
      }
    }

    /**
     * Register the two slot entries.
     *
     * The locale service is required by `ctx.inject` rather than by the exported
     * `inject` list: a host without it still gets a working menu (bootstrap
     * wording), while a host that mounts it later still ends up bound.
     *
     * @param ctx - client plugin context.
     */
    function apply(ctx) {
      installRowStyles()

      if (typeof ctx.inject === 'function') ctx.inject(['locale'], (scoped) => wireLocale(scoped))
      else wireLocale(ctx)

      log(`${BUILD} loaded; seats are being attached`)

      attachSeat(ctx, 'sidebar.workspaces.session.menu.item', { id: 'delete-chat:menu-item', order: 900 }, SessionMenuRows)

      // The trash is a global panel: `main` owns the page body and the sidebar's
      // panel list derives its row from the same key. `label` is a thunk so the
      // shell re-reads it per projection and the row follows the active locale.
      attachSeat(ctx, 'main', { key: TRASH_PANEL_ID, label: () => t('footerTrash'), order: 100 }, TrashPage)
      attachSeat(ctx, 'sidebar.panellist', { id: TRASH_PANEL_ID, label: () => t('footerTrash'), order: 100 }, TrashGlyph)

      attachSeat(ctx, 'shell.overlay', { id: 'delete-chat:overlays', order: 900 }, Overlays)

      // Prime the badge; a host without the route leaves it empty.
      void refreshTrashCount()
    }

    exports.name = 'dsh-delete-chat'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
