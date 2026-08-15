import type { DesktopClientSettings, ShortcutCreateTarget } from './shortcut-settings-row.js'

export const DESKTOP_SETTINGS_PATH = '/dsh-desktop/settings'

export interface DesktopSettingsSnapshot {
  status: 'loading' | 'ready' | 'error'
  value?: DesktopClientSettings
  writable: boolean
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

function isSettings(value: unknown): value is DesktopClientSettings {
  if (typeof value !== 'object' || value === null || !('shortcuts' in value)) return false
  const shortcuts = value.shortcuts as Record<string, unknown>
  return typeof shortcuts === 'object' && shortcuts !== null
    && typeof shortcuts.login === 'boolean'
}

/** Small external store compatible with the official slot hook adapter. */
export class DesktopSettingsStore {
  private snapshot: DesktopSettingsSnapshot = { status: 'loading', writable: false }
  private readonly listeners = new Set<() => void>()
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly fetcher: Fetcher = (input, init) => globalThis.fetch(input, init)) {}

  readonly getSnapshot = (): DesktopSettingsSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async load(): Promise<void> {
    try {
      this.commit(await this.request())
    } catch {
      this.fail()
    }
  }

  createShortcut(target: ShortcutCreateTarget): Promise<void> {
    return this.mutate({ action: 'create', target })
  }

  setLogin(enabled: boolean): Promise<void> {
    return this.mutate({ action: 'setLogin', enabled })
  }

  private mutate(body: unknown): Promise<void> {
    const operation = this.tail.then(async () => {
      this.commit(await this.request({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
    })
    this.tail = operation.catch(() => { this.fail() })
    return operation
  }

  private async request(init?: RequestInit): Promise<DesktopClientSettings> {
    const response = await this.fetcher(DESKTOP_SETTINGS_PATH, init)
    if (!response.ok) throw new Error(`desktop settings request failed (${String(response.status)})`)
    const value: unknown = await response.json()
    if (!isSettings(value)) throw new Error('desktop settings response is invalid')
    return value
  }

  private commit(value: DesktopClientSettings): void {
    this.snapshot = { status: 'ready', value, writable: true }
    for (const listener of this.listeners) listener()
  }

  private fail(): void {
    this.snapshot = { ...this.snapshot, status: 'error', writable: false }
    for (const listener of this.listeners) listener()
  }
}
