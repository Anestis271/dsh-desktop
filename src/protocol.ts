import type { ResolvedConfig } from './index.js'

/** Parent-to-Electron startup payload sent over the private IPC channel. */
export interface RuntimeInitMessage {
  type: 'init'
  url: string
  profileDir: string
  config: ResolvedConfig
}

/** Parent-to-Electron shutdown request. */
export interface RuntimeShutdownMessage {
  type: 'shutdown'
}

/** Messages accepted by the Electron child. */
export type RuntimeParentMessage = RuntimeInitMessage | RuntimeShutdownMessage

/** Electron child readiness notification. */
export interface RuntimeReadyMessage {
  type: 'ready'
}

/** Electron child notification that another profile-scoped instance owns the UI. */
export interface RuntimeDuplicateMessage {
  type: 'duplicate'
}

/** Electron child startup failure notification. */
export interface RuntimeErrorMessage {
  type: 'error'
  message: string
}

/** Messages accepted by the dsh host. */
export type RuntimeChildMessage = RuntimeReadyMessage | RuntimeDuplicateMessage | RuntimeErrorMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isShortcutSettings(value: unknown): boolean {
  return isRecord(value)
    && typeof value.desktop === 'boolean'
    && typeof value.appMenu === 'boolean'
    && typeof value.login === 'boolean'
}

function isResolvedConfig(value: unknown): value is ResolvedConfig {
  return isRecord(value)
    && typeof value.closeToTray === 'boolean'
    && typeof value.startHidden === 'boolean'
    && typeof value.title === 'string'
    && isShortcutSettings(value.shortcuts)
}

/** Validate an untrusted parent IPC value as the Electron startup payload. */
export function isRuntimeInitMessage(value: unknown): value is RuntimeInitMessage {
  return isRecord(value)
    && value.type === 'init'
    && typeof value.url === 'string'
    && typeof value.profileDir === 'string'
    && isResolvedConfig(value.config)
}

/** Validate an untrusted parent IPC value as a shutdown request. */
export function isRuntimeShutdownMessage(value: unknown): value is RuntimeShutdownMessage {
  return isRecord(value) && value.type === 'shutdown'
}

/** Validate an untrusted Electron IPC value for the dsh host. */
export function isRuntimeChildMessage(value: unknown): value is RuntimeChildMessage {
  if (!isRecord(value)) return false
  if (value.type === 'ready' || value.type === 'duplicate') return true
  return value.type === 'error' && typeof value.message === 'string'
}
