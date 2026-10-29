/**
 * Client half: registration, row appearance, the soft-delete dialog, the trash
 * *panel* (a `main` page reached from the sidebar's panel list), and language
 * switching.
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

/** A primitives surface shaped like the real build's. */
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
  // The plugin's only effect is the page's lazy load, which is idempotent.
  useEffect: (fn) => {
    fn()
  },
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

/**
 * Find a button whose rendered text is exactly `label`. The toolbar's select-all
 * button flips its own label between 全选 and 取消全选, so a substring match for
 * 取消 would hit it before the dialog's cancel.
 * @param node - flattened tree.
 * @param label - exact button text.
 * @returns the node, or undefined.
 */
function exactButton(node, label) {
  return find(node, (element) => element.type === 'button' && textOf(element).trim() === label)
}

/** Serialised tree, for "must (not) contain" assertions. */
const dump = (node) => JSON.stringify(flatten(node))

/** Let queued promises and the zero-delay timer settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The exact `YYYY-MM-DD HH:mm:ss` the UI renders, in the machine's own zone.
 * @param iso - ISO timestamp.
 * @returns the rendered stamp.
 */
function stamp(iso) {
  const date = new Date(iso)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Host stubs used by most cases. */
const ROUTES = {
  trash: { sessionId: 'session-a', trashed: true, archived: 'ok', bytes: 2048, path: '/home/.dsh/session-trash/p/session-a' },
  trashList: {
    root: '/home/.dsh/session-trash',
    rows: [
      {
        sessionId: 'session-a',
        displayTitle: 'alpha 会话',
        bytes: 2048,
        project: 'p',
        path: '/home/.dsh/session-trash/p/session-a',
        lastActiveAt: '2026-10-27T09:08:07.000Z',
        deletedAt: '2026-10-29T01:02:03.000Z',
      },
      {
        sessionId: 'session-b',
        displayTitle: 'beta 会话',
        bytes: 1024,
        project: 'p',
        path: '/home/.dsh/session-trash/p/session-b',
        lastActiveAt: '2026-10-26T09:08:07.000Z',
        deletedAt: '2026-10-28T01:02:03.000Z',
      },
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

  const seat = (name) => registrations.find((row) => row.entry.name === name)

  return {
    locale,
    calls,
    menu: seat('sidebar.workspaces.session.menu.item')?.component,
    page: seat('main')?.component,
    glyph: seat('sidebar.panellist')?.component,
    overrides: seat('shell.overlay')?.component,
    registrations,
    render: () => flatten(seat('main')?.component()),
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

/** The single row this plugin puts in a session menu. */
function menuRow(driver) {
  return flatten(driver.menu({ sessionId: 'session-a', displayTitle: 'demo', cwd: '/p' }))
}

/**
 * Render the panel-list glyph with the shell's owner props.
 * @param driver - mount result.
 * @returns flattened glyph tree.
 */
function glyphTree(driver) {
  return flatten(driver.glyph({ size: 16, active: false }))
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
  it('fills the row menu, the global panel body and its list entry', () => {
    const driver = mount()
    try {
      assert.deepEqual(driver.registrations.map((row) => row.entry.name), [
        'sidebar.workspaces.session.menu.item',
        'main',
        'sidebar.panellist',
        'shell.overlay',
      ])
      const byName = new Map(driver.registrations.map((row) => [row.entry.name, row.entry]))
      assert.equal(byName.get('sidebar.workspaces.session.menu.item').id, 'delete-chat:menu-item')
      assert.equal(byName.get('main').key, 'delete-chat:trash', 'the page body is a keyed main seat')
      assert.equal(byName.get('sidebar.panellist').id, 'delete-chat:trash', 'the list row shares the panel id')
      assert.equal(byName.get('shell.overlay').id, 'delete-chat:overlays')
    } finally {
      driver.restore()
    }
  })

  it('renders nothing in the overlay while the dialog is closed', () => {
    const driver = mount()
    try {
      assert.equal(driver.overrides(), null)
    } finally {
      driver.restore()
    }
  })
})

describe('session menu', () => {
  it('offers the danger delete row and nothing else', () => {
    const driver = mount()
    try {
      const row = menuRow(driver)
      assert.ok(textOf(row).includes('删除会话'))
      assert.equal(row.props.className, 'dsh-delete-chat__danger-row')
      assert.equal(row.props.style.color, 'rgb(255, 123, 114)')
      assert.ok(row.props.icon !== undefined, 'the delete row carries a glyph')
      assert.ok(!textOf(row).includes('回收站'), 'the trash is a global panel now, not a menu row')
    } finally {
      driver.restore()
    }
  })
})

describe('panel list entry', () => {
  /** The count element: the only child of the glyph that is not an icon wrapper. */
  const countNode = (tree) => find(tree, (element) => typeof element.props?.style?.color === 'string'
    && element.props.style.color.startsWith('rgb(255')
    && /^\d+\+?$/.test(textOf(element).trim()))

  it('draws icon, name and count in that order', async () => {
    const driver = mount()
    try {
      await tick()
      const tree = glyphTree(driver)
      const text = textOf(tree)
      assert.equal(text, '回收站2', 'name then count, left to right')
      assert.ok(text.indexOf('回收站') < text.indexOf('2'), 'the count follows the name')
      assert.equal(textOf(countNode(tree)), '2', 'the count says how many conversations the trash holds')
      assert.ok(driver.calls.some((call) => call.target.endsWith('/trashList')), 'the count is primed at mount')
    } finally {
      driver.restore()
    }
  })

  it('keeps the rail compact: no name, just icon and count', async () => {
    const driver = mount()
    try {
      await tick()
      const tree = flatten(driver.glyph({ size: 18, active: false }))
      assert.equal(textOf(tree), '2', 'the 56px rail has no room for the name')
    } finally {
      driver.restore()
    }
  })

  it('renders no count when the trash is empty', async () => {
    const driver = mount({ routes: { ...ROUTES, trashList: { root: '/t', rows: [] } } })
    try {
      await tick()
      assert.equal(countNode(glyphTree(driver)), undefined)
      assert.equal(textOf(glyphTree(driver)), '回收站', 'the name stays, the count does not')
    } finally {
      driver.restore()
    }
  })

  it('caps a huge count instead of widening the row', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ sessionId: `s-${index}`, displayTitle: `t-${index}`, bytes: 1 }))
    const driver = mount({ routes: { ...ROUTES, trashList: { root: '/t', rows } } })
    try {
      await tick()
      assert.equal(textOf(countNode(glyphTree(driver))), '99+')
    } finally {
      driver.restore()
    }
  })
})

