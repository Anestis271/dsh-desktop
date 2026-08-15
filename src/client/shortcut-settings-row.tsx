import React from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import styles from './shortcut-settings-row.module.css'
import type { DesktopSettingsSnapshot } from './desktop-settings-store.js'

export interface ClientShortcutSettings {
  login: boolean
}

export type ShortcutCreateTarget = 'desktop' | 'appMenu'

export interface DesktopClientSettings {
  shortcuts: ClientShortcutSettings
}

export interface ShortcutSettingsRowInjected {
  hooks: {
    desktopSettings: {
      getSnapshot(): DesktopSettingsSnapshot
      subscribe(listener: () => void): () => void
    }
  }
  createShortcut: (target: ShortcutCreateTarget) => void
  setLogin: (enabled: boolean) => void
}

export type ShortcutSettingsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'>
  & InjectFace<ShortcutSettingsRowInjected>

const DEFAULT_SHORTCUTS: ClientShortcutSettings = { login: false }

export function ShortcutSettingsRow({ t, useDesktopSettings, createShortcut, setLogin }: ShortcutSettingsRowProps) {
  const snapshot = useDesktopSettings(value => value)
  const shortcuts = snapshot.value?.shortcuts ?? DEFAULT_SHORTCUTS
  const disabled = snapshot.status !== 'ready' || !snapshot.writable
  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>{t('desktop')}</span>
        <button type="button" className={styles.create} disabled={disabled} onClick={() => { createShortcut('desktop') }}>
          {t('create')}
        </button>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{t('appMenu')}</span>
        <button type="button" className={styles.create} disabled={disabled} onClick={() => { createShortcut('appMenu') }}>
          {t('create')}
        </button>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{t('login')}</span>
        <button
          type="button"
          className={styles.switch}
          role="switch"
          aria-label={t('login')}
          aria-checked={shortcuts.login}
          disabled={disabled}
          onClick={() => { setLogin(!shortcuts.login) }}
        >
          <span className={styles.thumb} />
        </button>
      </div>
    </>
  )
}
