/**
 * Client-half test: loads `lib/client.js` through a stand-in module loader,
 * runs the factory with a fake `require`, mounts `apply()` against a fake
 * context, and asserts both slot entries land with the right names.
 *
 * No DOM and no real React: only the registration path runs, which is exactly
 * the part that breaks silently when a slot name or register shape is wrong.
 *
 * Run with: node --test test/client.test.mjs
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

let spec
let exports

const loaded = []

/**
 * Fake React: only what the registration path touches.
 */
const fakeReact = {
  createElement: (...args) => ({ type: 'element', args }),
  Fragment: Symbol('Fragment'),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: () => ({ current: undefined }),
}

/**
 * Package resolver for the bundle: react plus an empty primitives surface.
 * @param id - module id.
 * @returns the module namespace.
 */
function fakeRequire(id) {
  if (id === 'react') return fakeReact
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`client test: unexpected module "${id}"`)
}

/** A primitives surface that has the real build's shape. */
const PRIMITIVES = {
  MenuItemButton: function MenuItemButton() {},
  IconTrashOutlineRegular: function IconTrashOutlineRegular() {},
}

/**
 * A stand-in for the host locale service (`ctx.get('locale')`): register / bind /
 * subscribe / getSnapshot / setLocale, resolving through the same `[active, 'en']`
 * fallback chain the real runtime uses.
 * @param initial - starting language id.
 * @returns the fake service.
 */
function createLocaleService(initial = 'zh') {
  const dictionaries = new Map()
  const listeners = new Set()
  let active = initial
  let revision = 0

  const publish = () => {
    revision += 1
    for (const listener of [...listeners]) listener()
  }

  return {
    dictionaries,
    register(namespace, byLocale) {
      dictionaries.set(namespace, byLocale)
      publish()
      return () => {
        dictionaries.delete(namespace)
        publish()
      }
    },
    bind(namespace) {
      return (key, params) => {
        let template
        for (const locale of [active, 'en']) {
          const value = dictionaries.get(namespace)?.[locale]?.[key]
          if (value !== undefined) {
            template = value
            break
          }
        }
        if (template === undefined) return key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return { active, revision, locales: [{ id: 'zh' }, { id: 'en' }] }
    },
    setLocale(next) {
      active = next
      publish()
    },
  }
}

/**
 * Mount one module instance against a fake context.
 * @param options - `{ primitives, locale, withService }`; `withService: false`
 *   omits the locale service, which is how a stripped host looks.
 * @returns the two registered components plus the fake locale service.
 */
function mountInstance(options = {}) {
  const primitives = options.primitives ?? PRIMITIVES
  const locale = createLocaleService(options.locale)
  const withService = options.withService !== false
  const instance = spec.factory((id) => {
    if (id === 'react') return fakeReact
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`client test: unexpected module "${id}"`)
  })
  const registrations = []
  instance.apply({
    effect: (fn) => fn(),
    get: (name) => (withService && name === 'locale' ? locale : undefined),
    slots: {
      inject: (_name, factory) => factory(),
      register: (entry, component) => {
        registrations.push({ entry, component })
        return () => {}
      },
    },
  })
  return {
    menu: registrations.find((row) => row.entry.name === 'sidebar.workspaces.session.menu.item').component,
    dialog: registrations.find((row) => row.entry.name === 'shell.overlay').component,
    locale,
  }
}

/**
 * Expand function components into their rendered output. The fake renderer records
 * `{ type, args }` without invoking components, so a report rendered by `ReportView`
 * would otherwise stay an opaque function reference.
 * @param node - fake element, array or scalar.
 * @returns the same tree with components replaced by what they return.
 */
function flatten(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(flatten)
  if (node.type !== 'element') return node
  const [type, props, ...children] = node.args
  if (typeof type === 'function') return flatten(type({ ...props, children }))
  return { type, props, children: children.map(flatten) }
}

/**
 * Find the first button whose children contain exactly `label`.
 * @param node - flattened tree.
 * @param label - the button's visible text.
 * @returns the button node, or undefined.
 */
function findButton(node, label) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (node.type === 'button' && (node.children ?? []).some((child) => child === label)) return node
  for (const child of node.children ?? []) {
    const found = findButton(child, label)
    if (found !== undefined) return found
  }
  return undefined
}