describe('soft delete dialog', () => {
  it('says it moves the conversation to the trash, and calls the trash route', async () => {
    const driver = mount()
    try {
      menuRow(driver).props.onSelect()
      await tick()

      let overlays = flatten(driver.overrides())
      assert.ok(dump(overlays).includes('移入回收站'), 'the body must say it moves to the trash')

      button(overlays, '移入回收站').props.onClick()
      await tick()

      const trashCall = driver.calls.find((call) => call.target.endsWith('/trash'))
      assert.ok(trashCall !== undefined, 'the host must receive a /trash call')
      assert.equal(trashCall.body.sessionId, 'session-a')
      assert.equal(trashCall.body.displayTitle, 'demo')
      assert.equal(trashCall.body.cwd, '/p')
      assert.ok(!driver.calls.some((call) => call.target.endsWith('/delete')), 'nothing permanent yet')

      overlays = flatten(driver.overrides())
      assert.ok(dump(overlays).includes('已移入回收站'))
      assert.ok(dump(overlays).includes('/home/.dsh/session-trash/p/session-a'), 'the report names the trash path')
    } finally {
      driver.restore()
    }
  })
})

describe('trash panel page', () => {
  /**
   * Render the page and let its lazy load settle.
   * @param options - mount options.
   * @returns the driver.
   */
  async function openPage(options = {}) {
    const driver = mount(options)
    driver.render()
    await tick()
    return driver
  }

  it('lists what the trash holds', async () => {
    const driver = await openPage()
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

  it('shows size, location, last activity and deletion time for every row', async () => {
    const driver = await openPage()
    try {
      const tree = driver.render()
      const text = textOf(tree)
      assert.ok(text.includes('大小'), 'the size label must render')
      assert.ok(text.includes('2.0 KB'), 'the size value must render')
      assert.ok(text.includes('文件位置'), 'the location label must render')
      assert.ok(text.includes('/home/.dsh/session-trash/p/session-a'), 'the full path must render')
      assert.ok(text.includes('最后对话'), 'the last-activity label must render')
      assert.ok(text.includes(stamp('2026-10-27T09:08:07.000Z')), 'the last activity must be a full timestamp')
      assert.ok(text.includes('删除时间'), 'the deletion-time label must render')
      assert.ok(text.includes(stamp('2026-10-29T01:02:03.000Z')), 'the deletion time must be a full timestamp')
    } finally {
      driver.restore()
    }
  })

  it('filters by title, path or project', async () => {
    const driver = await openPage()
    try {
      const search = find(driver.render(), (element) => element.props?.type === 'search')
      assert.ok(search !== undefined, 'the page needs a filter box')
      search.props.onChange({ target: { value: 'alpha' } })
      await tick()

      const tree = driver.render()
      assert.ok(textOf(tree).includes('alpha 会话'))
      assert.ok(!textOf(tree).includes('beta 会话'), 'the filter must hide the rest')
    } finally {
      driver.restore()
    }
  })

  it('purges a multi-selection through a confirmation modal', async () => {
    const driver = await openPage()
    try {
      button(driver.render(), '全选').props.onClick()
      await tick()
      assert.ok(dump(driver.render()).includes('已选 2 项'))

      button(driver.render(), '永久删除').props.onClick()
      await tick()

      const modal = dump(driver.render())
      assert.ok(modal.includes('永久删除 2 项？'), 'the modal asks the question')
      assert.ok(modal.includes('无法恢复'), 'and states the consequence')
      assert.ok(modal.includes('4') || modal.includes('KB'), 'and names the bytes')
      assert.ok(!driver.calls.some((call) => call.target.endsWith('/purge')), 'opening the modal deletes nothing')

      button(driver.render(), '确认永久删除').props.onClick()
      await tick()

      const purge = driver.calls.find((call) => call.target.endsWith('/purge'))
      assert.ok(purge !== undefined, 'the modal button issues the purge')
      assert.deepEqual([...purge.body.sessionIds].sort(), ['session-a', 'session-b'])
      assert.ok(dump(driver.render()).includes('已永久删除 2 项'))
    } finally {
      driver.restore()
    }
  })

  it('cancels the modal without touching the host', async () => {
    const driver = await openPage()
    try {
      button(driver.render(), '全选').props.onClick()
      await tick()
      button(driver.render(), '永久删除').props.onClick()
      await tick()

      const before = driver.calls.length
      exactButton(driver.render(), '取消').props.onClick()
      await tick()
      assert.ok(!dump(driver.render()).includes('永久删除 2 项？'), 'the modal closes')
      assert.equal(driver.calls.length, before, 'cancel talks to nobody')
    } finally {
      driver.restore()
    }
  })

  it('restores the selection', async () => {
    const driver = await openPage()
    try {
      const checkbox = find(driver.render(), (element) => element.props?.type === 'checkbox')
      checkbox.props.onChange()
      await tick()

      button(driver.render(), '恢复').props.onClick()
      await tick()
      assert.ok(dump(driver.render()).includes('恢复 1 项？'), 'restore asks first too')

      button(driver.render(), '确认恢复').props.onClick()
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
    const driver = await openPage()
    try {
      button(driver.render(), '清空回收站').props.onClick()
      await tick()
      assert.ok(dump(driver.render()).includes('清空回收站？'), 'emptying asks first')
      assert.ok(!driver.calls.some((call) => call.target.endsWith('/empty')))

      button(driver.render(), '确认清空').props.onClick()
      await tick()
      assert.ok(driver.calls.some((call) => call.target.endsWith('/empty')))
      assert.ok(dump(driver.render()).includes('回收站已清空'))
    } finally {
      driver.restore()
    }
  })

  it('reports a host failure instead of pretending it worked', async () => {
    const driver = await openPage()
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
        button(driver.render(), '确认永久删除').props.onClick()
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
      assert.equal(byLocale.en.footerTrash, 'Trash')
    } finally {
      driver.restore()
    }
  })

  it('follows the active language on the row and the page', async () => {
    const driver = mount({ locale: 'zh' })
    try {
      assert.ok(textOf(menuRow(driver)).includes('删除会话'))

      driver.locale.setLocale('en')
      assert.ok(textOf(menuRow(driver)).includes('Delete chat'))

      driver.render()
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
      const label = textOf(menuRow(driver))
      assert.ok(label.length > 0)
      assert.ok(!label.includes('deleteChat.'), 'a missing service must not leak the raw key')
    } finally {
      driver.restore()
    }
  })
})
