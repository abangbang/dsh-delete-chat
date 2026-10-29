/**
 * dsh-session-delete — client half.
 *
 * Two slot entries, no route of its own:
 *
 *   `sidebar.workspaces.session.menu.item` — the row's "..." menu gains a
 *   destructive row. The provider passes `{ sessionId, displayTitle }` plus the
 *   open-state hook as the occurrence's hook context, so the entry can close the
 *   menu exactly like the built-in rows do.
 *
 *   `shell.overlay` — the confirmation dialog. It is always mounted and renders
 *   nothing until a menu row asks for it, which keeps the dialog above every
 *   pane without portal plumbing.
 *
 * All work happens on the host: `POST /session-delete/api/{preview,delete}`.
 * The client never assumes it can reach the filesystem.
 *
 * @module dsh-session-delete/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    /** Primitives are optional: a stripped host still gets a working menu row. */
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = null
    }

    const h = React.createElement

    // ── copy ───────────────────────────────────────────────────────────────

    const TEXT = {
      menu: '删除会话',
      title: '删除会话',
      body: '该会话将从列表中移除，磁盘上的会话日志会被永久删除，并从工作区记账中摘除。此操作不可撤销。',
      unknownSize: '正在读取会话大小…',
      cancel: '取消',
      confirm: '永久删除',
      working: '正在删除…',
      done: '已删除',
      close: '关闭',
      failed: '删除失败',
      archivedOk: '已归档并停止运行中的工作',
      archivedSkipped: '归档被跳过',
      archivedFailed: '归档未完成',
      nothingOnDisk: '磁盘上没有找到该会话目录',
      keptNote: '若该会话仍有子代理或分叉子会话，它们不会被级联删除。',
    }

    // ── dialog state ───────────────────────────────────────────────────────

    /** One pending deletion; `null` means the overlay renders nothing. */
    let state = null
    const listeners = new Set()

    /**
     * Replace the pending state and wake every overlay subscriber.
     * @param next - new state or null.
     */
    function setState(next) {
      state = next
      for (const listener of listeners) listener()
    }

    /**
     * Subscribe to the module store.
     * @param listener - React invalidator.
     * @returns unsubscribe.
     */
    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    /** Stable snapshot reader for `useSyncExternalStore`. */
    const readState = () => state

    // ── transport ──────────────────────────────────────────────────────────

    /**
     * Absolute API base. The web GUI and the desktop shell both serve this
     * plugin's routes from the page origin; a non-http origin (file://) has no
     * host behind it and falls back to a same-directory relative path.
     * @returns base URL without a trailing slash.
     */
    function apiBase() {
      const location = globalThis.location
      if (location !== undefined && /^https?:$/.test(location.protocol)) return location.origin
      return ''
    }

    /**
     * One fenced host call.
     * @param method - `preview` | `delete` | `list`.
     * @param payload - JSON body.
     * @returns the `value` field of an ok envelope.
     */
    async function callHost(method, payload) {
      const response = await fetch(`${apiBase()}/session-delete/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || body?.ok !== true) {
        const message = body?.error?.message ?? `HTTP ${response.status}`
        throw new Error(message)
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

    // ── danger styling ─────────────────────────────────────────────────────

    /**
     * The design system exposes no `danger` prop on `MenuItemButton`, so the row
     * is coloured where a plugin can prove it wins: label and glyph are wrapped
     * in spans carrying an explicit colour, and the row itself gets a class plus
     * a runtime stylesheet for the hover wash. A host that ignores the class
     * still shows red text; one that forwards it also gets the wash.
     */
    const DANGER = 'rgb(255, 123, 114)'
    const DANGER_HOVER = 'rgba(255, 123, 114, 0.15)'
    const DANGER_ROW_CLASS = 'dsh-session-delete__danger-row'
    const STYLE_ID = 'dsh-session-delete-style'

    /**
     * Install the row's hover rules once per page.
     */
    function installRowStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        `.${DANGER_ROW_CLASS}:hover,`,
        `.${DANGER_ROW_CLASS}:focus-visible,`,
        `.${DANGER_ROW_CLASS}[data-highlighted="true"] {`,
        `  background: ${DANGER_HOVER} !important;`,
        '}',
      ].join('\n')
      document.head.appendChild(style)
    }

    /**
     * Colour the label without depending on the host's own text colour.
     * @returns the label node.
     */
    function dangerLabel() {
      return h('span', { style: { color: DANGER } }, TEXT.menu)
    }

    /**
     * The trash glyph. `IconTrashOutlineRegular` is what this build exports; the
     * fallbacks keep the row alive on a design system that names it differently.
     * @returns the icon component, or undefined when the surface has none.
     */
    function resolveTrashIcon() {
      return primitives?.IconTrashOutlineRegular
        ?? primitives?.IconTrashOutlineMedium
        ?? primitives?.IconDeleteOutlineRegular
    }

    /**
     * Colour the glyph. Fluent icons stroke with `currentColor`, so the wrapper's
     * colour is what decides the stroke.
     * @param Icon - a primitives icon component.
     * @param size - pixel size.
     * @returns the wrapped icon node.
     */
    function dangerIcon(Icon, size = 14) {
      return h('span', {
        style: {
          color: DANGER,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      }, h(Icon, { size }))
    }

    // ── menu row ───────────────────────────────────────────────────────────

    /** No-op open-state hook for hosts that do not pass the hook context. */
    const useNoMenuState = () => [false, () => {}]

    /**
     * The destructive row inside a session's "..." menu.
     * @param props - `{ sessionId, displayTitle, useMenuOpenState? }`.
     * @returns the menu entry element.
     */
    function DeleteSessionMenuItem(props) {
      const useMenuOpenState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState : useNoMenuState
      const [, setMenuOpen] = useMenuOpenState()

      const onSelect = () => {
        setMenuOpen(false)
        setState({
          phase: 'confirm',
          sessionId: props.sessionId,
          displayTitle: props.displayTitle ?? props.sessionId,
          preview: undefined,
          error: undefined,
          report: undefined,
        })
        // Fill in the size while the dialog is already readable.
        callHost('preview', { sessionId: props.sessionId })
          .then((preview) => {
            if (state !== null && state.sessionId === props.sessionId && state.phase === 'confirm') {
              setState({ ...state, preview })
            }
          })
          .catch(() => {})
      }

      const Item = primitives?.MenuItemButton
      const Icon = resolveTrashIcon()

      if (typeof Item === 'function') {
        return h(Item, {
          icon: typeof Icon === 'function' ? dangerIcon(Icon) : undefined,
          className: DANGER_ROW_CLASS,
          style: { color: DANGER },
          onSelect,
        }, dangerLabel())
      }
      return h('button', {
        type: 'button',
        className: DANGER_ROW_CLASS,
        onClick: onSelect,
        style: { ...styles.fallbackRow, color: DANGER },
      }, typeof Icon === 'function' ? dangerIcon(Icon) : null, dangerLabel())
    }

    // ── confirmation dialog ────────────────────────────────────────────────

    /**
     * The overlay: confirm, run, report.
     * @returns the dialog element, or null while nothing is pending.
     */
    function DeleteSessionDialog() {
      const current = React.useSyncExternalStore(subscribe, readState, readState)
      if (current === null) return null

      const close = () => setState(null)

      const run = async () => {
        setState({ ...current, phase: 'working', error: undefined })
        try {
          const report = await callHost('delete', { sessionId: current.sessionId })
          setState({ ...current, phase: 'done', report })
        } catch (error) {
          setState({ ...current, phase: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const busy = current.phase === 'working'
      const finished = current.phase === 'done'
      const preview = current.preview

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
          h('span', { style: styles.heading },
            (() => {
              const Icon = resolveTrashIcon()
              if (typeof Icon !== 'function') return null
              return dangerIcon(Icon, 15)
            })(),
            TEXT.title),
          h('button', {
            type: 'button',
            onClick: () => { if (!busy) close() },
            style: styles.iconButton,
            'aria-label': TEXT.close,
            disabled: busy,
          }, '×')),

        h('div', { style: styles.sessionName }, current.displayTitle),

        h('div', { style: styles.body },
          current.phase === 'done'
            ? h(ReportView, { report: current.report })
            : h('p', { style: styles.paragraph }, TEXT.body)),

        preview !== undefined && current.phase !== 'done'
          ? h('div', { style: styles.meta }, `${formatBytes(preview.bytes)} · ${preview.onDisk ? preview.directories.length + ' 个目录' : TEXT.nothingOnDisk}`)
          : null,

        current.phase === 'error' || current.error !== undefined
          ? h('div', { style: styles.errorBox }, `${TEXT.failed}：${current.error ?? ''}`)
          : null,

        h('div', { style: styles.footer },
          h('span', { style: styles.hint }, busy ? TEXT.working : finished ? '' : TEXT.keptNote),
          h('div', { style: styles.buttons },
            h('button', {
              type: 'button',
              onClick: () => { if (!busy) close() },
              style: styles.secondaryButton,
              disabled: busy,
            }, finished ? TEXT.close : TEXT.cancel),
            finished
              ? null
              : h('button', {
                type: 'button',
                onClick: run,
                style: busy ? { ...styles.dangerButton, opacity: 0.6 } : styles.dangerButton,
                disabled: busy,
              },
              (() => {
                const Icon = resolveTrashIcon()
                if (typeof Icon !== 'function' || busy) return null
                return h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, h(Icon, { size: 15 }))
              })(),
              busy ? TEXT.working : TEXT.confirm)))))
    }

    /**
     * Outcome summary of one deletion.
     * @param props - `{ report }` from the host.
     * @returns the report block.
     */
    function ReportView(props) {
      const report = props.report ?? {}
      const archiveLine = report.archived === 'ok'
        ? TEXT.archivedOk
        : report.archived === 'skipped'
          ? TEXT.archivedSkipped
          : `${TEXT.archivedFailed}（${report.archived}）`
      const rows = [
        ['状态', TEXT.done],
        ['归档', archiveLine],
        ['删除目录', `${(report.removedDirectories ?? []).length} 个`],
        ['释放空间', formatBytes(report.freedBytes ?? 0)],
        ['工作区记账', report.workspaceAccounting === null || report.workspaceAccounting === undefined
          ? '无变化'
          : `移除 ${report.workspaceAccounting.workspaces + report.workspaceAccounting.archived + report.workspaceAccounting.pinned} 条引用`],
        ['投影缓存', `${report.projectionCacheRemoved ?? 0} 项`],
      ]
      return h('div', null,
        h('div', { style: styles.reportTable },
          rows.map(([label, value]) => h('div', { key: label, style: styles.reportRow },
            h('span', { style: styles.reportLabel }, label),
            h('span', { style: styles.reportValue }, value)))),
        (report.failures ?? []).length > 0
          ? h('div', { style: styles.errorBox }, (report.failures ?? []).map((failure) =>
            h('div', { key: failure.path }, `${failure.path} — ${failure.error}`)))
          : null)
    }

    // ── styles ─────────────────────────────────────────────────────────────

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
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      heading: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '15px',
        fontWeight: 600,
        letterSpacing: '0.01em',
      },
      iconButton: {
        border: 'none',
        background: 'transparent',
        color: 'rgba(233,233,236,0.62)',
        fontSize: '20px',
        lineHeight: 1,
        cursor: 'pointer',
        padding: '0 4px',
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
      meta: { marginTop: '10px', color: 'rgba(233,233,236,0.55)', fontSize: '12.5px' },
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
      footer: {
        marginTop: '18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      },
      hint: { color: 'rgba(233,233,236,0.45)', fontSize: '12px', flex: '1 1 auto' },
      buttons: { display: 'flex', gap: '8px', flex: '0 0 auto' },
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
      reportTable: { display: 'grid', gap: '6px' },
      reportRow: { display: 'flex', justifyContent: 'space-between', gap: '12px' },
      reportLabel: { color: 'rgba(233,233,236,0.52)' },
      reportValue: { color: 'rgba(233,233,236,0.92)' },
    }

    // ── mount ──────────────────────────────────────────────────────────────

    /** Client services this plugin touches. */
    const inject = ['slots']

    /**
     * Register the two slot entries.
     * @param ctx - client plugin context.
     */
    function apply(ctx) {
      installRowStyles()

      ctx.effect(
        () => ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-delete:menu-item',
          order: 900,
        }, DeleteSessionMenuItem)),
        'dsh-session-delete: session row menu item',
      )

      ctx.effect(
        () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-delete:dialog',
          order: 900,
        }, DeleteSessionDialog)),
        'dsh-session-delete: deletion dialog',
      )
    }

    exports.name = 'dsh-session-delete'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
