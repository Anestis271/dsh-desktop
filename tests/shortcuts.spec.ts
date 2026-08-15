import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
      login: join('/Users/Ada', 'Library', 'LaunchAgents', 'com.anestis.dsh-desktop.plist'),
    })
    expect(shortcutPaths('linux', '/home/ada').appMenu).toBe(join('/home/ada', '.local', 'share', 'applications', 'com.anestis.dsh-desktop.desktop'))
  })

  it('serializes freedesktop and launch-agent entries safely', () => {
    const entry = desktopEntry(command)
    expect(entry).toContain('Exec="C:\\\\Program Files\\\\dsh\\\\dsh.exe" "--profile" "desktop" "--title" "A \\\"quoted\\\" title"')
    expect(entry).toContain(`X-dsh-owner=${MARKER}`)
    const agent = launchAgent({ executable: 'tool<&', args: ['a&b'], cwd: '/tmp' })
    expect(agent).toContain('tool&lt;&amp;')
    expect(agent).toContain('a&amp;b')
  })
})

describe('windows shortcut creation', () => {
  it('resolves after PowerShell exits successfully', async () => {
    const child = new ProcessChild()
    spawnMock.mockReturnValue(child)
    const pending = createWindowsShortcut('C:\\Desktop\\dsh.lnk', command)
    child.emit('spawn')
    child.emit('exit', 0)
    await expect(pending).resolves.toBeUndefined()
    expect(spawnMock).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({ windowsHide: true }))
    expect(spawnMock.mock.calls[0]?.[1]).toContain('[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[Console]::OutputEncoding; $s=New-Object -ComObject WScript.Shell; $j=$env:DSH_SHORTCUT_JSON | ConvertFrom-Json; $l=$s.CreateShortcut($j.path); $l.TargetPath=$j.executable; $l.Arguments=$j.arguments; $l.WorkingDirectory=$j.cwd; $l.Description="DeepSeek Harness"; $l.Save()')
  })

  it('reports process errors and non-zero exits including stderr', async () => {
    const errorChild = new ProcessChild()
    spawnMock.mockReturnValue(errorChild)
    const errorPending = createWindowsShortcut('x', command)
    errorChild.emit('error', new Error('powershell unavailable'))
    await expect(errorPending).rejects.toThrow('powershell unavailable')

    const failedChild = new ProcessChild()
    spawnMock.mockReturnValue(failedChild)
    const failedPending = createWindowsShortcut('x', command)
    failedChild.stderr.emit('data', 'access denied')
    failedChild.emit('exit', 1)
    await expect(failedPending).rejects.toThrow('access denied')

    const noStderrChild = new ProcessChild()
    spawnMock.mockReturnValue(noStderrChild)
    const noStderrPending = createWindowsShortcut('x', command)
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
    const pending = reconcileShortcuts({ desktop: true, appMenu: false, login: false }, { platform: 'win32', home: root, command })
    await vi.waitFor(() => { expect(spawnMock).toHaveBeenCalledOnce() })
    child.emit('exit', 0)
    await expect(pending).resolves.toBeUndefined()
  })

  it('propagates unexpected ownership-marker read failures', async () => {
    const root = await home()
    const path = shortcutPaths('linux', root).desktop
    await mkdir(`${path}.dsh-owner`, { recursive: true })
    await expect(reconcileShortcuts({ desktop: false, appMenu: false, login: false }, { platform: 'linux', home: root, command })).rejects.toBeTruthy()
  })
})
