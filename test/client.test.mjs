/**
 * Client half: registration, row appearance, the soft-delete dialog, the trash
 * panel (filter / select / restore / purge / empty), and language switching.
 *
 * There is no DOM here. `flatten()` expands function components the way the real
 * renderer would, so assertions read the text a user would see rather than an
 * opaque component reference.
 *
 * Run with: node --test test/client.test.mjs
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

let spec
let exports

const loaded = []

/**
 * A primitives surface shaped like the real build's. The row component renders its
 * children so `flatten()` can reach the label text a user would read; the icons
 * render nothing, which is all a stroke glyph contributes to an assertion.
 */
const PRIMITIVES = {
  MenuItemButton: function MenuItemButton(props) {
    const children = Array.isArray(props.children) ? props.children : [props.children]
    return { type: 'element', args: ['div', props, ...children] }
  },
  IconTrashOutlineRegular: function IconTrashOutlineRegular() {
    return null
  },
  IconArchiveOutlineRegular: function IconArchiveOutlineRegular() {
    return null
  },
}

/** Fake React: enough to register, render and drive the plugin without a DOM. */
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
 * Package resolver for the bundle.
 * @param id - module id.
 * @returns the module namespace.
 */
function fakeRequire(id) {
  if (id === 'react') return fakeReact
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
  throw new Error(`client test: unexpected module "${id}"`)
}

/**
 * A stand-in for the host locale service (`ctx.get('locale')`).
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
 * Expand function components into their rendered output.
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
 * Every element in a flattened tree.
 * @param node - flattened tree.
 * @returns element nodes.
 */
function elements(node) {
  const out = []
  ;(function walk(current) {
    if (current === null || current === undefined) return
    // Rows render as `rows.map(...)`, so a child may itself be an array.
    if (Array.isArray(current)) {
      for (const item of current) walk(item)
      return
    }
    if (typeof current !== 'object') return
    out.push(current)
    for (const child of current.children ?? []) walk(child)
  })(node)
  return out
}

/**
 * All text under a node.
 * @param node - flattened tree.
 * @returns concatenated strings.
 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object') return ''
  return textOf(node.children ?? [])
}

/**
 * Find the first element matching a predicate.
 * @param node - flattened tree.
 * @param predicate - test.
 * @returns the node, or undefined.
 */
function find(node, predicate) {
  return elements(node).find(predicate)
}

/**
 * Find a button by the text it renders.
 * @param node - flattened tree.
 * @param label - substring of the button's text.
 * @returns the node, or undefined.
 */
function button(node, label) {
  return find(node, (element) => element.type === 'button' && textOf(element).includes(label))
}

/** Serialised tree, for "must (not) contain" assertions. */
const dump = (node) => JSON.stringify(flatten(node))

/** Let queued promises and the zero-delay timer settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Host stubs used by most cases. */
const ROUTES = {
  trash: { sessionId: 'session-a', trashed: true, archived: 'ok', bytes: 2048, path: '/home/.dsh/session-trash/p/session-a' },
  trashList: {
    root: '/home/.dsh/session-trash',
    rows: [
      { sessionId: 'session-a', displayTitle: 'alpha 会话', bytes: 2048, project: 'p', deletedAt: '2026-10-29T01:02:03.000Z' },
      { sessionId: 'session-b', displayTitle: 'beta 会话', bytes: 1024, project: 'p', deletedAt: '2026-10-28T01:02:03.000Z' },
    ],
  },
  restore: { restored: [{ sessionId: 'session-a' }], failures: [] },
  purge: { removedDirectories: ['/t/a', '/t/b'], freedBytes: 4096, failures: [], deleted: true },
  empty: { removedDirectories: ['/t/a', '/t/b'], freedBytes: 4096, failures: [], deleted: true },
}

/**
 * Mount a module instance against a fake context and a routed host stub.
 * @param options - `{ locale, withService, routes }`.
 * @returns the driver.
 */
