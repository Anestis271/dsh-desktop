import { EventEmitter } from 'node:events'
import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRuntimeChildMessage, isRuntimeInitMessage, isRuntimeShutdownMessage } from '../src/protocol.js'
import { launchDesktop, openControlServer, productionRuntimeDependencies, resolveElectronPath, type DesktopLaunchOptions, type RuntimeDependencies } from '../src/runtime.js'

class FakeChild extends EventEmitter {
  readonly sent: unknown[] = []
  killed = false
  emitExitOnKill = true

  send(message: unknown): void {
    this.sent.push(message)
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown' && this.emitExitOnKill) {
      this.emit('exit', 0, null)
    }
  }

  kill(): boolean {
    this.killed = true
    if (this.emitExitOnKill) this.emit('exit', null, 'SIGTERM')
    return true
  }
}

class StreamChild extends FakeChild {
  readonly streamWrites: string[] = []
  readonly stdout = new EventEmitter()
  readonly stdin = {
    write: (chunk: string): void => {
      this.streamWrites.push(chunk)
      if (chunk.includes('shutdown') && this.emitExitOnKill) this.emit('exit', 0, null)
    },
  }
}

const config = {
  closeToTray: true,
  startHidden: false,
  title: 'dsh',
  shortcuts: { desktop: false, appMenu: false, login: false },
} as const

const options: DesktopLaunchOptions = {
  url: 'http://127.0.0.1:3080',
  profileDir: 'C:/profile',
  config,
}

