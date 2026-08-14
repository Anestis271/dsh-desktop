import { join } from 'node:path'
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
    setPath(name: string, path: string): void
    requestSingleInstanceLock(data: { profileDir: string }): boolean
    whenReady(): Promise<void>
    on(event: string, listener: (...args: never[]) => void): void
    quit(): void
  }
  BrowserWindow: new (options: Record<string, unknown>) => BrowserWindowLike
  Tray: new (image: unknown) => TrayLike
  Menu: { buildFromTemplate(template: readonly MenuItem[]): MenuLike }
  nativeImage: { createFromDataURL(data: string): unknown }
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

const TRAY_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
  + '<rect width="32" height="32" rx="7" fill="#111827"/><path d="M7 20c4-7 14-10 18-3-3 0-5 2-7 5-3 3-8 2-11-2Z" fill="#fff"/>'
  + '</svg>',
)

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
  return { titleBarOverlay: true }
}

/** Run the Electron desktop shell after receiving the dsh host handshake. */
export async function runElectronShell(api: ElectronApi, bridge: ProcessBridge = createProcessBridge()): Promise<void> {
  const init = await waitForInit(bridge)
  api.app.setName(init.config.title)
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

  const icon = api.nativeImage.createFromDataURL(TRAY_ICON)
  window = new api.BrowserWindow({
    ...windowOptions(),
    title: init.config.title,
    show: !init.config.startHidden,
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.setTitle(init.config.title)
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

  await window.loadURL(init.url)
  if (!init.config.startHidden) showWindow()
  bridge.send({ type: 'ready' })
}

export { TRAY_ICON }
