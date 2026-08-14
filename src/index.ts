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
import { launchDesktop, type DesktopLaunchOptions, type DesktopSession } from './runtime.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop-shell settings resolved from composition and the user layer. */
    desktop: DesktopController
  }
}

/** Settings namespace owned by the desktop shell. */
export const DESKTOP_SETTINGS_NAMESPACE = settingsNamespace('desktop')

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
  static inject = ['webServer']
  static Config = Config

  private source: () => ResolvedConfig
  private session: DesktopSession | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'desktop')
    const entry = config as ResolvedConfig
    this.source = () => entry
    installSettingsSection(ctx, DESKTOP_SETTINGS_NAMESPACE, Config, entry, {
      setSource: current => { this.source = current as () => ResolvedConfig },
      onChange: () => {},
    })
    ctx.effect(async () => {
      const current = this.current()
      const options: DesktopLaunchOptions = {
        url: `http://127.0.0.1:${String(ctx.webServer.port)}`,
        profileDir: dshHomePath('profiles', 'desktop'),
        config: current,
      }
      const session = await internals.launch(options)
      this.session = session
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
}

export default DesktopController

/** Runtime seams kept injectable for lifecycle tests and future dsh hosts. */
export const internals: {
  launch: (options: DesktopLaunchOptions) => Promise<DesktopSession>
} = {
  launch: launchDesktop,
}
