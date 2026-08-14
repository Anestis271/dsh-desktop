import { describe, expect, it, vi } from 'vitest'
import { createProcessBridge, runElectronShell, TRAY_ICON, windowOptions, type BrowserWindowLike, type ElectronApi, type MenuLike, type ProcessBridge, type ProcessLike, type TrayLike } from '../src/electron-shell.js'

class FakeBridge implements ProcessBridge {
  private readonly listeners = new Set<(message: unknown) => void>()
  readonly sent: unknown[] = []

  onMessage(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  send(message: unknown): void {
    this.sent.push(message)
  }

  emit(message: unknown): void {
    for (const listener of [...this.listeners]) listener(message)
  }
}

class FakeApp {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly paths: string[] = []
  lock = true
  quitCount = 0
  ready = Promise.resolve()

  setName(_name: string): void {}
  setPath(name: string, path: string): void { this.paths.push(`${name}:${path}`) }
  requestSingleInstanceLock(_data: { profileDir: string }): boolean { return this.lock }
  whenReady(): Promise<void> { return this.ready }
  on(event: string, listener: (...args: never[]) => void): void { this.events.set(event, listener) }
  quit(): void { this.quitCount++ }
  emit(event: string, ...args: never[]): void { this.events.get(event)?.(...args) }
}

class FakeWindow implements BrowserWindowLike {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly calls: string[] = []
  visible = false
  loaded = ''
  title = ''

  async loadURL(url: string): Promise<void> { this.loaded = url }
  show(): void { this.visible = true; this.calls.push('show') }
  hide(): void { this.visible = false; this.calls.push('hide') }
  focus(): void { this.calls.push('focus') }
  reload(): void { this.calls.push('reload') }
  isVisible(): boolean { return this.visible }
  setTitle(title: string): void { this.title = title }
  on(event: string, listener: (...args: never[]) => void): void { this.events.set(event, listener) }
  emit(event: string, ...args: never[]): void { this.events.get(event)?.(...args) }
}

class FakeTray implements TrayLike {
  readonly events = new Map<string, () => void>()
  menu: MenuLike | undefined
  destroyed = false
  tooltip = ''

  setToolTip(title: string): void { this.tooltip = title }
  setContextMenu(menu: MenuLike): void { this.menu = menu }
  on(event: string, listener: () => void): void { this.events.set(event, listener) }
  destroy(): void { this.destroyed = true }
  emit(event: string): void { this.events.get(event)?.() }
}

function setup(lock = true): {
  api: ElectronApi
  app: FakeApp
  bridge: FakeBridge
  windows: FakeWindow[]
  trays: FakeTray[]
  menu: { items: Array<{ label: string; click?: () => void }> } | undefined
} {
  const app = new FakeApp()
  app.lock = lock
  const bridge = new FakeBridge()
  const windows: FakeWindow[] = []
  const trays: FakeTray[] = []
  const state: { menu?: { items: Array<{ label: string; click?: () => void }> } } = {}
  const api: ElectronApi = {
    app,
    BrowserWindow: class extends FakeWindow {
      constructor(_options: Record<string, unknown>) { super(); windows.push(this) }
    },
    Tray: class extends FakeTray {
      constructor(_image: unknown) { super(); trays.push(this) }
    },
    Menu: {
      buildFromTemplate(template) { state.menu = { items: [...template] }; return state.menu }
    },
    nativeImage: { createFromDataURL: vi.fn(() => ({ icon: true })) },
    shell: { openPath: vi.fn(async () => '') },
  }
  return { api, app, bridge, windows, trays, get menu() { return state.menu } }
}

const init = {
  type: 'init' as const,
  url: 'http://127.0.0.1:3000',
  profileDir: 'C:/profile',
  config: {
    closeToTray: true,
    startHidden: false,
    title: 'dsh Desktop',
    shortcuts: { desktop: false, appMenu: false, login: false },
  },
}

describe('Electron shell', () => {
  it('creates a window and tray, routes menu actions, and closes to tray', async () => {
    const setupResult = setup()
    const pending = runElectronShell(setupResult.api, setupResult.bridge)
    setupResult.bridge.emit({ type: 'ignored' })
    setupResult.bridge.emit(init)
    await pending

    const window = setupResult.windows[0]
    const tray = setupResult.trays[0]
    expect(window.loaded).toBe(init.url)
    expect(window.visible).toBe(true)
    expect(tray.tooltip).toBe(init.config.title)
    expect(setupResult.bridge.sent).toEqual([{ type: 'ready' }])
    expect(TRAY_ICON).toContain('data:image/svg+xml')
    setupResult.bridge.emit({ type: 'ignored' })

    tray.emit('click')
    expect(window.visible).toBe(false)
    tray.emit('click')
    expect(window.visible).toBe(true)
    tray.emit('click')
    tray.emit('double-click')
    expect(window.visible).toBe(true)
    window.emit('close', { preventDefault: vi.fn() })
    expect(window.calls).toContain('hide')

    const items = setupResult.menu!.items
    items.find(item => item.label === 'Reload WebUI')!.click!()
    expect(window.calls).toContain('reload')
    items.find(item => item.label === 'Open profile directory')!.click!()
    items.find(item => item.label === 'Quit')!.click!()
    expect(setupResult.app.quitCount).toBe(1)
    setupResult.app.emit('before-quit')
    expect(tray.destroyed).toBe(true)
    setupResult.app.emit('second-instance')
    expect(window.calls.at(-1)).toBe('focus')
  })

  it('supports hidden startup and a normal close when close-to-tray is disabled', async () => {
    const setupResult = setup()
    const pending = runElectronShell(setupResult.api, setupResult.bridge)
    setupResult.bridge.emit({ ...init, config: { ...init.config, startHidden: true, closeToTray: false } })
    await pending
    const window = setupResult.windows[0]
    expect(window.visible).toBe(false)
    const preventDefault = vi.fn()
    window.emit('close', { preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    window.emit('closed')
    setupResult.bridge.emit({ type: 'shutdown' })
    expect(setupResult.app.quitCount).toBe(1)
  })

  it('reports a duplicate profile instance and quits the extra child', async () => {
    const setupResult = setup(false)
    const pending = runElectronShell(setupResult.api, setupResult.bridge)
    setupResult.bridge.emit(init)
    await pending
    expect(setupResult.bridge.sent).toEqual([{ type: 'duplicate' }])
    expect(setupResult.app.quitCount).toBe(1)
    expect(setupResult.windows).toHaveLength(0)
  })

  it('selects the macOS inset title bar options', () => {
    expect(windowOptions('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } })
    expect(windowOptions('win32')).toEqual({ titleBarOverlay: true })
  })

  it('creates a process bridge that forwards and disposes process IPC listeners', () => {
    const listeners = new Set<(message: unknown) => void>()
    const source: ProcessLike = {
      on: (_event, listener) => { listeners.add(listener) },
      off: (_event, listener) => { listeners.delete(listener) },
      send: vi.fn(),
    }
    const bridge = createProcessBridge(source)
    const listener = vi.fn()
    const dispose = bridge.onMessage(listener)
    for (const current of listeners) current({ type: 'ready' })
    expect(listener).toHaveBeenCalledWith({ type: 'ready' })
    bridge.send({ type: 'ready' })
    expect(source.send).toHaveBeenCalledWith({ type: 'ready' })
    dispose()
    for (const current of listeners) current({ type: 'duplicate' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
