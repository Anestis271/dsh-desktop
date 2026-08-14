import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
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
    entryPath: fileURLToPath(new URL('./electron-main.js', import.meta.url)),
    spawnProcess: spawn,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
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
  const child = dependencies.spawnProcess(dependencies.electronPath, [dependencies.entryPath], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
    env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' },
  })

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
    child.on('message', (message: unknown) => {
      if (!isRuntimeChildMessage(message)) return
      if (message.type === 'error') settle(new Error(`dsh-desktop: ${message.message}`))
      else settle(message.type)
    })
    child.once('spawn', () => {
      const init: RuntimeInitMessage = { type: 'init', ...options }
      child.send(init)
    })
  })

  return {
    duplicate: startup === 'duplicate',
    async stop(): Promise<void> {
      if (exited) return
      child.send({ type: 'shutdown' })
      await Promise.race([exitPromise, delay(dependencies.stopTimeoutMs)])
      if (!exited) child.kill()
    },
  }
}

/** Structural test helper for process doubles. */
export type ChildProcessHandle = Pick<ChildProcess, 'emit' | 'killed'>
