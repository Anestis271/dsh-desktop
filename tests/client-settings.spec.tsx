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
  it('renders three accessible live switches and applies user choices', () => {
    const setShortcut = vi.fn()
    const snapshot = ready({ desktop: true, appMenu: false, login: true })
    const tree = ShortcutSettingsRow({
      t: key => en[key],
      useDesktopSettings: selector => selector(snapshot),
      setShortcut,
    } as ShortcutSettingsRowProps)
    const switches = descendants(tree).filter(element => element.type === 'button')

    expect(switches.map(element => element.props['aria-label'])).toEqual([
      'Desktop shortcut', 'Application menu', 'Launch at login',
    ])
    expect(switches.map(element => element.props['aria-checked'])).toEqual([true, false, true])
    for (const element of switches) element.props.onClick()
    expect(setShortcut.mock.calls).toEqual([
      ['desktop', false], ['appMenu', true], ['login', false],
    ])
  })

  it('disables controls until writable settings arrive and defaults them off', () => {
    const tree = ShortcutSettingsRow({
      t: key => en[key],
      useDesktopSettings: selector => selector(ready(undefined, false)),
      setShortcut: vi.fn(),
    } as ShortcutSettingsRowProps)
    const switches = descendants(tree).filter(element => element.type === 'button')
    expect(switches.every(element => element.props.disabled === true)).toBe(true)
    expect(switches.every(element => element.props['aria-checked'] === false)).toBe(true)
  })

  it('loads, publishes, and serializes shortcut writes', async () => {
    const values = [
      { shortcuts: { desktop: false, appMenu: false, login: false } },
      { shortcuts: { desktop: true, appMenu: false, login: false } },
      { shortcuts: { desktop: true, appMenu: true, login: false } },
    ]
    const fetcher = vi.fn(async () => new Response(JSON.stringify(values.shift()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const store = new DesktopSettingsStore(fetcher)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.load()
    await Promise.all([store.setShortcut('desktop', true), store.setShortcut('appMenu', true)])
    expect(store.getSnapshot()).toEqual(ready({ desktop: true, appMenu: true, login: false }))
    expect(fetcher.mock.calls.map(call => call[1]?.body)).toEqual([
      undefined,
      JSON.stringify({ key: 'desktop', enabled: true }),
      JSON.stringify({ key: 'appMenu', enabled: true }),
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
    await expect(store.setShortcut('login', true)).rejects.toThrow('desktop settings request failed (503)')
    await vi.waitFor(() => { expect(listener).toHaveBeenCalledTimes(2) })
    expect(store.getSnapshot()).toEqual({ status: 'error', writable: false })
  })

  it('registers the localized General settings row through official services', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      shortcuts: { desktop: false, appMenu: false, login: false },
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
    expect(registerLocale).toHaveBeenCalledWith('settings.desktop', expect.objectContaining({ zh: expect.any(Object), en }))
    expect(injectSlot).toHaveBeenCalledWith('settings.general.item', expect.any(Function))
    const options = registerSlot.mock.calls[0]?.[0] as { id: string; inject: () => { setShortcut(key: 'desktop', enabled: boolean): void } }
    expect(options.id).toBe('desktop-shortcuts')
    options.inject().setShortcut('desktop', true)
    await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2) })
    expect(fetcher).toHaveBeenLastCalledWith('/dsh-desktop/settings', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ key: 'desktop', enabled: true }),
    }))
    fetcher.mockRestore()
  })
})
