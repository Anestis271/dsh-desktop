import { join } from 'node:path'

/** Minimal Electron app surface required by the fast activation entrypoint. */
export interface ActivatorApp {
  setPath(name: 'userData', path: string): void
  requestSingleInstanceLock(data: { profileDir: string }): boolean
  releaseSingleInstanceLock(): void
}

/** Notify an existing profile window without booting a second dsh host. */
export function activateExistingInstance(app: ActivatorApp, profileDir: string): boolean {
  app.setPath('userData', join(profileDir, 'desktop-shell'))
  const ownsLock = app.requestSingleInstanceLock({ profileDir })
  if (!ownsLock) return true
  app.releaseSingleInstanceLock()
  return false
}
