import { describe, expect, it, vi } from 'vitest'
import { createProcessBridge, createStreamBridge, desktopIconPath, isThemeColor, runElectronShell, titleBarSymbolColor, windowOptions, type BrowserWindowLike, type ElectronApi, type MenuLike, type ProcessBridge, type ProcessLike, type TrayLike, type WindowsAppDetails } from '../src/electron-shell.js'

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
  appUserModelId = ''
  ready = Promise.resolve()

  setName(_name: string): void {}
  setAppUserModelId(id: string): void { this.appUserModelId = id }
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
  loading: Promise<void> = Promise.resolve()
  appDetails: WindowsAppDetails[] = []
  overlay: { color: string; symbolColor: string; height: number }[] = []
  readonly webContents = {
    listeners: [] as Array<(event: unknown, channel: string, ...args: unknown[]) => void>,
    on: (_event: 'ipc-message', listener: (event: unknown, channel: string, ...args: unknown[]) => void): void => {
      this.webContents.listeners.push(listener)
    },
    emit: (channel: string, ...args: unknown[]): void => {
      for (const listener of this.webContents.listeners) listener({}, channel, ...args)
    },
  }

  loadURL(url: string): Promise<void> { this.loaded = url; return this.loading }
  show(): void { this.visible = true; this.calls.push('show') }
  hide(): void { this.visible = false; this.calls.push('hide') }
  focus(): void { this.calls.push('focus') }
  reload(): void { this.calls.push('reload') }
  isVisible(): boolean { return this.visible }
  setTitle(title: string): void { this.title = title }
  setAppDetails(options: WindowsAppDetails): void { this.appDetails.push(options) }
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void { this.overlay.push(options) }
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

function setup(lock = true, loading: Promise<void> = Promise.resolve()): {
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
      constructor(_options: Record<string, unknown>) { super(); this.loading = loading; windows.push(this) }
    },
    Tray: class extends FakeTray {
      constructor(_image: unknown) { super(); trays.push(this) }
    },
    Menu: {
      buildFromTemplate(template) { state.menu = { items: [...template] }; return state.menu }
    },
    nativeImage: { createFromPath: vi.fn(() => ({ icon: true })) },
    shell: { openPath: vi.fn(async () => '') },
  }
  return { api, app, bridge, windows, trays, get menu() { return state.menu } }
}

const init = {
  type: 'init' as const,
  url: 'http://127.0.0.1:3000',
  profileDir: 'C:/profile',
  locale: 'en' as const,
  config: {
    closeToTray: true,
    startHidden: false,
    title: 'dsh Desktop',
    shortcuts: { desktop: false, appMenu: false, login: false },
  },
  relaunch: { executable: 'node.exe', args: ['dsh.js', '--profile', 'desktop'], cwd: 'C:/work' },
}

