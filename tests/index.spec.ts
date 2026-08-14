import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopController, { DESKTOP_SETTINGS_NAMESPACE, desktopLaunchCommand, desktopLocale, internals } from '../src/index.js'

class MemorySettings extends SettingsProvider {
  private document: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.document))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.document = { ...this.document, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function provideWebServer(ctx: Context): void {
  ctx.provide('webServer', { host: '127.0.0.1', port: 3080 } as never)
}

describe('DesktopController', () => {
  const originalLaunch = internals.launch
  const originalReconcile = internals.reconcileShortcuts

  beforeEach(() => {
    internals.launch = vi.fn(async () => ({ duplicate: false, updateLocale: vi.fn(), stop: async () => {} }))
    internals.reconcileShortcuts = vi.fn(async () => {})
  })

  afterEach(() => {
    internals.launch = originalLaunch
    internals.reconcileShortcuts = originalReconcile
  })

  it('applies lightweight defaults without a settings provider', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    await ctx.plugin(DesktopController, {})

    expect(ctx.desktop.current()).toEqual({
      closeToTray: true,
      startHidden: false,
      title: 'DeepSeek Harness',
      shortcuts: { desktop: false, appMenu: false, login: false },
    })
    await vi.waitFor(() => { expect(internals.reconcileShortcuts).toHaveBeenCalledWith(
      { desktop: false, appMenu: false, login: false },
      expect.objectContaining({ platform: process.platform }),
    ) })
    await ctx.fiber.dispose()
  })

  it('tracks the desktop user-settings namespace and returns detached values', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    await ctx.plugin(DesktopController, { title: 'dsh Desktop' })

    await ctx.settings.update(DESKTOP_SETTINGS_NAMESPACE, {
      closeToTray: false,
      shortcuts: { desktop: true },
    })
    const first = ctx.desktop.current()
    first.shortcuts.desktop = false
    expect(ctx.desktop.current()).toEqual({
      closeToTray: false,
      startHidden: false,
      title: 'dsh Desktop',
      shortcuts: { desktop: true, appMenu: false, login: false },
    })
    await vi.waitFor(() => { expect(internals.reconcileShortcuts).toHaveBeenLastCalledWith(
      { desktop: true, appMenu: false, login: false },
      expect.any(Object),
    ) })

    await settingsFiber.dispose()
    expect(ctx.desktop.current().closeToTray).toBe(true)
    await ctx.fiber.dispose()
  })

  it('requests dsh shutdown when another instance owns the profile UI', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    const exit = vi.fn()
    ctx.provide('appExit', exit)
    internals.launch = vi.fn(async () => ({ duplicate: true, updateLocale: vi.fn(), stop: async () => {} }))
    await ctx.plugin(DesktopController, {})
    expect(exit).toHaveBeenCalledWith(0)
    await ctx.fiber.dispose()
  })

  it('serializes settings-driven shortcut updates and recovers after a failed write', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const reconcile = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue(undefined)
    internals.reconcileShortcuts = reconcile
    await ctx.plugin(DesktopController, {})
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalled() })
    await ctx.settings.update(DESKTOP_SETTINGS_NAMESPACE, { shortcuts: { login: true } })
    await vi.waitFor(() => { expect(reconcile).toHaveBeenLastCalledWith(
      { desktop: false, appMenu: false, login: true },
      expect.any(Object),
    ) })
    await ctx.fiber.dispose()
  })

  it('forwards live dsh locale changes to the native shell', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    const updateLocale = vi.fn()
    internals.launch = vi.fn(async () => ({ duplicate: false, updateLocale, stop: async () => {} }))
    await ctx.plugin(DesktopController, {})
    expect(updateLocale).toHaveBeenCalledWith('zh')
    ctx.emit('settings/updated', settingsNamespace('other'), {}, {}, 'write')
    ctx.emit('settings/updated', settingsNamespace('locale'), { preference: 'zh' }, {}, 'write')
    ctx.emit('settings/updated', settingsNamespace('locale'), { preference: 'en' }, {}, 'write')
    expect(updateLocale).toHaveBeenLastCalledWith('en')
    await ctx.fiber.dispose()
  })
})

describe('desktopLaunchCommand', () => {
  it('maps dsh locale settings to the supported native languages', () => {
    expect(desktopLocale({ preference: 'en' })).toBe('en')
    expect(desktopLocale({ preference: 'zh' })).toBe('zh')
    expect(desktopLocale(null)).toBe('zh')
  })

  it('targets the current dsh entry with the desktop profile', () => {
    expect(desktopLaunchCommand()).toEqual({
      executable: process.execPath,
      args: [process.argv[1], '--profile', 'desktop'],
      cwd: process.cwd(),
    })
  })

  it('has a deterministic fallback for embedded launchers', () => {
    const entry = process.argv[1]
    process.argv.splice(1, 1)
    expect(desktopLaunchCommand().args[0]).toBe('dsh')
    process.argv.splice(1, 0, entry as string)
  })
})
