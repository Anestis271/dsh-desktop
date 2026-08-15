import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import {
  MARKER,
  createWindowsShortcut,
  desktopEntry,
  launchAgent,
  reconcileShortcuts,
  shortcutPaths,
  taskbarRelaunchCommand,
  windowsLauncherArguments,
  windowsRelaunchScript,
  windowsScriptHostCommand,
  type LaunchCommand,
} from '../src/shortcuts.js'

class ProcessChild extends EventEmitter {
  stderr = new EventEmitter()
}

const command: LaunchCommand = {
  executable: 'C:\\Program Files\\dsh\\dsh.exe',
  args: ['--profile', 'desktop', '--title', 'A "quoted" title'],
  cwd: 'C:\\Users\\test',
}
const activation = {
  electronPath: 'C:\\profile\\electron.exe',
  entryPath: 'C:\\plugin\\electron-activate.cjs',
  profileDir: 'C:\\profile',
}

let roots: string[] = []
afterEach(async () => {
  spawnMock.mockReset()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('shortcut serialization', () => {
  it('resolves platform-specific user locations', () => {
    expect(shortcutPaths('win32', 'C:\\Users\\Ada').desktop).toContain('Desktop')
    expect(shortcutPaths('darwin', '/Users/Ada')).toEqual({
      desktop: join('/Users/Ada', 'Desktop', 'DeepSeek Harness.command'),
      appMenu: join('/Users/Ada', 'Applications', 'DeepSeek Harness.command'),
      login: join('/Users/Ada', 'Library', 'LaunchAgents', 'com.anestis271.dsh-desktop.plist'),
    })
    expect(shortcutPaths('linux', '/home/ada').appMenu).toBe(join('/home/ada', '.local', 'share', 'applications', 'com.anestis271.dsh-desktop.desktop'))
  })

  it('serializes freedesktop and launch-agent entries safely', () => {
    const entry = desktopEntry(command)
    expect(entry).toContain('Exec="C:\\\\Program Files\\\\dsh\\\\dsh.exe" "--profile" "desktop" "--title" "A \\\"quoted\\\" title"')
    expect(entry).toContain(`X-dsh-owner=${MARKER}`)
    const agent = launchAgent({ executable: 'tool<&', args: ['a&b'], cwd: '/tmp' })
    expect(agent).toContain('tool&lt;&amp;')
    expect(agent).toContain('a&amp;b')
  })

  it('quotes every argument passed through the Windows launcher', () => {
    const argumentsString = windowsLauncherArguments(command, activation)
    expect(argumentsString).toContain('windows-launcher.vbs" "C:\\profile\\electron.exe"')
    expect(argumentsString).toContain('electron-activate.cjs" "C:\\profile" "C:\\Users\\test"')
    expect(argumentsString).toContain('"C:\\Program Files\\dsh\\dsh.exe"')
    expect(argumentsString).toMatch(/"--profile" "desktop" "--title" "A \\"quoted\\" title"$/)
    expect(windowsLauncherArguments({ ...command, cwd: 'C:\\' }, activation)).toContain('"C:\\\\"')
    const script = windowsRelaunchScript(command, activation)
    expect(script).toContain('CreateObject("Shell.Application")')
    expect(script).toContain('runner.Run')
    expect(script).toContain('""A \\""quoted\\"" title""')
    expect(windowsScriptHostCommand('C:\\profile\\relaunch.vbs', 'C:\\Windows')).toBe(
      '"C:\\Windows\\System32\\wscript.exe" "C:\\profile\\relaunch.vbs"',
    )
    const systemRoot = process.env.SystemRoot
    delete process.env.SystemRoot
    try {
      expect(windowsScriptHostCommand('relaunch.vbs')).toMatch(/^"C:\\Windows\\System32\\wscript\.exe" /)
    } finally {
      if (systemRoot !== undefined) process.env.SystemRoot = systemRoot
    }
    if (systemRoot !== undefined) {
      expect(windowsScriptHostCommand('relaunch.vbs')).toContain(systemRoot)
    }
  })

  it('keeps the Windows launcher compatible with shortcuts from older installs', async () => {
    const launcher = await readFile(fileURLToPath(new URL('../assets/windows-launcher.vbs', import.meta.url)), 'utf8')
    expect(launcher).toContain('If WScript.Arguments.Count >= 8 Then')
    expect(launcher).toContain('parameterStart = 2')
    expect(launcher).toContain('parameterStart = 5')
  })

  it('writes a short Windows taskbar relaunch script only on Windows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-taskbar-'))
    roots.push(root)
    const relaunch = await taskbarRelaunchCommand('win32', root, command, activation, 'C:\\Windows')
    expect(relaunch.length).toBeLessThan(260)
    await expect(readFile(join(root, 'desktop-shell', 'relaunch.vbs'), 'utf8')).resolves.toBe(windowsRelaunchScript(command, activation))
    await expect(taskbarRelaunchCommand('linux', root, command, activation)).resolves.toBe('')
  })
})

