/**
 * dsh desktop-shell settings and lifecycle service.
 *
 * @module @anestis/dsh-desktop
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-cmdline'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { homedir } from 'node:os'
import { launchDesktop, type DesktopLaunchOptions, type DesktopSession } from './runtime.js'
import { reconcileShortcuts, type LaunchCommand } from './shortcuts.js'
import type { DesktopLocale } from './protocol.js'
import { createDesktopSettingsRoute } from './settings-route.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop-shell settings resolved from composition and the user layer. */
    desktop: DesktopController
  }
}

/** Settings namespace owned by the desktop shell. */
export const DESKTOP_SETTINGS_NAMESPACE = settingsNamespace('desktop')
const LOCALE_SETTINGS_NAMESPACE = settingsNamespace('locale')

/** Resolve dsh's supported locale preference for native shell strings. */
export function desktopLocale(value: unknown): DesktopLocale {
  return typeof value === 'object' && value !== null && 'preference' in value && value.preference === 'en'
    ? 'en'
    : 'zh'
}

/** User-controlled shortcut targets; every target is opt-in. */
export interface ShortcutSettings {
  /** Create a desktop shortcut. */
  desktop: boolean
  /** Create a Start-menu, Applications, or freedesktop app-menu entry. */
  appMenu: boolean
  /** Launch the desktop profile after user login. */
  login: boolean
}

/** Desktop-shell composition and user settings. */
export interface Config {
  /** Hide the window instead of ending dsh when the close button is pressed. */
  closeToTray?: boolean
  /** Create the first window hidden; useful for login launch. */
  startHidden?: boolean
  /** Native window title. */
  title?: string
  /** Optional OS entry points, all disabled by default. */
  shortcuts?: ShortcutSettings
}

/** Fully defaulted settings exposed to the runtime. */
export interface ResolvedConfig {
  closeToTray: boolean
  startHidden: boolean
  title: string
  shortcuts: ShortcutSettings
}

/** Runtime schema shared by Cordis configuration and dsh user settings. */
export const Config: z<Config> = z.object({
  closeToTray: z.boolean().default(true),
  startHidden: z.boolean().default(false),
  title: z.string().default('DeepSeek Harness'),
  shortcuts: z.object({
    desktop: z.boolean().default(false),
    appMenu: z.boolean().default(false),
    login: z.boolean().default(false),
  }).default({ desktop: false, appMenu: false, login: false }),
})

/**
 * Owns the desktop settings namespace. Runtime resources are added in later
 * implementation slices without changing the configuration contract.
 */
export class DesktopController extends Service {
  static inject = ['webServer', 'settings']
  static Config = Config

  private source: () => ResolvedConfig
  private session: DesktopSession | undefined
  private shortcutSync: Promise<void> = Promise.resolve()
  private locale: DesktopLocale

  constructor(ctx: Context, config: Config) {
    super(ctx, 'desktop')
    const entry = config as ResolvedConfig
    this.source = () => entry
    this.locale = desktopLocale(ctx.get('settings')?.get(LOCALE_SETTINGS_NAMESPACE))
    ctx.on('settings/updated', (ns, next) => {
      if (ns !== LOCALE_SETTINGS_NAMESPACE) return
      const locale = desktopLocale(next)
      if (locale === this.locale) return
      this.locale = locale
      this.session?.updateLocale(locale)
    })
    installSettingsSection(ctx, DESKTOP_SETTINGS_NAMESPACE, Config, entry, {
      setSource: current => { this.source = current as () => ResolvedConfig },
      onChange: () => { this.queueShortcutSync() },
    })
    ctx.effect(() => ctx.webServer.register(createDesktopSettingsRoute({
      read: () => this.current().shortcuts,
      write: async (key, enabled) => {
        await ctx.settings.update(DESKTOP_SETTINGS_NAMESPACE, { shortcuts: { [key]: enabled } })
      },
    }, `127.0.0.1:${String(ctx.webServer.port)}`)), 'dsh-desktop: settings route')
    this.queueShortcutSync()
    ctx.effect(async () => {
      const current = this.current()
      const options: DesktopLaunchOptions = {
        url: `http://127.0.0.1:${String(ctx.webServer.port)}`,
        profileDir: dshHomePath('profiles', 'desktop'),
        locale: this.locale,
        config: current,
      }
      const session = await internals.launch(options)
      this.session = session
      session.updateLocale(this.locale)
      if (session.duplicate) ctx.get('appExit')?.(0)
      return async () => {
        this.session = undefined
        await session.stop()
      }
    })
  }

  /** Return the current composition plus user settings. */
  current(): ResolvedConfig {
    return structuredClone(this.source())
  }

  /** Serialize shortcut writes so rapid settings edits cannot interleave. */
  private queueShortcutSync(): void {
    const config = this.current()
    this.shortcutSync = this.shortcutSync
      .then(() => internals.reconcileShortcuts(config.shortcuts, {
        platform: process.platform,
        home: homedir(),
        command: desktopLaunchCommand(),
      }))
      .catch(error => {
        this.ctx.logger.warn('dsh-desktop: shortcut reconciliation failed: %o', error)
      })
  }
}

export default DesktopController

/** Runtime seams kept injectable for lifecycle tests and future dsh hosts. */
export const internals: {
  launch: (options: DesktopLaunchOptions) => Promise<DesktopSession>
  reconcileShortcuts: typeof reconcileShortcuts
} = {
  launch: launchDesktop,
  reconcileShortcuts,
}

/** Build the portable command used by all optional user-level entry points. */
export function desktopLaunchCommand(): LaunchCommand {
  return {
    executable: process.execPath,
    args: [process.argv[1] ?? 'dsh', '--profile', 'desktop'],
    cwd: process.cwd(),
  }
}