describe('Electron shell', () => {
  it('creates a window and tray, routes menu actions, and closes to tray', async () => {
    const setupResult = setup()
    const pending = runElectronShell(setupResult.api, setupResult.bridge)
    setupResult.bridge.emit({ type: 'ignored' })
    setupResult.bridge.emit(init)
    setupResult.bridge.emit({ type: 'locale', locale: 'en' })
    await pending

    const window = setupResult.windows[0]
    const tray = setupResult.trays[0]
    expect(window.loaded).toBe(init.url)
    expect(window.visible).toBe(true)
    expect(tray.tooltip).toBe(init.config.title)
    expect(setupResult.bridge.sent).toEqual([{ type: 'ready' }])
    expect(setupResult.app.appUserModelId).toBe('com.anestis.dsh-desktop')
    expect(setupResult.api.nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringMatching(/dsh-desktop\.ico$/))
    expect(window.appDetails).toEqual([{
      appId: 'com.anestis.dsh-desktop',
      appIconPath: expect.stringMatching(/dsh-desktop\.ico$/),
      appIconIndex: 0,
      relaunchCommand: expect.stringMatching(/wscript\.exe.*windows-launcher\.vbs.*node\.exe.*--profile.*desktop/),
      relaunchDisplayNameResource: 'dsh Desktop',
    }])
    window.webContents.emit('dsh-desktop-theme', '#ffffff')
    window.webContents.emit('dsh-desktop-theme', 'url(javascript:bad)')
    expect(window.overlay).toEqual([{ color: '#ffffff', symbolColor: '#111827', height: 36 }])
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
    setupResult.bridge.emit({ type: 'locale', locale: 'zh' })
    expect(setupResult.menu!.items.map(item => item.label)).toEqual([
      '显示 / 隐藏', '重新加载 WebUI', '打开配置文件夹', '退出',
    ])
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
    expect(windowOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#111827', symbolColor: '#ffffff', height: 36 },
    })
    expect(desktopIconPath('win32')).toMatch(/dsh-desktop\.ico$/)
    expect(desktopIconPath('linux')).toMatch(/dsh-desktop\.png$/)
  })

  it('keeps macOS native controls and ignores overlay theme messages', async () => {
    const setupResult = setup()
    const pending = runElectronShell(setupResult.api, setupResult.bridge, 'darwin')
    setupResult.bridge.emit(init)
    await pending
    expect(setupResult.app.appUserModelId).toBe('')
    expect(setupResult.windows[0].appDetails).toEqual([])
    setupResult.windows[0].webContents.emit('dsh-desktop-theme', '#ffffff')
    expect(setupResult.windows[0].overlay).toEqual([])
  })

  it('retains locale updates received before the Tray is ready', async () => {
    const setupResult = setup()
    let resolveReady: () => void = () => {}
    setupResult.app.ready = new Promise<void>(resolve => { resolveReady = resolve })
    const pending = runElectronShell(setupResult.api, setupResult.bridge)
    setupResult.bridge.emit(init)
    await Promise.resolve()
    setupResult.bridge.emit({ type: 'locale', locale: 'zh' })
    resolveReady()
    await pending
    expect(setupResult.menu!.items[0].label).toBe('显示 / 隐藏')
  })

  it('reports load failures unless shutdown already started', async () => {
    const failed = setup(true, Promise.reject(new Error('load failed')))
    const first = runElectronShell(failed.api, failed.bridge)
    failed.bridge.emit(init)
    await expect(first).rejects.toThrow('load failed')

    let rejectLoad: (error: Error) => void = () => {}
    const loading = new Promise<void>((_resolve, reject) => { rejectLoad = reject })
    const stopping = setup(true, loading)
    const second = runElectronShell(stopping.api, stopping.bridge)
    stopping.bridge.emit(init)
    await vi.waitFor(() => { expect(stopping.windows).toHaveLength(1) })
    stopping.bridge.emit({ type: 'shutdown' })
    rejectLoad(new Error('aborted'))
    await expect(second).resolves.toBeUndefined()
  })

  it('validates theme colors and chooses readable symbols', () => {
    expect(isThemeColor('#abc')).toBe(true)
    expect(isThemeColor('rgba(1, 2, 3, .5)')).toBe(true)
    expect(isThemeColor('url(x)')).toBe(false)
    expect(isThemeColor(null)).toBe(false)
    expect(titleBarSymbolColor('#ffffff')).toBe('#111827')
    expect(titleBarSymbolColor('#000000')).toBe('#ffffff')
    expect(titleBarSymbolColor('#abc')).toBe('#111827')
    expect(titleBarSymbolColor('rgb(1, 2, 3)')).toBe('#ffffff')
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

  it('bridges Electron JSON lines over stdin and stdout', async () => {
    let onData: ((chunk: unknown) => void) | undefined
    const input = { on: (_event: 'data', listener: (chunk: unknown) => void) => { onData = listener } }
    const writes: string[] = []
    const output = { on: vi.fn(), write: (chunk: string) => { writes.push(chunk) } }
    const bridge = createStreamBridge(init, input, output)
    const listener = vi.fn()
    const dispose = bridge.onMessage(listener)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith(init)
    onData?.('{"type":"shutdown"}\nnot-json\n\n')
    expect(listener).toHaveBeenCalledWith({ type: 'shutdown' })
    onData?.('{"type":')
    onData?.('"shutdown"}\n')
    expect(listener).toHaveBeenCalledTimes(3)
    bridge.send({ type: 'ready' })
    expect(writes).toEqual(['{"type":"ready"}\n'])
    dispose()
    onData?.('{"type":"shutdown"}\n')
    expect(listener).toHaveBeenCalledTimes(3)

    createStreamBridge(init, input, { on: vi.fn() }).send({ type: 'ready' })
  })
})
