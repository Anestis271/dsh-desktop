import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Canonical launch command stored in user-level shortcuts. */
export interface LaunchCommand {
  executable: string
  args: readonly string[]
  cwd: string
}

/** Existing-instance probe used by console-free Windows launchers. */
export interface WindowsActivation {
  electronPath: string
  entryPath: string
  profileDir: string
}

/** Platform inputs for shortcut reconciliation. */
export interface ShortcutDependencies {
  platform: NodeJS.Platform
  home: string
  command: LaunchCommand
  windowsActivation?: WindowsActivation
  runWindowsShortcut?: (path: string, command: LaunchCommand, activation: WindowsActivation) => Promise<void>
}

/** All files owned by this plugin, including the ownership marker suffix. */
export interface ShortcutPaths {
  desktop: string
  appMenu: string
  login: string
}

export type ShortcutKey = keyof ShortcutPaths
export type ShortcutCreateTarget = Exclude<ShortcutKey, 'login'>

const MARKER = 'dsh-desktop-owned-v1'
const PRODUCT = 'DeepSeek Harness'
const ICON_ICO_PATH = fileURLToPath(new URL('../assets/dsh-desktop.ico', import.meta.url))
const WINDOWS_LAUNCHER_PATH = fileURLToPath(new URL('../assets/windows-launcher.vbs', import.meta.url))

/** Resolve user-level shortcut locations without creating any directories. */
export function shortcutPaths(platform: NodeJS.Platform, home: string = homedir()): ShortcutPaths {
  if (platform === 'win32') {
    return {
      desktop: join(home, 'Desktop', `${PRODUCT}.lnk`),
      appMenu: join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT}.lnk`),
      login: join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${PRODUCT}.lnk`),
    }
  }
  if (platform === 'darwin') {
    return {
      desktop: join(home, 'Desktop', `${PRODUCT}.command`),
      appMenu: join(home, 'Applications', `${PRODUCT}.command`),
      login: join(home, 'Library', 'LaunchAgents', 'com.anestis271.dsh-desktop.plist'),
    }
  }
  return {
    desktop: join(home, 'Desktop', `${PRODUCT}.desktop`),
    appMenu: join(home, '.local', 'share', 'applications', 'com.anestis271.dsh-desktop.desktop'),
    login: join(home, '.config', 'autostart', 'com.anestis271.dsh-desktop.desktop'),
  }
}

