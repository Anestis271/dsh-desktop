import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import DesktopController, { DESKTOP_SETTINGS_NAMESPACE } from '../src/index.js'

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

    await settingsFiber.dispose()
    expect(ctx.desktop.current().closeToTray).toBe(true)
    await ctx.fiber.dispose()
  })
})