describe('windows shortcut creation', () => {
  it('resolves after PowerShell exits successfully', async () => {
    const child = new ProcessChild()
    spawnMock.mockReturnValue(child)
    const pending = createWindowsShortcut('C:\\Desktop\\dsh.lnk', command, activation)
    child.emit('spawn')
    child.emit('exit', 0)
    await expect(pending).resolves.toBeUndefined()
    expect(spawnMock).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({ windowsHide: true }))
    const script = (spawnMock.mock.calls[0]?.[1] as string[]).at(-1)
    expect(script).toContain('$l.TargetPath=(Join-Path $env:SystemRoot "System32\\wscript.exe")')
    expect(script).toContain('$l.IconLocation=$j.icon')
    const options = spawnMock.mock.calls[0]?.[2] as { env: Record<string, string> }
    expect(JSON.parse(options.env.DSH_SHORTCUT_JSON as string)).toEqual({
      path: 'C:\\Desktop\\dsh.lnk',
      arguments: windowsLauncherArguments(command, activation),
      cwd: command.cwd,
      icon: expect.stringMatching(/dsh-desktop\.ico,0$/),
    })
  })

  it('reports process errors and non-zero exits including stderr', async () => {
    const errorChild = new ProcessChild()
    spawnMock.mockReturnValue(errorChild)
    const errorPending = createWindowsShortcut('x', command, activation)
    errorChild.emit('error', new Error('powershell unavailable'))
    await expect(errorPending).rejects.toThrow('powershell unavailable')

    const failedChild = new ProcessChild()
    spawnMock.mockReturnValue(failedChild)
    const failedPending = createWindowsShortcut('x', command, activation)
    failedChild.stderr.emit('data', 'access denied')
    failedChild.emit('exit', 1)
    await expect(failedPending).rejects.toThrow('access denied')

    const noStderrChild = new ProcessChild()
    spawnMock.mockReturnValue(noStderrChild)
    const noStderrPending = createWindowsShortcut('x', command, activation)
    noStderrChild.emit('exit', 1)
    await expect(noStderrPending).rejects.toThrow('creation failed')
  })
})

describe('shortcut reconciliation', () => {
  async function home(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'dsh-shortcuts-'))
    roots.push(path)
    return path
  }

  it('creates and removes Linux entries while preserving unowned files', async () => {
    const root = await home()
    const paths = shortcutPaths('linux', root)
    await reconcileShortcuts({ desktop: true, appMenu: true, login: true }, { platform: 'linux', home: root, command })
    await expect(readFile(paths.desktop, 'utf8')).resolves.toContain('[Desktop Entry]')
    await expect(stat(`${paths.desktop}.dsh-owner`)).resolves.toBeTruthy()
    await reconcileShortcuts({ desktop: false, appMenu: false, login: false }, { platform: 'linux', home: root, command })
    await expect(stat(paths.desktop)).rejects.toMatchObject({ code: 'ENOENT' })

    await reconcileShortcuts({ desktop: true, appMenu: false, login: false }, { platform: 'linux', home: root, command })
    await readFile(paths.desktop, 'utf8').then(() => undefined)
    await rm(`${paths.desktop}.dsh-owner`)
    await expect(reconcileShortcuts({ desktop: false, appMenu: false, login: false }, { platform: 'linux', home: root, command })).resolves.toBeUndefined()
    await expect(stat(paths.desktop)).resolves.toBeTruthy()
  })

  it('writes macOS command and launch-agent variants', async () => {
    const root = await home()
    const paths = shortcutPaths('darwin', root)
    await reconcileShortcuts({ desktop: true, appMenu: true, login: true }, { platform: 'darwin', home: root, command })
    await expect(readFile(paths.desktop, 'utf8')).resolves.toContain('#!/bin/sh')
    await expect(readFile(paths.login, 'utf8')).resolves.toContain('<key>RunAtLoad</key>')
  })

  it('creates Windows entries through the injectable runner', async () => {
    const root = await home()
    const calls: string[] = []
    await reconcileShortcuts({ desktop: true, appMenu: true, login: true }, {
      platform: 'win32', home: root, command,
      windowsActivation: activation,
      runWindowsShortcut: async path => {
        await expect(stat(dirname(path))).resolves.toBeTruthy()
        calls.push(path)
        await writeFile(path, '')
      },
    })
    expect(calls).toHaveLength(3)
    await expect(stat(`${shortcutPaths('win32', root).desktop}.dsh-owner`)).resolves.toBeTruthy()
  })

  it('uses the production Windows runner when no override is supplied', async () => {
    const root = await home()
    const paths = shortcutPaths('win32', root)
    const child = new ProcessChild()
    spawnMock.mockReturnValue(child)
    const pending = reconcileShortcuts({ desktop: true, appMenu: false, login: false }, {
      platform: 'win32', home: root, command, windowsActivation: activation,
    })
    await vi.waitFor(() => { expect(spawnMock).toHaveBeenCalledOnce() })
    child.emit('exit', 0)
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects enabled Windows shortcuts without activation metadata', async () => {
    const root = await home()
    await expect(reconcileShortcuts({ desktop: true, appMenu: false, login: false }, {
      platform: 'win32', home: root, command,
    })).rejects.toThrow(/activation metadata/)
  })

  it('propagates unexpected ownership-marker read failures', async () => {
    const root = await home()
    const path = shortcutPaths('linux', root).desktop
    await mkdir(`${path}.dsh-owner`, { recursive: true })
    await expect(reconcileShortcuts({ desktop: false, appMenu: false, login: false }, { platform: 'linux', home: root, command })).rejects.toBeTruthy()
  })
})