function dependencies(child: FakeChild): RuntimeDependencies {
  return {
    electronPath: 'electron.exe',
    entryPath: 'electron-main.js',
    spawnProcess: (() => child) as unknown as RuntimeDependencies['spawnProcess'],
    startupTimeoutMs: 100,
    stopTimeoutMs: 100,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('runtime protocol guards', () => {
  it('accepts complete init and shutdown messages', () => {
    expect(isRuntimeInitMessage({ type: 'init', ...options })).toBe(true)
    expect(isRuntimeShutdownMessage({ type: 'shutdown' })).toBe(true)
    expect(isRuntimeChildMessage({ type: 'ready' })).toBe(true)
    expect(isRuntimeChildMessage({ type: 'duplicate' })).toBe(true)
    expect(isRuntimeChildMessage({ type: 'error', message: 'failed' })).toBe(true)
  })

  it('rejects malformed or incomplete messages', () => {
    expect(isRuntimeInitMessage(null)).toBe(false)
    expect(isRuntimeInitMessage({ type: 'init', ...options, url: 1 })).toBe(false)
    expect(isRuntimeInitMessage({ type: 'init', ...options, config: { ...config, shortcuts: {} } })).toBe(false)
    expect(isRuntimeShutdownMessage({ type: 'shutdown', extra: true })).toBe(true)
    expect(isRuntimeShutdownMessage({ type: 'stop' })).toBe(false)
    expect(isRuntimeChildMessage({ type: 'error', message: 1 })).toBe(false)
    expect(isRuntimeChildMessage({ type: 'unknown' })).toBe(false)
    expect(isRuntimeChildMessage(null)).toBe(false)
  })
})

describe('runtime launcher', () => {
  it('resolves a valid electron executable and rejects invalid package exports', () => {
    expect(resolveElectronPath(() => 'electron.exe')).toBe('electron.exe')
    expect(() => resolveElectronPath(() => '')).toThrow(/did not resolve/)
    expect(() => resolveElectronPath(() => undefined)).toThrow(/did not resolve/)
    const production = productionRuntimeDependencies()
    expect(production.electronPath).toContain('electron')
    expect(production.entryPath).toContain('electron-entry.cjs')
  })

  it('starts on ready and stops through the child IPC channel', async () => {
    const child = new FakeChild()
    const pending = launchDesktop(options, dependencies(child))
    child.emit('spawn')
    child.emit('message', { type: 'ready' })
    const session = await pending
    expect(session.duplicate).toBe(false)
    expect(child.sent[0]).toEqual({ type: 'init', ...options })
    await session.stop()
    expect(child.sent.at(-1)).toEqual({ type: 'shutdown' })
    expect(child.killed).toBe(false)
  })

  it('uses JSON-line streams with a real Electron-style child', async () => {
    const child = new StreamChild()
    const pending = launchDesktop(options, dependencies(child))
    child.emit('spawn')
    child.stdout.emit('data', '\nElectron console output\nnot-json\n{"type":"ignored"}\n{"type":"ready"}\n')
    const session = await pending
    expect(child.sent).toEqual([])
    await session.stop()
    expect(child.streamWrites).toEqual(['{"type":"shutdown"}\n'])
  })

  it('uses the authenticated control channel when available', async () => {
    const child = new FakeChild()
    const listeners = new Set<(message: unknown) => void>()
    const close = vi.fn(async () => {})
    const send = vi.fn((message: unknown) => {
      if (isRuntimeShutdownMessage(message)) child.emit('exit', 0, null)
    })
    const control = {
      descriptor: '{"port":1,"token":"test"}',
      onMessage: (listener: (message: unknown) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      send,
      close,
    }
    let spawnOptions: { env?: NodeJS.ProcessEnv } | undefined
    const deps: RuntimeDependencies = {
      ...dependencies(child),
      openControlServer: async () => control,
      spawnProcess: ((_executable: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawnOptions = options
        return child
      }) as unknown as RuntimeDependencies['spawnProcess'],
    }
    const pending = launchDesktop(options, deps)
    await vi.waitFor(() => { expect(spawnOptions).toBeDefined() })
    child.emit('spawn')
    for (const listener of listeners) listener({ type: 'ready' })
    const session = await pending
    expect(child.sent).toEqual([])
    expect(JSON.parse(spawnOptions?.env?.DSH_DESKTOP_INIT ?? '{}')).toEqual({ type: 'init', ...options })
    expect(spawnOptions?.env?.DSH_DESKTOP_CONTROL).toBe(control.descriptor)
    await session.stop()
    expect(send).toHaveBeenCalledWith({ type: 'shutdown' })
    expect(close).toHaveBeenCalled()
  })

  it('reports duplicate ownership without treating it as a startup failure', async () => {
    const child = new FakeChild()
    const pending = launchDesktop(options, dependencies(child))
    child.emit('spawn')
    child.emit('message', { type: 'duplicate' })
    const session = await pending
    expect(session.duplicate).toBe(true)
    await session.stop()
  })

  it('rejects child errors, error messages, and early exits', async () => {
    const errorChild = new FakeChild()
    const errorPending = launchDesktop(options, dependencies(errorChild))
    errorChild.emit('spawn')
    errorChild.emit('error', new Error('spawn failed'))
    await expect(errorPending).rejects.toThrow('spawn failed')

    const messageChild = new FakeChild()
    const messagePending = launchDesktop(options, dependencies(messageChild))
    messageChild.emit('spawn')
    messageChild.emit('message', { type: 'error', message: 'window failed' })
    await expect(messagePending).rejects.toThrow('window failed')

    const exitChild = new FakeChild()
    const exitPending = launchDesktop(options, dependencies(exitChild))
    exitChild.emit('spawn')
    exitChild.emit('exit', 1, null)
    await expect(exitPending).rejects.toThrow('exited before')
  })

  it('ignores unknown messages and kills a child that exceeds stop timeout', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.emitExitOnKill = false
    const pending = launchDesktop(options, { ...dependencies(child), stopTimeoutMs: 10 })
    child.emit('spawn')
    child.emit('message', { type: 'ignored' })
    child.emit('message', { type: 'ready' })
    const session = await pending
    const stopping = session.stop()
    await vi.advanceTimersByTimeAsync(10)
    await stopping
    expect(child.killed).toBe(true)
  })

  it('times out startup and can stop after an external exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.emitExitOnKill = false
    const pending = launchDesktop(options, { ...dependencies(child), startupTimeoutMs: 10 })
    child.emit('spawn')
    const rejection = expect(pending).rejects.toThrow('startup timed out')
    await vi.advanceTimersByTimeAsync(10)
    await rejection

    const exitedChild = new FakeChild()
    const second = launchDesktop(options, dependencies(exitedChild))
    exitedChild.emit('spawn')
    exitedChild.emit('message', { type: 'ready' })
    const session = await second
    exitedChild.emit('exit', 0, null)
    await session.stop()
    expect(exitedChild.sent).toHaveLength(1)
  })
})

describe('loopback control server', () => {
  it('authenticates a client and exchanges JSON lines', async () => {
    const server = await openControlServer()
    server.send({ type: 'ignored-before-auth' })
    const descriptor = JSON.parse(server.descriptor) as { port: number; token: string }

    const rejected = connect(descriptor.port, '127.0.0.1')
    await new Promise<void>(resolve => { rejected.once('connect', () => { rejected.write('not-json\n{"token":"wrong"}\n'); resolve() }) })
    await new Promise(resolve => rejected.once('close', resolve))

    const client = connect(descriptor.port, '127.0.0.1')
    await new Promise<void>(resolve => { client.once('connect', resolve) })
    const listener = vi.fn()
    const dispose = server.onMessage(listener)
    client.write(`\n{"token":"${descriptor.token}"}\n`)
    client.write('{"type":"rea')
    client.write('dy"}\n')
    await vi.waitFor(() => { expect(listener).toHaveBeenCalledWith({ type: 'ready' }) })
    dispose()
    client.write('{"type":"duplicate"}\n')
    const received = new Promise<string>(resolve => { client.once('data', chunk => { resolve(String(chunk)) }) })
    server.send({ type: 'shutdown' })
    await expect(received).resolves.toContain('shutdown')
    await server.close()
  })

  it('closes cleanly before a client connects', async () => {
    const server = await openControlServer()
    await expect(server.close()).resolves.toBeUndefined()
  })
})
