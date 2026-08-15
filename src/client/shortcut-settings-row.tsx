import React from 'react'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopSettingsKey } from './locales.js'
import styles from './shortcut-settings-row.module.css'

export interface ClientShortcutSettings {
  desktop: boolean
  appMenu: boolean
  login: boolean
}

export interface DesktopClientSettings {
  shortcuts: ClientShortcutSettings
}

export interface ShortcutSettingsRowInjected {
  hooks: {
    desktopSettings: {
      getSnapshot(): SettingsScopeSnapshot<DesktopClientSettings>
      subscribe(listener: () => void): () => void
    }
  }
  setShortcut: (key: keyof ClientShortcutSettings, enabled: boolean) => void
}

export type ShortcutSettingsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<ShortcutSettingsRowInjected>

const DEFAULT_SHORTCUTS: ClientShortcutSettings = { desktop: false, appMenu: false, login: false }
const OPTIONS: readonly { key: keyof ClientShortcutSettings; label: DesktopSettingsKey }[] = [
  { key: 'desktop', label: 'desktop' },
  { key: 'appMenu', label: 'appMenu' },
  { key: 'login', label: 'login' },
]

export function ShortcutSettingsRow({ t, useDesktopSettings, setShortcut }: ShortcutSettingsRowProps) {
  const snapshot = useDesktopSettings(value => value)
  const shortcuts = snapshot.value?.shortcuts ?? DEFAULT_SHORTCUTS
  const disabled = snapshot.status !== 'ready' || !snapshot.writable
  return (
    <div className={styles.row}>
      <div className={styles.copy}>
        <div className={styles.title}>{t('title')}</div>
        <div className={styles.description}>{t('description')}</div>
      </div>
      <div className={styles.options}>
        {OPTIONS.map((option) => {
          const enabled = shortcuts[option.key]
          const label = t(option.label)
          return (
            <div className={styles.option} key={option.key}>
              <span>{label}</span>
              <button
                type="button"
                className={styles.switch}
                role="switch"
                aria-label={label}
                aria-checked={enabled}
                disabled={disabled}
                onClick={() => { setShortcut(option.key, !enabled) }}
              >
                <span className={styles.thumb} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
