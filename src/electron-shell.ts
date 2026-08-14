import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RuntimeChildMessage, RuntimeParentMessage, RuntimeInitMessage } from './protocol.js'
import { isRuntimeInitMessage, isRuntimeShutdownMessage } from './protocol.js'

/** Minimal event object used by BrowserWindow close handlers. */
export interface CloseEventLike {
  preventDefault(): void
}

/** Native window operations consumed by the shell. */
export interface BrowserWindowLike {
  loadURL(url: string): Promise<void>
  show(): void
  hide(): void
  focus(): void
  reload(): void
  isVisible(): boolean
  setTitle(title: string): void
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void
  webContents: {
    on(event: 'ipc-message', listener: (event: unknown, channel: string, ...args: unknown[]) => void): void
  }
  on(event: string, listener: (...args: never[]) => void): void
}

/** Tray operations consumed by the shell. */
export interface TrayLike {
  setToolTip(title: string): void
  setContextMenu(menu: MenuLike): void
  on(event: string, listener: () => void): void
  destroy(): void
}

/** Menu object returned by Electron. */
export interface MenuLike {}

/** Electron surface required by the shell. */
export interface ElectronApi {
  app: {
    setName(name: string): void
    setAppUserModelId(id: string): void
    setPath(name: string, path: string): void
    requestSingleInstanceLock(data: { profileDir: string }): boolean
    whenReady(): Promise<void>
    on(event: string, listener: (...args: never[]) => void): void
    quit(): void
  }
  BrowserWindow: new (options: Record<string, unknown>) => BrowserWindowLike
  Tray: new (image: unknown) => TrayLike
  Menu: { buildFromTemplate(template: readonly MenuItem[]): MenuLike }
  nativeImage: { createFromPath(path: string): unknown }
  shell: { openPath(path: string): Promise<string> }
}

/** Menu item subset accepted by Electron's buildFromTemplate. */
export interface MenuItem {
  label: string
  click?: () => void
}

/** IPC bridge between the Electron child and its dsh parent. */
export interface ProcessBridge {
  onMessage(listener: (message: unknown) => void): () => void
  send(message: RuntimeChildMessage): void
}

/** Process IPC subset used by the production bridge and its test double. */
export interface ProcessLike {
  on(event: 'message', listener: (message: unknown) => void): void
  off(event: 'message', listener: (message: unknown) => void): void
  send?(message: RuntimeChildMessage): unknown
}

export interface StreamLike {
  on(event: 'data', listener: (chunk: unknown) => void): void
  write?(chunk: string): unknown
}

const PRELOAD_PATH = fileURLToPath(new URL('./electron-preload.cjs', import.meta.url))
const ICON_PNG_PATH = fileURLToPath(new URL('../assets/dsh-desktop.png', import.meta.url))
const ICON_ICO_PATH = fileURLToPath(new URL('../assets/dsh-desktop.ico', import.meta.url))

/** Select the native multi-resolution format where Windows shell surfaces need it. */
export function desktopIconPath(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? ICON_ICO_PATH : ICON_PNG_PATH
}

/** Accept only colors emitted by the official theme metadata presenter. */
export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d%.,\s]+\))$/i.test(value)
}

/** Pick a readable native caption-button glyph color for a known theme color. */
export function titleBarSymbolColor(color: string): string {
  const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1]
  if (hex === undefined) return '#ffffff'
  const normalized = hex.length <= 4
    ? hex.slice(0, 3).split('').map(value => value + value).join('')
    : hex.slice(0, 6)
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return (red * 299 + green * 587 + blue * 114) >= 150_000 ? '#111827' : '#ffffff'
}

export function createProcessBridge(source: ProcessLike = process as unknown as ProcessLike): ProcessBridge {
  return {
    onMessage(listener) {
      const handler = (message: unknown): void => { listener(message) }
      source.on('message', handler)
      return () => { source.off('message', handler) }
    },
    send(message) {
      source.send?.(message)
    },
  }
}

