import { describe, expect, it, vi } from 'vitest'
import { activateExistingInstance, type ActivatorApp } from '../src/electron-activator.js'

function app(ownsLock: boolean): ActivatorApp {
  return {
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => ownsLock),
    releaseSingleInstanceLock: vi.fn(),
  }
}

describe('fast Electron activator', () => {
  it('notifies an existing profile instance without taking ownership', () => {
    const api = app(false)
    expect(activateExistingInstance(api, 'C:/profile')).toBe(true)
    expect(api.setPath).toHaveBeenCalledWith('userData', expect.stringMatching(/profile[\\/]desktop-shell$/))
    expect(api.requestSingleInstanceLock).toHaveBeenCalledWith({ profileDir: 'C:/profile' })
    expect(api.releaseSingleInstanceLock).not.toHaveBeenCalled()
  })

  it('releases a newly acquired lock so the launcher can start dsh', () => {
    const api = app(true)
    expect(activateExistingInstance(api, 'C:/profile')).toBe(false)
    expect(api.releaseSingleInstanceLock).toHaveBeenCalledOnce()
  })
})
