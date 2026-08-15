import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopController, { DESKTOP_SETTINGS_NAMESPACE, desktopLaunchCommand, desktopLocale, desktopWindowsActivation, internals } from '../src/index.js'

class MemorySettings extends SettingsProvider {
  private document: Record<string, unknown> = {}

  seed(ns: SettingsNamespace, section: Record<string, unknown>): void {
    this.document = { ...this.document, [ns]: structuredClone(section) }
    this.publish(structuredClone(this.document))
  }

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

function provideWebServer(ctx: Context): ReturnType<typeof vi.fn> {
  const register = vi.fn(() => vi.fn())
  ctx.provide('webServer', { host: '127.0.0.1', port: 3080, register } as never)
  return register
}

describe('DesktopController', () => {
  const originalLaunch = internals.launch
  const originalReconcile = internals.reconcileShortcut
  const originalPrepareTaskbarRelaunch = internals.prepareTaskbarRelaunch

  beforeEach(() => {
    internals.launch = vi.fn(async () => ({ duplicate: false, updateLocale: vi.fn(), stop: async () => {} }))
    internals.reconcileShortcut = vi.fn(async () => {})
    internals.prepareTaskbarRelaunch = vi.fn(async () => 'wscript.exe relaunch.vbs')
  })

  afterEach(() => {
    internals.launch = originalLaunch
    internals.reconcileShortcut = originalReconcile
    internals.prepareTaskbarRelaunch = originalPrepareTaskbarRelaunch
  })

  it('applies lightweight defaults from an empty settings document', async () => {
    const ctx = new Context()
    const registerRoute = provideWebServer(ctx)
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(DesktopController, {})

    expect(ctx.settings.describe().map(({ ns }) => ns)).toContain(DESKTOP_SETTINGS_NAMESPACE)
    expect(registerRoute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'exact', path: '/dsh-desktop/settings',
    }))
    const route = registerRoute.mock.calls[0]?.[0] as WebRoute
    const request = Readable.from([JSON.stringify({ action: 'setLogin', enabled: true })]) as IncomingMessage
    request.method = 'POST'
    request.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
    const response = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() } as unknown as ServerResponse
    await route.handler(request, response)
    expect(ctx.desktop.current().shortcuts.login).toBe(true)
    const createRequest = Readable.from([JSON.stringify({ action: 'create', target: 'desktop' })]) as IncomingMessage
    createRequest.method = 'POST'
    createRequest.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
    await route.handler(createRequest, response)
    expect(ctx.desktop.current()).toEqual({
      closeToTray: true,
      startHidden: false,
      title: 'DeepSeek Harness',
      shortcuts: { login: true },
    })
    await vi.waitFor(() => { expect(internals.reconcileShortcut).toHaveBeenCalledWith(
      'login', false,
      expect.objectContaining({ platform: process.platform, home: homedir() }),
    ) })
    await vi.waitFor(() => { expect(internals.reconcileShortcut).toHaveBeenCalledWith(
      'desktop', true,
      expect.objectContaining({ platform: process.platform, home: homedir() }),
    ) })
    await vi.waitFor(() => { expect(internals.launch).toHaveBeenCalledWith(expect.objectContaining({
      relaunchCommand: 'wscript.exe relaunch.vbs',
    })) })
    await ctx.fiber.dispose()
  })

  it('tracks the desktop user-settings namespace until its provider detaches', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const settings = ctx.settings as MemorySettings
    settings.seed(DESKTOP_SETTINGS_NAMESPACE, { shortcuts: { login: false } })
    await ctx.plugin(DesktopController, { title: 'dsh Desktop' })

    await ctx.settings.update(DESKTOP_SETTINGS_NAMESPACE, {
      closeToTray: false,
      shortcuts: { login: true },
    })
    const first = ctx.desktop.current()
    first.shortcuts.login = false
    expect(ctx.desktop.current()).toEqual({
      closeToTray: false,
      startHidden: false,
      title: 'dsh Desktop',
      shortcuts: { login: true },
    })
    await vi.waitFor(() => { expect(internals.reconcileShortcut).toHaveBeenLastCalledWith(
      'login', true,
      expect.any(Object),
    ) })

    await settingsFiber.dispose()
    expect(ctx.get('desktop')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('removes legacy shortcut toggles while preserving current settings', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    await ctx.plugin(MemorySettings).await()
    const settings = ctx.settings as MemorySettings
    settings.seed(DESKTOP_SETTINGS_NAMESPACE, {
      closeToTray: false,
      shortcuts: { desktop: true, login: true },
    })

    await ctx.plugin(DesktopController, {})
    await vi.waitFor(() => {
      expect(ctx.settings.describe().find(({ ns }) => ns === DESKTOP_SETTINGS_NAMESPACE)?.user).toEqual({
        closeToTray: false,
        shortcuts: { login: true },
      })
    })
    expect(ctx.desktop.current().shortcuts).toEqual({ login: true })
    await ctx.fiber.dispose()
  })

  it('contains legacy settings migration failures', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    await ctx.plugin(MemorySettings).await()
    const settings = ctx.settings as MemorySettings
    settings.seed(DESKTOP_SETTINGS_NAMESPACE, { shortcuts: { appMenu: true } })
    vi.spyOn(settings, 'mutate').mockRejectedValueOnce(new Error('read-only document'))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    await ctx.plugin(DesktopController, {})
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'dsh-desktop: legacy shortcut settings migration failed: %o',
        expect.objectContaining({ message: 'read-only document' }),
      )
    })
    await ctx.fiber.dispose()
  })

  it('requests dsh shutdown when another instance owns the profile UI', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    await ctx.plugin(MemorySettings).await()
    const exit = vi.fn()
    ctx.provide('appExit', exit)
    internals.launch = vi.fn(async () => ({ duplicate: true, updateLocale: vi.fn(), stop: async () => {} }))
    await ctx.plugin(DesktopController, {})
    await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0) })
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
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    internals.reconcileShortcut = reconcile
    await ctx.plugin(DesktopController, {})
    await vi.waitFor(() => { expect(reconcile).toHaveBeenCalled() })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(
      'dsh-desktop: shortcut reconciliation failed: %o',
      expect.objectContaining({ message: 'disk unavailable' }),
    ) })
    await ctx.settings.update(DESKTOP_SETTINGS_NAMESPACE, { shortcuts: { login: true } })
    await vi.waitFor(() => { expect(reconcile).toHaveBeenLastCalledWith(
      'login', true,
      expect.any(Object),
    ) })
    await ctx.fiber.dispose()
  })

  it('forwards live dsh locale changes to the native shell', async () => {
    const ctx = new Context()
    provideWebServer(ctx)
    await ctx.plugin(MemorySettings).await()
    const updateLocale = vi.fn()
    internals.launch = vi.fn(async () => ({ duplicate: false, updateLocale, stop: async () => {} }))
    await ctx.plugin(DesktopController, {})
    await vi.waitFor(() => { expect(updateLocale).toHaveBeenCalledWith('zh') })
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
    expect(desktopWindowsActivation('C:/profile')).toEqual({
      electronPath: expect.stringMatching(/desktop-shell[\\/]electron/),
      entryPath: expect.stringMatching(/electron-activate\.cjs$/),
      profileDir: 'C:/profile',
    })
  })

  it('has a deterministic fallback for embedded launchers', () => {
    const entry = process.argv[1]
    process.argv.splice(1, 1)
    expect(desktopLaunchCommand().args[0]).toBe('dsh')
    process.argv.splice(1, 0, entry as string)
  })
})
