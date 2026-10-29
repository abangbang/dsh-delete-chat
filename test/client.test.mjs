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
    assert.equal(spec.id, 'dsh-session-delete')
  })

  it('exports a mountable face', () => {
    assert.equal(exports.name, 'dsh-session-delete')
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
    assert.equal(menu.entry.id, 'session-delete:menu-item')
    assert.equal(typeof menu.component, 'function')

    assert.equal(dialog.entry.name, 'shell.overlay')
    assert.equal(dialog.entry.id, 'session-delete:dialog')
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

  /** A primitives surface that has the real build's shape. */
  const PRIMITIVES = {
    MenuItemButton: function MenuItemButton() {},
    IconTrashOutlineRegular: function IconTrashOutlineRegular() {},
  }

  /**
   * Mount a fresh module instance whose `require` answers the primitives.
   * @returns the two registered components plus the menu row's props.
   */
  function mount() {
    const instance = spec.factory((id) => {
      if (id === 'react') return fakeReact
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
      throw new Error(`client test: unexpected module "${id}"`)
    })
    const registrations = []
    instance.apply({
      effect: (fn) => fn(),
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
    }
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
    assert.equal(props.className, 'dsh-session-delete__danger-row')
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
