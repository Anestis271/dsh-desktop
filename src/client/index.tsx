import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type DesktopSettingsKey } from './locales.js'
import {
  ShortcutSettingsRow, type ShortcutSettingsRowInjected,
} from './shortcut-settings-row.js'
import { DesktopSettingsStore } from './desktop-settings-store.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.desktop': DesktopSettingsKey
  }
}

const NAMESPACE = 'settings.desktop'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const store = new DesktopSettingsStore()
  void store.load()
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'dsh-desktop: settings dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-shortcuts',
    order: 30,
    locale: NAMESPACE,
    inject: (): ShortcutSettingsRowInjected => ({
      hooks: { desktopSettings: store },
      setShortcut: (key, enabled) => { void store.setShortcut(key, enabled).catch(() => {}) },
    }),
  }, ShortcutSettingsRow))
}
