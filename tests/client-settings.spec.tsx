import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { en } from '../src/client/locales.js'
import { DesktopSettingsStore, type DesktopSettingsSnapshot } from '../src/client/desktop-settings-store.js'
import {
  ShortcutSettingsRow, type DesktopClientSettings, type ShortcutSettingsRowProps,
} from '../src/client/shortcut-settings-row.js'

const ready = (shortcuts: DesktopClientSettings['shortcuts'] | undefined, writable = true): DesktopSettingsSnapshot => ({
  status: shortcuts === undefined ? 'loading' : 'ready',
  value: shortcuts === undefined ? undefined : { shortcuts },
  writable,
})

function descendants(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return []
  return [node, ...Children.toArray((node.props as { children?: ReactNode }).children).flatMap(descendants)]
}

describe('desktop shortcut settings client', () => {
  it('renders two create actions and one accessible login switch', () => {
    const createShortcut = vi.fn()
    const setLogin = vi.fn()
    const snapshot = ready({ login: true })
    const tree = ShortcutSettingsRow({
      t: key => en[key],
      useDesktopSettings: selector => selector(snapshot),
      createShortcut,
      setLogin,
    } as ShortcutSettingsRowProps)
    const buttons = descendants(tree).filter(element => element.type === 'button' && element.props.role !== 'switch')
    const switches = descendants(tree).filter(element => element.props.role === 'switch')

    expect(buttons).toHaveLength(2)
    expect(buttons.map(element => element.props.children)).toEqual(['Create', 'Create'])
    buttons[0]?.props.onClick()
    buttons[1]?.props.onClick()
    expect(createShortcut.mock.calls).toEqual([['desktop'], ['appMenu']])
    expect(switches).toHaveLength(1)
    expect(switches[0]?.props).toMatchObject({ 'aria-label': 'Launch at login', 'aria-checked': true })
    switches[0]?.props.onClick()
    expect(setLogin).toHaveBeenCalledWith(false)
  })

  it('disables controls until writable settings arrive and defaults them off', () => {
    const tree = ShortcutSettingsRow({
      t: key => en[key],
      useDesktopSettings: selector => selector(ready(undefined, false)),
      createShortcut: vi.fn(),
      setLogin: vi.fn(),
    } as ShortcutSettingsRowProps)
    const controls = descendants(tree).filter(element => element.type === 'button')
    expect(controls).toHaveLength(3)
    expect(controls.every(element => element.props.disabled === true)).toBe(true)
    expect(controls.find(element => element.props.role === 'switch')?.props['aria-checked']).toBe(false)
  })

  it('loads, publishes, and serializes shortcut writes', async () => {
    const values = [
      { shortcuts: { login: false } },
      { shortcuts: { login: false } },
      { shortcuts: { login: true } },
    ]
    const fetcher = vi.fn(async () => new Response(JSON.stringify(values.shift()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const store = new DesktopSettingsStore(fetcher)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.load()
    await Promise.all([store.createShortcut('desktop'), store.setLogin(true)])
    expect(store.getSnapshot()).toEqual(ready({ login: true }))
    expect(fetcher.mock.calls.map(call => call[1]?.body)).toEqual([
      undefined,
      JSON.stringify({ action: 'create', target: 'desktop' }),
      JSON.stringify({ action: 'setLogin', enabled: true }),
    ])
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    await store.load()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('contains loading and write failures', async () => {
    const invalid = vi.fn(async () => new Response('{}', { status: 200 }))
    const invalidStore = new DesktopSettingsStore(invalid)
    await invalidStore.load()
    expect(invalidStore.getSnapshot()).toEqual({ status: 'error', writable: false })

    const unavailable = vi.fn(async () => new Response('', { status: 503 }))
    const store = new DesktopSettingsStore(unavailable)
    const listener = vi.fn()
    store.subscribe(listener)
    await store.load()
    await expect(store.setLogin(true)).rejects.toThrow('desktop settings request failed (503)')
    await vi.waitFor(() => { expect(listener).toHaveBeenCalledTimes(2) })
    expect(store.getSnapshot()).toEqual({ status: 'error', writable: false })
  })

  it('registers the localized General settings row through official services', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      shortcuts: { login: false },
    }), { status: 200 }))
    const registerLocale = vi.fn(() => vi.fn())
    const registerSlot = vi.fn((options: unknown) => options)
    const injectSlot = vi.fn((_name: string, register: () => unknown) => register())
    const effect = vi.fn((register: () => unknown) => register())
    const ctx = {
      locale: { register: registerLocale },
      slots: { inject: injectSlot, register: registerSlot },
      effect,
    }

    apply(ctx as never)
    await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(1) })
    expect(fetcher.mock.contexts[0]).toBe(globalThis)
    expect(registerLocale).toHaveBeenCalledWith('settings.desktop', expect.objectContaining({ zh: expect.any(Object), en }))
    expect(injectSlot).toHaveBeenCalledWith('settings.general.item', expect.any(Function))
    const options = registerSlot.mock.calls[0]?.[0] as {
      id: string
      inject: () => { createShortcut(target: 'desktop'): void, setLogin(enabled: boolean): void }
    }
    expect(options.id).toBe('desktop-shortcuts')
    options.inject().createShortcut('desktop')
    options.inject().setLogin(true)
    await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(3) })
    expect(fetcher).toHaveBeenLastCalledWith('/dsh-desktop/settings', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'setLogin', enabled: true }),
    }))
    fetcher.mockRestore()
  })
})
