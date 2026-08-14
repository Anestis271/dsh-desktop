import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { ResolvedConfig } from './index.js'
import { isRuntimeChildMessage, type RuntimeInitMessage } from './protocol.js'

/** Values the dsh host passes to the Electron child. */
export interface DesktopLaunchOptions {
  url: string
  profileDir: string
  config: ResolvedConfig
}

/** A launched Electron child owned by one dsh plugin fiber. */
export interface DesktopSession {
  /** Whether another Electron instance already owns this profile UI. */
  duplicate: boolean
  /** Ask the child to quit and bound its shutdown. */
  stop(): Promise<void>
}

/** Injectable process operations used by the runtime launcher. */
export interface RuntimeDependencies {
  electronPath: string
  entryPath: string
  spawnProcess: typeof spawn
  startupTimeoutMs: number
  stopTimeoutMs: number
  openControlServer?: () => Promise<ControlServer>
}

export interface ControlServer {
  descriptor: string
  onMessage(listener: (message: unknown) => void): () => void
  send(message: unknown): void
  close(): Promise<void>
}

interface StreamChild {
  stdin?: { write(chunk: string): unknown }
  stdout?: { on(event: 'data', listener: (chunk: unknown) => void): void }
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000

/** Resolve the installed Electron executable without importing its renderer APIs into dsh. */
export function resolveElectronPath(requireModule: NodeJS.Require = createRequire(import.meta.url)): string {
  const value: unknown = requireModule('electron')
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('dsh-desktop: electron package did not resolve to an executable')
  }
  return value
}

/** Production process dependencies. */
export function productionRuntimeDependencies(): RuntimeDependencies {
  return {
    electronPath: resolveElectronPath(),
    entryPath: fileURLToPath(new URL('./electron-entry.cjs', import.meta.url)),
    spawnProcess: spawn,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
    openControlServer,
  }
}

/** Open a token-authenticated loopback channel for the Electron GUI process. */
export async function openControlServer(): Promise<ControlServer> {
  const token = randomUUID()
  const listeners = new Set<(message: unknown) => void>()
  let client: Socket | undefined
  const server: Server = createServer(socket => {
    let buffer = ''
    let authenticated = false
    socket.on('data', chunk => {
      buffer += String(chunk)
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() as string
      for (const line of lines) {
        if (line.trim() === '') continue
        let message: unknown
        try { message = JSON.parse(line) } catch { continue }
        if (!authenticated) {
          if (typeof message === 'object' && message !== null && 'token' in message && message.token === token) {
            authenticated = true
            client = socket
          } else socket.destroy()
          continue
        }
        for (const listener of listeners) listener(message)
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    descriptor: JSON.stringify({ port: address.port, token }),
    onMessage(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    send(message) { client?.write(`${JSON.stringify(message)}\n`) },
    close: () => new Promise(resolve => {
      client?.destroy()
      server.close(() => { resolve() })
    }),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Launch the Electron child and wait for a validated readiness result. */
export async function launchDesktop(
  options: DesktopLaunchOptions,
  dependencies: RuntimeDependencies = productionRuntimeDependencies(),
): Promise<DesktopSession> {
  const control = dependencies.openControlServer === undefined
    ? undefined
    : await dependencies.openControlServer()
  const init: RuntimeInitMessage = { type: 'init', ...options }
  const child = dependencies.spawnProcess(dependencies.electronPath, [dependencies.entryPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      DSH_DESKTOP_INIT: JSON.stringify(init),
      ...(control === undefined ? {} : { DSH_DESKTOP_CONTROL: control.descriptor }),
    },
  })
  const streamChild = child as typeof child & StreamChild

  let exited = false
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true
      resolve()
    })
  })

  const startup = await new Promise<'ready' | 'duplicate'>((resolve, reject) => {
    let settled = false
    const settle = (result: 'ready' | 'duplicate' | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      settle(new Error('dsh-desktop: Electron startup timed out'))
    }, dependencies.startupTimeoutMs)

    child.once('error', error => { settle(error) })
    void exitPromise.then(() => {
      settle(new Error('dsh-desktop: Electron exited before becoming ready'))
    })
    const handleMessage = (message: unknown): void => {
      if (!isRuntimeChildMessage(message)) return
      if (message.type === 'error') settle(new Error(`dsh-desktop: ${message.message}`))
      else settle(message.type)
    }
    child.on('message', handleMessage)
    control?.onMessage(handleMessage)
    streamChild.stdout?.on('data', chunk => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim() === '') continue
        try { handleMessage(JSON.parse(line)) } catch { /* ignore console output */ }
      }
    })
    child.once('spawn', () => {
      if (control === undefined && streamChild.stdin === undefined) {
        child.send(init)
      }
    })
  })

  return {
    duplicate: startup === 'duplicate',
    async stop(): Promise<void> {
      if (exited) return
      if (control !== undefined) control.send({ type: 'shutdown' })
      else if (streamChild.stdin !== undefined) streamChild.stdin.write('{"type":"shutdown"}\n')
      else child.send({ type: 'shutdown' })
      await Promise.race([exitPromise, delay(dependencies.stopTimeoutMs)])
      if (!exited) child.kill()
      await control?.close()
    },
  }
}

/** Structural test helper for process doubles. */
export type ChildProcessHandle = Pick<ChildProcess, 'emit' | 'killed'>
