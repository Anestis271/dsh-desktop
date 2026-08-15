import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, createShortcutWriter } from '../src/client/index.js'
import { en } from '../src/client/locales.js'
import {
  ShortcutSettingsRow, type DesktopClientSettings, type ShortcutSettingsRowProps,
} from '../src/client/shortcut-settings-row.js'

const ready = (shortcuts: DesktopClientSettings['shortcuts'] | undefined, writable = true): SettingsScopeSnapshot<DesktopClientSettings> => ({
  status: shortcuts === undefined ? 'loading' : 'ready',
  value: shortcuts === undefined ? undefined : { shortcuts },
  base: undefined,
  user: undefined,
  revision: 0,
  writable,
  mode: 'host',
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

  it('serializes nested shortcut writes and recovers after a failed write', async () => {
    let snapshot = ready({ desktop: false, appMenu: false, login: false })
    const set = vi.fn(async (_field: string, value: unknown) => {
      snapshot = ready(value as DesktopClientSettings['shortcuts'])
    })
    const scope = { getSnapshot: () => snapshot, set } as unknown as SettingsScope<DesktopClientSettings>
    const write = createShortcutWriter(scope)
    await Promise.all([write('desktop', true), write('appMenu', true)])
    expect(set.mock.calls).toEqual([
      ['shortcuts', { desktop: true, appMenu: false, login: false }],
      ['shortcuts', { desktop: true, appMenu: true, login: false }],
    ])

    const failure = new Error('write failed')
    set.mockRejectedValueOnce(failure)
    await expect(write('login', true)).rejects.toThrow(failure)
    await expect(write('login', false)).resolves.toBeUndefined()

    snapshot = ready(undefined)
    await expect(write('desktop', true)).resolves.toBeUndefined()
    expect(set).toHaveBeenLastCalledWith('shortcuts', { desktop: true, appMenu: false, login: false })
  })

  it('registers the localized General settings row through official services', async () => {
    const scope = {
      getSnapshot: () => ready({ desktop: false, appMenu: false, login: false }),
      subscribe: vi.fn(),
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    } as unknown as SettingsScope<DesktopClientSettings>
    const bind = vi.fn(() => scope)
    const registerLocale = vi.fn(() => vi.fn())
    const registerSlot = vi.fn((options: unknown) => options)
    const injectSlot = vi.fn((_name: string, register: () => unknown) => register())
    const effect = vi.fn((register: () => unknown) => register())
    const ctx = {
      settingsScope: { bind },
      locale: { register: registerLocale },
      slots: { inject: injectSlot, register: registerSlot },
      effect,
    }

    apply(ctx as never)
    expect(bind).toHaveBeenCalledWith({ namespace: 'desktop' })
    expect(registerLocale).toHaveBeenCalledWith('settings.desktop', expect.objectContaining({ zh: expect.any(Object), en }))
    expect(injectSlot).toHaveBeenCalledWith('settings.general.item', expect.any(Function))
    const options = registerSlot.mock.calls[0]?.[0] as { id: string; inject: () => { setShortcut(key: 'desktop', enabled: boolean): void } }
    expect(options.id).toBe('desktop-shortcuts')
    options.inject().setShortcut('desktop', true)
    await vi.waitFor(() => { expect(scope.set).toHaveBeenCalledWith('shortcuts', { desktop: true, appMenu: false, login: false }) })
  })
})