function quoteExec(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function quoteWindowsArgument(value: string): string {
  return `"${value.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

/** Pass the launch command to the packaged console-free Windows bridge. */
export function windowsLauncherArguments(command: LaunchCommand, activation: WindowsActivation): string {
  return [
    WINDOWS_LAUNCHER_PATH,
    activation.electronPath,
    activation.entryPath,
    activation.profileDir,
    command.cwd,
    command.executable,
    ...command.args,
  ]
    .map(quoteWindowsArgument)
    .join(' ')
}

function quoteVbs(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Serialize the profile-local script behind the short taskbar relaunch command. */
export function windowsRelaunchScript(command: LaunchCommand, activation: WindowsActivation): string {
  const parameters = command.args.map(quoteWindowsArgument).join(' ')
  const activationCommand = [activation.electronPath, activation.entryPath, activation.profileDir]
    .map(quoteWindowsArgument)
    .join(' ')
  return `Option Explicit\r\nDim fileSystem, runner, shell\r\n`
    + `Set fileSystem = CreateObject("Scripting.FileSystemObject")\r\n`
    + `If fileSystem.FileExists(${quoteVbs(activation.electronPath)}) Then\r\n`
    + `  Set runner = CreateObject("WScript.Shell")\r\n`
    + `  If runner.Run(${quoteVbs(activationCommand)}, 0, True) = 0 Then WScript.Quit 0\r\n`
    + `End If\r\n`
    + `Set shell = CreateObject("Shell.Application")\r\n`
    + `shell.ShellExecute ${quoteVbs(command.executable)}, ${quoteVbs(parameters)}, ${quoteVbs(command.cwd)}, "", 0\r\n`
}

/** Build a short WSH command that Windows can persist on a taskbar button. */
export function windowsScriptHostCommand(
  scriptPath: string,
  systemRoot: string = process.env.SystemRoot ?? 'C:\\Windows',
): string {
  return [join(systemRoot, 'System32', 'wscript.exe'), scriptPath].map(quoteWindowsArgument).join(' ')
}

/** Prepare the platform-specific taskbar relaunch entry without an executable bundle. */
export async function taskbarRelaunchCommand(
  platform: NodeJS.Platform,
  profileDir: string,
  command: LaunchCommand,
  activation: WindowsActivation,
  systemRoot?: string,
): Promise<string> {
  if (platform !== 'win32') return ''
  const scriptPath = join(profileDir, 'desktop-shell', 'relaunch.vbs')
  await ensureParent(scriptPath)
  await writeFile(scriptPath, windowsRelaunchScript(command, activation), { mode: 0o600 })
  return windowsScriptHostCommand(scriptPath, systemRoot)
}

/** Serialize a launch command using freedesktop Exec quoting. */
export function desktopEntry(command: LaunchCommand): string {
  const args = [command.executable, ...command.args].map(quoteExec).join(' ')
  return `[Desktop Entry]\nType=Application\nName=${PRODUCT}\nExec=${args}\nPath=${quoteExec(command.cwd)}\nTerminal=false\nX-dsh-owner=${MARKER}\n`
}

/** Serialize a macOS user-level launch agent. */
export function launchAgent(command: LaunchCommand): string {
  const values = [command.executable, ...command.args]
    .map(value => `<string>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</string>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>com.anestis271.dsh-desktop</string><key>ProgramArguments</key><array>${values}</array><key>WorkingDirectory</key><string>${command.cwd}</string><key>X-dsh-owner</key><string>${MARKER}</string><key>RunAtLoad</key><true/></dict></plist>\n`
}

function markerPath(path: string): string {
  return `${path}.dsh-owner`
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
}

async function writeOwned(path: string, content: string): Promise<void> {
  await ensureParent(path)
  await writeFile(path, content, { mode: 0o755 })
  await writeFile(markerPath(path), MARKER, { mode: 0o600 })
}

async function removeOwned(path: string): Promise<void> {
  try {
    const marker = await readFile(markerPath(path), 'utf8')
    if (marker === MARKER) {
      await rm(path, { force: true })
      await rm(markerPath(path), { force: true })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Create one Windows `.lnk` through the user-level WScript.Shell API. */
export async function createWindowsShortcut(
  path: string,
  command: LaunchCommand,
  activation: WindowsActivation,
): Promise<void> {
  const script = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[Console]::OutputEncoding; '
    + '$s=New-Object -ComObject WScript.Shell; $j=$env:DSH_SHORTCUT_JSON | ConvertFrom-Json; '
    + '$l=$s.CreateShortcut($j.path); $l.TargetPath=(Join-Path $env:SystemRoot "System32\\wscript.exe"); '
    + '$l.Arguments=$j.arguments; $l.WorkingDirectory=$j.cwd; $l.IconLocation=$j.icon; '
    + '$l.Description="DeepSeek Harness"; $l.Save()'
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: {
      ...process.env,
      DSH_SHORTCUT_JSON: JSON.stringify({
        path,
        arguments: windowsLauncherArguments(command, activation),
        cwd: command.cwd,
        icon: `${ICON_ICO_PATH},0`,
      }),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  await new Promise<void>((resolve, reject) => {
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`dsh-desktop: shortcut creation failed${stderr === '' ? '' : `: ${stderr.trim()}`}`))
    })
  })
}

/** Create or remove one plugin-owned user-level entry. */
export async function reconcileShortcut(key: ShortcutKey, enabled: boolean, deps: ShortcutDependencies): Promise<void> {
  const paths = shortcutPaths(deps.platform, deps.home)
  const path = paths[key]
  if (!enabled) {
    await removeOwned(path)
    return
  }
  if (deps.platform === 'win32') {
    if (deps.windowsActivation === undefined) {
      throw new Error('dsh-desktop: Windows shortcut activation metadata is unavailable')
    }
    await ensureParent(path)
    await (deps.runWindowsShortcut ?? createWindowsShortcut)(path, deps.command, deps.windowsActivation)
    await writeFile(markerPath(path), MARKER, { mode: 0o600 })
  } else if (deps.platform === 'darwin' && key === 'login') {
    await writeOwned(path, launchAgent(deps.command))
  } else if (deps.platform === 'darwin') {
    await writeOwned(path, `#!/bin/sh\nexec ${[deps.command.executable, ...deps.command.args].map(quoteExec).join(' ')}\n# ${MARKER}\n`)
  } else {
    await writeOwned(path, desktopEntry(deps.command))
  }
}

export { MARKER }