function mount(options = {}) {
  const locale = createLocaleService(options.locale)
  const withService = options.withService !== false
  const routes = options.routes ?? ROUTES
  const calls = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (url, init) => {
    const target = String(url)
    const body = JSON.parse(init?.body ?? '{}')
    calls.push({ target, body })
    const method = target.split('/').pop()
    const value = typeof routes[method] === 'function' ? routes[method](body) : routes[method]
    return { ok: true, status: 200, json: async () => ({ ok: true, value: value ?? {} }) }
  }

  const instance = spec.factory((id) => {
    if (id === 'react') return fakeReact
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
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

  const overrides = registrations.find((row) => row.entry.name === 'shell.overlay')?.component
  const menu = registrations.find((row) => row.entry.name === 'sidebar.workspaces.session.menu.item')?.component

  return {
    locale,
    calls,
    menu,
    overrides,
    registrations,
    render: () => flatten(overrides()),
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

/** The two rows this plugin puts in a session menu. */
function menuRows(driver) {
  return flatten(driver.menu({ sessionId: 'session-a', displayTitle: 'demo', cwd: '/p' })).children
}

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
  it('registers under the package name and exports a mountable face', () => {
    assert.equal(spec.id, 'dsh-delete-chat')
    assert.equal(exports.name, 'dsh-delete-chat')
    assert.deepEqual(exports.inject, ['slots'])
    assert.equal(typeof exports.apply, 'function')
  })
})

describe('slots', () => {
  it('fills the session menu and the overlay host', () => {
    const driver = mount()
    try {
      assert.deepEqual(driver.registrations.map((row) => row.entry.name), [
        'sidebar.workspaces.session.menu.item',
        'shell.overlay',
      ])
      assert.equal(driver.registrations[0].entry.id, 'delete-chat:menu-item')
      assert.equal(driver.registrations[1].entry.id, 'delete-chat:overlays')
    } finally {
      driver.restore()
    }
  })

  it('renders nothing while both surfaces are closed', () => {
    const driver = mount()
    try {
      assert.equal(driver.overrides(), null)
    } finally {
      driver.restore()
    }
  })
})

describe('session menu', () => {
  it('offers a danger delete row and a trash row', () => {
    const driver = mount()
    try {
      const rows = menuRows(driver).filter((child) => child !== null)
      assert.equal(rows.length, 2)

      assert.ok(textOf(rows[0]).includes('删除会话'))
      assert.equal(rows[0].props.className, 'dsh-delete-chat__danger-row')
      assert.equal(rows[0].props.style.color, 'rgb(255, 123, 114)')
      assert.ok(rows[0].props.icon !== undefined, 'the delete row carries a glyph')

      assert.ok(textOf(rows[1]).includes('回收站'))
      assert.equal(rows[1].props.className, undefined, 'the trash row is not a danger row')
    } finally {
      driver.restore()
    }
  })
})

describe('soft delete dialog', () => {
  it('says it moves the conversation to the trash, and calls the trash route', async () => {
    const driver = mount()
    try {
      menuRows(driver)[0].props.onSelect()
      await tick()

      let tree = driver.render()
      assert.ok(dump(tree).includes('移入回收站'), 'the body must say it moves to the trash')
      assert.ok(!dump(tree).includes('不可撤销'), 'soft delete must not threaten permanence')

      button(tree, '移入回收站').props.onClick()
      await tick()

      const trashCall = driver.calls.find((call) => call.target.endsWith('/trash'))
      assert.ok(trashCall !== undefined, 'the host must receive a /trash call')
      assert.equal(trashCall.body.sessionId, 'session-a')
      assert.equal(trashCall.body.displayTitle, 'demo')
      assert.equal(trashCall.body.cwd, '/p')
      assert.ok(!driver.calls.some((call) => call.target.endsWith('/delete')), 'nothing permanent yet')

      tree = driver.render()
      assert.ok(dump(tree).includes('已移入回收站'))
      assert.ok(dump(tree).includes('/home/.dsh/session-trash/p/session-a'), 'the report names the trash path')
    } finally {
      driver.restore()
    }
  })
})

describe('trash panel', () => {
  /**
   * Open the panel through the trash row and wait for the listing.
   * @param options - mount options.
   * @returns the driver.
   */
  async function openPanel(options = {}) {
    const driver = mount(options)
    menuRows(driver)[1].props.onSelect()
    await tick()
    return driver
  }

  it('lists what the trash holds', async () => {
    const driver = await openPanel()
    try {
      const tree = driver.render()
      assert.ok(textOf(tree).includes('alpha 会话'))
      assert.ok(textOf(tree).includes('beta 会话'))
      assert.ok(dump(tree).includes('2 个会话'))
      assert.ok(driver.calls.some((call) => call.target.endsWith('/trashList')))
    } finally {
      driver.restore()
    }
  })

  it('filters by title, path or project', async () => {
    const driver = await openPanel()
    try {
      const search = find(driver.render(), (element) => element.props?.type === 'search')
      assert.ok(search !== undefined, 'the panel needs a filter box')
      search.props.onChange({ target: { value: 'alpha' } })
      await tick()

      const tree = driver.render()
      assert.ok(textOf(tree).includes('alpha 会话'))
      assert.ok(!textOf(tree).includes('beta 会话'), 'the filter must hide the rest')
    } finally {
      driver.restore()
    }
  })

  it('purges a multi-selection only after a second click', async () => {
    const driver = await openPanel()
    try {
      button(driver.render(), '全选').props.onClick()
      await tick()
      assert.ok(dump(driver.render()).includes('已选 2 项'))

      button(driver.render(), '永久删除').props.onClick()
      await tick()
      assert.ok(dump(driver.render()).includes('确认永久删除 2 项'), 'the first click must only arm')
      assert.ok(!driver.calls.some((call) => call.target.endsWith('/purge')), 'nothing is deleted yet')

      button(driver.render(), '确认永久删除 2 项').props.onClick()
      await tick()

      const purge = driver.calls.find((call) => call.target.endsWith('/purge'))
      assert.ok(purge !== undefined, 'the second click issues the purge')
      assert.deepEqual([...purge.body.sessionIds].sort(), ['session-a', 'session-b'])
      assert.ok(dump(driver.render()).includes('已永久删除 2 项'))
    } finally {
      driver.restore()
    }
  })

  it('restores the selection', async () => {
    const driver = await openPanel()
    try {
      const checkbox = find(driver.render(), (element) => element.props?.type === 'checkbox')
      checkbox.props.onChange()
      await tick()

      button(driver.render(), '恢复').props.onClick()
      await tick()

      const restore = driver.calls.find((call) => call.target.endsWith('/restore'))
      assert.ok(restore !== undefined)
      assert.deepEqual(restore.body.sessionIds, ['session-a'])
      assert.ok(dump(driver.render()).includes('已恢复 1 项'))
    } finally {
      driver.restore()
    }
  })

  it('empties the whole trash behind a confirmation', async () => {
    const driver = await openPanel()
    try {
      button(driver.render(), '清空回收站').props.onClick()
      await tick()
      assert.ok(dump(driver.render()).includes('确认清空 2 项'))
      assert.ok(!driver.calls.some((call) => call.target.endsWith('/empty')))

      button(driver.render(), '确认清空 2 项').props.onClick()
      await tick()
      assert.ok(driver.calls.some((call) => call.target.endsWith('/empty')))
      assert.ok(dump(driver.render()).includes('回收站已清空'))
    } finally {
      driver.restore()
    }
  })

  it('reports a host failure instead of pretending it worked', async () => {
    const driver = await openPanel()
    try {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (url) => {
        if (String(url).endsWith('/purge')) {
          return { ok: false, status: 500, json: async () => ({ ok: false, error: { message: 'disk on fire' } }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }
      }
      try {
        button(driver.render(), '全选').props.onClick()
        await tick()
        button(driver.render(), '永久删除').props.onClick()
        await tick()
        button(driver.render(), '确认永久删除 2 项').props.onClick()
        await tick()
        assert.ok(dump(driver.render()).includes('disk on fire'))
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      driver.restore()
    }
  })
})

describe('i18n', () => {
  it('registers one namespace with matching zh/en key sets', () => {
    const driver = mount()
    try {
      const byLocale = driver.locale.dictionaries.get('deleteChat')
      assert.ok(byLocale !== undefined)
      assert.deepEqual(Object.keys(byLocale.zh).sort(), Object.keys(byLocale.en).sort())
      assert.equal(byLocale.zh.menu, '删除会话')
      assert.equal(byLocale.en.menuTrash, 'Trash')
    } finally {
      driver.restore()
    }
  })

  it('follows the active language on the rows and the panel', async () => {
    const driver = mount({ locale: 'zh' })
    try {
      assert.ok(textOf(menuRows(driver)[0]).includes('删除会话'))

      driver.locale.setLocale('en')
      const rows = menuRows(driver)
      assert.ok(textOf(rows[0]).includes('Delete chat'))
      assert.ok(textOf(rows[1]).includes('Trash'))

      rows[1].props.onSelect()
      await tick()
      const tree = driver.render()
      assert.ok(dump(tree).includes('Select all'))
      assert.ok(!dump(tree).includes('全选'))
    } finally {
      driver.restore()
    }
  })

  it('falls back to a real label when the host exposes no locale service', () => {
    const driver = mount({ withService: false })
    try {
      const label = textOf(menuRows(driver)[0])
      assert.ok(label.length > 0)
      assert.ok(!label.includes('deleteChat.'), 'a missing service must not leak the raw key')
    } finally {
      driver.restore()
    }
  })
})
