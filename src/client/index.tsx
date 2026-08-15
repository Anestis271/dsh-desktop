import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type DesktopSettingsKey } from './locales.js'
import {
  ShortcutSettingsRow, type ClientShortcutSettings, type DesktopClientSettings, type ShortcutSettingsRowInjected,
} from './shortcut-settings-row.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.desktop': DesktopSettingsKey
  }
}

const NAMESPACE = 'settings.desktop'
const DEFAULT_SHORTCUTS: ClientShortcutSettings = { desktop: false, appMenu: false, login: false }

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function createShortcutWriter(scope: SettingsScope<DesktopClientSettings>) {
  let tail = Promise.resolve()
  return (key: keyof ClientShortcutSettings, enabled: boolean): Promise<void> => {
    const operation = tail.catch(() => {}).then(async () => {
      const current = scope.getSnapshot().value?.shortcuts ?? DEFAULT_SHORTCUTS
      await scope.set('shortcuts', { ...current, [key]: enabled })
    })
    tail = operation
    return operation
  }
}

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<DesktopClientSettings>({ namespace: 'desktop' })
  const writeShortcut = createShortcutWriter(scope)
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'dsh-desktop: settings dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-shortcuts',
    order: 30,
    locale: NAMESPACE,
    inject: (): ShortcutSettingsRowInjected => ({
      hooks: { desktopSettings: scope },
      setShortcut: (key, enabled) => { void writeShortcut(key, enabled) },
    }),
  }, ShortcutSettingsRow))
}