/** Let queued microtasks and the zero-delay timer settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

before(async () => {
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        loaded.push(entry)
      },
    },
  }
  await import('../lib/client.js')
  spec = loaded[0]
  exports = spec.factory(fakeRequire)
})

describe('bundle', () => {
  it('registers under the package name', () => {
    assert.equal(spec.id, 'dsh-delete-chat')
  })

  it('exports a mountable face', () => {
    assert.equal(exports.name, 'dsh-delete-chat')
    assert.equal(typeof exports.apply, 'function')
    assert.deepEqual(exports.inject, ['slots'])
  })
})

describe('slots', () => {
  it('injects both entries into the documented slot names', () => {
    const registrations = []
    const injected = []
    const ctx = {
      effect(fn) {
        const disposer = fn()
        assert.equal(typeof disposer === 'function' || disposer === undefined, true)
        return disposer
      },
      slots: {
        inject(name, factory) {
          injected.push(name)
          return factory()
        },
        register(entry, component) {
          registrations.push({ entry, component })
          return () => {}
        },
      },
    }

    exports.apply(ctx)

    assert.deepEqual(injected, ['sidebar.workspaces.session.menu.item', 'shell.overlay'])
    assert.equal(registrations.length, 2)

    const [menu, dialog] = registrations
    assert.equal(menu.entry.name, 'sidebar.workspaces.session.menu.item')
    assert.equal(menu.entry.id, 'delete-chat:menu-item')
    assert.equal(typeof menu.component, 'function')

    assert.equal(dialog.entry.name, 'shell.overlay')
    assert.equal(dialog.entry.id, 'delete-chat:dialog')
    assert.equal(typeof dialog.component, 'function')
  })

  it('renders nothing while no deletion is pending', () => {
    const registrations = []
    exports.apply({
      effect: (fn) => fn(),
      slots: {
        inject: (_name, factory) => factory(),
        register: (entry, component) => {
          registrations.push({ entry, component })
          return () => {}
        },
      },
    })
    const dialog = registrations.find((row) => row.entry.name === 'shell.overlay')
    assert.equal(dialog.component(), null)
  })
})

/** The row/title glyph and the confirm button must be visibly destructive. */
describe('danger styling', () => {
  const DANGER = 'rgb(255, 123, 114)'

  /**
   * Mount a fresh module instance whose `require` answers the primitives.
   * @param locale - active language id for the fake locale service.
   * @returns the two registered components plus the fake service.
   */
  function mount(locale = 'zh') {
    return mountInstance({ primitives: PRIMITIVES, locale })
  }

  /**
   * Depth-first visit of a fake element tree.
   * @param node - element, array or scalar.
   * @param visit - called for every element node.
   */
  function walk(node, visit) {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (node.type === 'element') visit(node)
    for (const arg of node.args ?? []) {
      if (Array.isArray(arg)) for (const item of arg) walk(item, visit)
      else walk(arg, visit)
    }
  }

  it('puts the trash glyph and the danger colour on the menu row', () => {
    const { menu } = mount()
    const element = menu({ sessionId: 'session-1', displayTitle: 'demo' })

    assert.equal(element.args[0], PRIMITIVES.MenuItemButton, 'uses the design system row')
    const props = element.args[1]
    assert.equal(props.className, 'dsh-delete-chat__danger-row')
    assert.equal(props.style.color, DANGER)

    assert.ok(props.icon !== undefined, 'the row must carry an icon')
    assert.equal(props.icon.args[1].style.color, DANGER, 'icon wrapper carries the danger colour')

    const label = element.args[2]
    assert.equal(label.args[1].style.color, DANGER, 'label carries the danger colour')
  })

  it('renders a solid danger confirm button with the same glyph', () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    try {
      const { menu, dialog } = mount()
      const opened = menu({ sessionId: 'session-1', displayTitle: 'demo' })
      opened.args[1].onSelect()

      const tree = dialog()
      assert.notEqual(tree, null, 'the overlay must render once a deletion is pending')

      const buttons = []
      walk(tree, (node) => {
        if (node.args[0] === 'button') buttons.push(node)
      })
      const confirm = buttons.find((node) => node.args.includes('永久删除'))
      assert.ok(confirm !== undefined, 'a confirm button must exist')
      assert.equal(confirm.args[1].style.background, '#c93b3b')
      assert.equal(confirm.args[1].style.color, '#fff')
      assert.ok(confirm.args.length > 3, 'the confirm button carries an icon plus its label')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

/** A language switch must reach the row, the dialog and the report. */
describe('i18n', () => {
  it('registers one namespace with matching zh/en key sets', () => {
    const { locale } = mountInstance({ locale: 'zh' })
    const byLocale = locale.dictionaries.get('deleteChat')
    assert.ok(byLocale !== undefined, 'the dictionaries must be registered under the plugin namespace')
    assert.deepEqual(Object.keys(byLocale.zh).sort(), Object.keys(byLocale.en).sort(), 'key sets must match')
    assert.equal(byLocale.zh.menu, '删除会话')
    assert.equal(byLocale.en.menu, 'Delete chat')
    assert.equal(byLocale.en.confirm, 'Delete permanently')
  })

  it('follows the active language on the row and the open dialog', () => {
    const { menu, dialog, locale } = mountInstance({ locale: 'zh' })

    const zhRow = menu({ sessionId: 'session-1', displayTitle: 'demo' })
    assert.equal(zhRow.args[2].args[2], '删除会话')

    locale.setLocale('en')
    const enRow = menu({ sessionId: 'session-1', displayTitle: 'demo' })
    assert.equal(enRow.args[2].args[2], 'Delete chat', 'the row must re-read the active language')

    const originalFetch = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    try {
      enRow.args[1].onSelect()
      const rendered = JSON.stringify(dialog())
      assert.ok(rendered.includes('Delete permanently'), 'the confirm button must be English')
      assert.ok(rendered.includes('This conversation leaves every list'), 'the body must be English')
      assert.ok(!rendered.includes('永久删除'), 'no Chinese must survive the switch')
      assert.ok(!rendered.includes('该会话将从列表中移除'), 'no Chinese body must survive either')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to a non-empty label when the host exposes no locale service', () => {
    const { menu } = mountInstance({ withService: false })
    const row = menu({ sessionId: 'session-1', displayTitle: 'demo' })
    const label = row.args[2].args[2]
    assert.ok(typeof label === 'string' && label.length > 0, 'a label must render without the service')
    assert.ok(!label.startsWith('deleteChat.'), 'a missing service must not leak the raw key')
  })
})

/** The status row must state what actually happened, not a blanket success. */
describe('report status', () => {

  /**
   * Drive one full delete flow against a stubbed host, then serialise the outcome.
   * @param report - the host report the stub returns.
   * @param locale - active language id.
   * @returns the rendered dialog as JSON.
   */
  async function renderOutcome(report, locale = 'zh') {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: report }) })
    try {
      const { menu, dialog } = mountInstance({ locale })
      const row = menu({ sessionId: 'session-1', displayTitle: 'demo' })
      row.args[1].onSelect()
      await new Promise((resolve) => setTimeout(resolve, 0))

      /** First rendered button carrying the solid danger fill is the confirm one. */
      const findConfirm = (node) => {
        const tree = flatten(node)
        if (tree === null || tree === undefined || typeof tree !== 'object') return undefined
        if (tree.type === 'button' && tree.props?.style?.background === '#c93b3b') return tree
        for (const child of tree.children ?? []) {
          const found = findConfirm(child)
          if (found !== undefined) return found
        }
        return undefined
      }

      const confirm = findConfirm(dialog())
      assert.ok(confirm !== undefined, 'the confirm button must render')
      confirm.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
      return JSON.stringify(flatten(dialog()))
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  const CASES = [
    {
      name: 'a completed deletion',
      report: {
        deleted: true,
        archived: 'ok',
        removedDirectories: ['/tmp/a'],
        freedBytes: 4096,
        workspaceAccounting: { workspaces: 1, archived: 0, pinned: 0 },
        projectionCacheRemoved: 1,
        failures: [],
      },
      zh: '已删除',
      en: 'Deleted',
    },
    {
      name: 'a partial deletion',
      report: {
        deleted: false,
        archived: 'failed: busy',
        removedDirectories: ['/tmp/a'],
        freedBytes: 4096,
        workspaceAccounting: null,
        projectionCacheRemoved: 0,
        failures: [{ path: '/tmp/b', error: 'EPERM' }],
      },
      zh: '部分完成',
      en: 'partially deleted',
    },
    {
      name: 'nothing on disk',
      report: {
        deleted: false,
        archived: 'skipped',
        removedDirectories: [],
        freedBytes: 0,
        workspaceAccounting: null,
        projectionCacheRemoved: 0,
        failures: [],
      },
      zh: '未找到可删除内容',
      en: 'nothing to delete',
    },
  ]

  for (const testCase of CASES) {
    it(`reports ${testCase.name} in zh`, async () => {
      const rendered = await renderOutcome(testCase.report, 'zh')
      assert.ok(rendered.includes(testCase.zh), `expected "${testCase.zh}" in the report`)
    })
    it(`reports ${testCase.name} in en`, async () => {
      const rendered = await renderOutcome(testCase.report, 'en')
      assert.ok(rendered.includes(testCase.en), `expected "${testCase.en}" in the report`)
    })
  }

  it('names the failing path and reason when part of the run failed', async () => {
    const rendered = await renderOutcome(CASES[1].report, 'zh')
    assert.ok(rendered.includes('/tmp/b'), 'the failing path must be named')
    assert.ok(rendered.includes('EPERM'), 'the failure reason must be named')
  })
})

/** A failed run must be recoverable from the dialog itself. */
describe('failure recovery', () => {
  const FAILED = {
    deleted: false,
    archived: 'failed: busy',
    removedDirectories: ['/tmp/a'],
    freedBytes: 4096,
    workspaceAccounting: null,
    projectionCacheRemoved: 0,
    failures: [{ path: '/tmp/b', error: 'EPERM' }],
  }
  const CLEAN = {
    deleted: true,
    archived: 'ok',
    removedDirectories: ['/tmp/a', '/tmp/b'],
    freedBytes: 8192,
    workspaceAccounting: { workspaces: 1, archived: 0, pinned: 0 },
    projectionCacheRemoved: 1,
    failures: [],
  }

  /**
   * Open one flow whose host answers each delete call with the next report.
   * @param reports - successive delete reports.
   * @param locale - active language id.
   * @returns the dialog driver: `click`, `render`, `deletes`, `restore`.
   */
  async function openFlow(reports, locale = 'zh') {
    const originalFetch = globalThis.fetch
    const deletes = []
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      const body = JSON.parse(init?.body ?? '{}')
      let value
      if (target.endsWith('/delete')) {
        value = reports[Math.min(deletes.length, reports.length - 1)]
        deletes.push(body)
      } else {
        value = reports[0]
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, value }) }
    }
    const { menu, dialog } = mountInstance({ locale })
    const row = menu({ sessionId: 'session-9', displayTitle: 'demo' })
    row.args[1].onSelect()
    await tick()

    /** Click the button carrying `label` and let the flow settle. */
    const click = async (label) => {
      const button = findButton(flatten(dialog()), label)
      if (button === undefined) throw new Error(`no button labelled "${label}"`)
      button.props.onClick()
      await tick()
    }

    return {
      click,
      render: () => JSON.stringify(flatten(dialog())),
      deletes,
      restore: () => {
        globalThis.fetch = originalFetch
      },
    }
  }

  it('offers retry, a copy action and a CLI fallback after a partial run', async () => {
    const flow = await openFlow([FAILED])
    try {
      await flow.click('永久删除')
      const rendered = flow.render()
      assert.ok(rendered.includes('部分完成'), 'the status must say partial')
      assert.ok(rendered.includes('重试'), 'a retry button must be offered')
      assert.ok(rendered.includes('复制失败详情'), 'the report must be copyable')
      assert.ok(
        rendered.includes('dsh-delete-chat --yes session-9'),
        'the hint must name the exact CLI command for this session',
      )
    } finally {
      flow.restore()
    }
  })

  it('retries against the host and lands on the clean report', async () => {
    const flow = await openFlow([FAILED, CLEAN])
    try {
      await flow.click('永久删除')
      await flow.click('重试')
      const rendered = flow.render()
      assert.equal(flow.deletes.length, 2, 'the retry must hit the host again')
      assert.ok(rendered.includes('已删除'), 'the second run reports success')
      assert.ok(!rendered.includes('重试'), 'no retry is offered once nothing failed')
    } finally {
      flow.restore()
    }
  })

  it('keeps the failure list visible on the retry, so the second attempt is not blind', async () => {
    const flow = await openFlow([FAILED, FAILED])
    try {
      await flow.click('永久删除')
      await flow.click('重试')
      const rendered = flow.render()
      assert.ok(rendered.includes('/tmp/b'), 'the failing path stays listed')
      assert.ok(rendered.includes('EPERM'), 'the reason stays listed')
    } finally {
      flow.restore()
    }
  })

  it('hides the recovery affordances when nothing failed', async () => {
    const flow = await openFlow([CLEAN])
    try {
      await flow.click('永久删除')
      const rendered = flow.render()
      assert.ok(!rendered.includes('重试'))
      assert.ok(!rendered.includes('复制失败详情'))
      assert.ok(rendered.includes('已删除'))
    } finally {
      flow.restore()
    }
  })
})