import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants, createWriteStream, existsSync } from 'node:fs'
import { access, chmod, mkdir, rename, rm, symlink } from 'node:fs/promises'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { downloadArtifact } from '@electron/get'
import { Open, type File as ZipFile } from 'unzipper'
import type { ResolvedConfig } from './index.js'
import { isRuntimeChildMessage, type DesktopLocale, type RuntimeInitMessage, type RuntimeParentMessage } from './protocol.js'

/** Values the dsh host passes to the Electron child. */
export interface DesktopLaunchOptions {
  url: string
  profileDir: string
  locale: DesktopLocale
  config: ResolvedConfig
  relaunchCommand: string
}

/** A launched Electron child owned by one dsh plugin fiber. */
export interface DesktopSession {
  /** Whether another Electron instance already owns this profile UI. */
  duplicate: boolean
  /** Update native menu strings without restarting Electron. */
  updateLocale(locale: DesktopLocale): void
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

/** Socket teardown is represented by child exit/startup timeout, never an uncaught event. */
export function ignoreControlSocketError(_error: Error): void {}

interface StreamChild {
  stdin?: { write(chunk: string): unknown }
  stdout?: { on(event: 'data', listener: (chunk: unknown) => void): void }
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000
const ELECTRON_VERSION = '43.4.0'
const UNIX_FILE_TYPE_MASK = 0o170000
const UNIX_DIRECTORY = 0o040000
const UNIX_SYMLINK = 0o120000

/* v8 ignore start -- production download boundaries; tests replace these seams */
const downloadElectron = (platform: NodeJS.Platform, arch: string): Promise<string> => downloadArtifact({
    version: ELECTRON_VERSION,
    artifactName: 'electron',
    platform,
    arch,
  })

interface DeferredSymlink {
  path: string
  target: string
}

function archivePath(destination: string, entryPath: string): string {
  const root = resolve(destination)
  const path = resolve(root, entryPath.replaceAll('\\', '/'))
  const local = relative(root, path)
  if (local === '' || local.startsWith('..') || isAbsolute(local)) {
    throw new Error(`dsh-desktop: unsafe Electron archive path: ${entryPath}`)
  }
  return path
}

function unixMode(entry: ZipFile): number {
  return entry.versionMadeBy >>> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0
}

function safeSymlinkTarget(destination: string, path: string, target: string): string {
  if (target.includes('\0') || isAbsolute(target)) {
    throw new Error(`dsh-desktop: unsafe Electron archive link: ${target}`)
  }
  const root = resolve(destination)
  const resolvedTarget = resolve(dirname(path), target)
  const local = relative(root, resolvedTarget)
  if (local === '' || local.startsWith('..') || isAbsolute(local)) {
    throw new Error(`dsh-desktop: unsafe Electron archive link: ${target}`)
  }
  return target
}

const openElectronArchive = (archive: string) => Open.file(archive)

/** Archive seams kept mutable so Windows tests can verify POSIX metadata. */
export const electronArchiveInternals = {
  open: openElectronArchive,
  chmod,
  symlink,
}

const extractElectron = async (archive: string, destination: string): Promise<void> => {
  const directory = await electronArchiveInternals.open(archive)
  const directories: Array<{ path: string; mode: number }> = []
  const links: DeferredSymlink[] = []
  await mkdir(destination, { recursive: true })

  for (const entry of directory.files) {
    const path = archivePath(destination, entry.path)
    const mode = unixMode(entry)
    const type = mode & UNIX_FILE_TYPE_MASK
    if (entry.type === 'Directory' || type === UNIX_DIRECTORY) {
      await mkdir(path, { recursive: true })
      directories.push({ path, mode: mode & 0o777 })
      continue
    }
    await mkdir(dirname(path), { recursive: true })
    if (type === UNIX_SYMLINK) {
      const target = safeSymlinkTarget(destination, path, (await entry.buffer()).toString('utf8'))
      links.push({ path, target })
      continue
    }
    await pipeline(entry.stream(), createWriteStream(path))
    if ((mode & 0o777) !== 0) await electronArchiveInternals.chmod(path, mode & 0o777)
  }

  for (const link of links) await electronArchiveInternals.symlink(link.target, link.path)
  directories.sort((left, right) => right.path.length - left.path.length)
  for (const directory of directories) {
    if (directory.mode !== 0) await electronArchiveInternals.chmod(directory.path, directory.mode)
  }
}
/* v8 ignore stop */

/** Download seams kept mutable for deterministic artifact tests. */
export const electronInternals = {
  download: downloadElectron,
  extract: extractElectron,
  nonce: randomUUID,
  access,
}

async function usableElectron(executable: string, platform: NodeJS.Platform): Promise<boolean> {
  if (!existsSync(executable)) return false
  if (platform === 'win32') return true
  try {
    await electronInternals.access(executable, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Relative executable location used by Electron release archives. */
export function electronExecutable(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32': return 'electron.exe'
    case 'darwin': return join('Electron.app', 'Contents', 'MacOS', 'Electron')
    case 'linux':
    case 'freebsd':
    case 'openbsd': return 'electron'
    default: throw new Error(`dsh-desktop: Electron is unavailable on ${platform}`)
  }
}

/** Resolve the stable executable location for this plugin's Electron runtime. */
export function electronRuntimePath(
  profileDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return join(
    profileDir,
    'desktop-shell',
    'electron',
    `${ELECTRON_VERSION}-${platform}-${arch}`,
    electronExecutable(platform),
  )
}

/** Resolve or atomically install the one platform runtime used by this profile. */
export async function resolveElectronPath(
  profileDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<string> {
  const relative = electronExecutable(platform)
  const destination = join(profileDir, 'desktop-shell', 'electron', `${ELECTRON_VERSION}-${platform}-${arch}`)
  const executable = electronRuntimePath(profileDir, platform, arch)
  if (await usableElectron(executable, platform)) return executable
  await rm(destination, { recursive: true, force: true })

  await mkdir(dirname(destination), { recursive: true })
  const staging = `${destination}.tmp-${electronInternals.nonce()}`
  try {
    const archive = await electronInternals.download(platform, arch)
    await electronInternals.extract(archive, staging)
    const stagedExecutable = join(staging, relative)
    if (!existsSync(stagedExecutable)) {
      throw new Error('dsh-desktop: downloaded Electron archive has no executable')
    }
    try {
      await rename(staging, destination)
    } catch (error) {
      if (!await usableElectron(executable, platform)) throw error
    }
    return executable
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Production process dependencies. */
export async function productionRuntimeDependencies(profileDir: string): Promise<RuntimeDependencies> {
  return {
    electronPath: await resolveElectronPath(profileDir),
    entryPath: fileURLToPath(new URL('./electron-entry.cjs', import.meta.url)),
    spawnProcess: spawn,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
    openControlServer,
  }
}

/** Production dependency seam for exercising the default launcher path. */
export const runtimeInternals = { productionDependencies: productionRuntimeDependencies }

/** Open a token-authenticated loopback channel for the Electron GUI process. */
export async function openControlServer(): Promise<ControlServer> {
  const token = randomUUID()
  const listeners = new Set<(message: unknown) => void>()
  let client: Socket | undefined
  const server: Server = createServer(socket => {
    let buffer = ''
    let authenticated = false
    socket.on('error', ignoreControlSocketError)
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
  dependencies?: RuntimeDependencies,
): Promise<DesktopSession> {
  const runtime = dependencies ?? await runtimeInternals.productionDependencies(options.profileDir)
  const control = runtime.openControlServer === undefined
    ? undefined
    : await runtime.openControlServer()
  const init: RuntimeInitMessage = { type: 'init', ...options }
  const child = runtime.spawnProcess(runtime.electronPath, [runtime.entryPath], {
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
  const sendToChild = (message: RuntimeParentMessage): void => {
    if (control !== undefined) control.send(message)
    else if (streamChild.stdin !== undefined) streamChild.stdin.write(`${JSON.stringify(message)}\n`)
    else child.send(message)
  }

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
    }, runtime.startupTimeoutMs)

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
    updateLocale(locale): void { sendToChild({ type: 'locale', locale }) },
    async stop(): Promise<void> {
      if (exited) return
      sendToChild({ type: 'shutdown' })
      await Promise.race([exitPromise, delay(runtime.stopTimeoutMs)])
      if (!exited) child.kill()
      await control?.close()
    },
  }
}

/** Structural test helper for process doubles. */
export type ChildProcessHandle = Pick<ChildProcess, 'emit' | 'killed'>