/** JSON-lines bridge used by Electron, whose GUI process does not expose Node IPC. */
export function createStreamBridge(initial: unknown, input: StreamLike, output: StreamLike): ProcessBridge {
  const listeners = new Set<(message: unknown) => void>()
  let buffer = ''
  const emit = (message: unknown): void => { for (const listener of listeners) listener(message) }
  input.on('data', chunk => {
    buffer += String(chunk)
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() as string
    for (const line of lines) {
      if (line.trim() === '') continue
      try { emit(JSON.parse(line)) } catch { /* ignore unrelated console output */ }
    }
  })
  queueMicrotask(() => { emit(initial) })
  return {
    onMessage(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    send(message) {
      output.write?.(`${JSON.stringify(message)}\n`)
    },
  }
}

function waitForInit(bridge: ProcessBridge): Promise<RuntimeInitMessage> {
  return new Promise(resolve => {
    const dispose = bridge.onMessage(message => {
      if (!isRuntimeInitMessage(message)) return
      dispose()
      resolve(message)
    })
  })
}

export function windowOptions(platform: NodeJS.Platform = process.platform): Record<string, unknown> {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } }
  }
  // Electron enables the native caption-button overlay when hidden title-bar
  // mode and the overlay option are specified together.
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111827', symbolColor: '#ffffff', height: 36 },
  }
}

/** Run the Electron desktop shell after receiving the dsh host handshake. */
export async function runElectronShell(
  api: ElectronApi,
  bridge: ProcessBridge = createProcessBridge(),
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const init = await waitForInit(bridge)
  api.app.setName(init.config.title)
  if (platform === 'win32') api.app.setAppUserModelId('com.anestis.dsh-desktop')
  api.app.setPath('userData', join(init.profileDir, 'desktop-shell'))
  if (!api.app.requestSingleInstanceLock({ profileDir: init.profileDir })) {
    bridge.send({ type: 'duplicate' })
    api.app.quit()
    return
  }

  let quitting = false
  let window: BrowserWindowLike | undefined
  let tray: TrayLike | undefined
  const showWindow = (): void => {
    window?.show()
    window?.focus()
  }
  const toggleWindow = (): void => {
    if (window?.isVisible()) window.hide()
    else showWindow()
  }
  const disposeBridge = bridge.onMessage(message => {
    if (!isRuntimeShutdownMessage(message)) return
    quitting = true
    api.app.quit()
  })

  api.app.on('before-quit', () => {
    quitting = true
    disposeBridge()
    tray?.destroy()
  })
  api.app.on('second-instance', () => { showWindow() })
  await api.app.whenReady()

  const icon = api.nativeImage.createFromPath(desktopIconPath(platform))
  window = new api.BrowserWindow({
    ...windowOptions(platform),
    title: init.config.title,
    show: !init.config.startHidden,
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#111827',
    icon,
    webPreferences: {
      preload: PRELOAD_PATH,
      additionalArguments: platform === 'darwin'
        ? ['--dsh-desktop-left-controls']
        : ['--dsh-desktop-right-controls'],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.setTitle(init.config.title)
  window.webContents.on('ipc-message', (_event, channel, ...args) => {
    if (channel !== 'dsh-desktop-theme' || !isThemeColor(args[0]) || platform === 'darwin') return
    window?.setTitleBarOverlay({ color: args[0], symbolColor: titleBarSymbolColor(args[0]), height: 36 })
  })
  window.on('close', (event: CloseEventLike) => {
    if (!quitting && init.config.closeToTray) {
      event.preventDefault()
      window?.hide()
    }
  })
  window.on('closed', () => { window = undefined })

  tray = new api.Tray(icon)
  tray.setToolTip(init.config.title)
  tray.setContextMenu(api.Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    { label: 'Reload WebUI', click: () => { window?.reload() } },
    { label: 'Open profile directory', click: () => { void api.shell.openPath(init.profileDir) } },
    { label: 'Quit', click: () => { quitting = true; api.app.quit() } },
  ]))
  tray.on('click', toggleWindow)
  tray.on('double-click', showWindow)

  const loading = window.loadURL(init.url)
  if (!init.config.startHidden) showWindow()
  bridge.send({ type: 'ready' })
  try {
    await loading
  } catch (error) {
    if (!quitting) throw error
  }
}
