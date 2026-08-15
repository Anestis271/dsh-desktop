# dsh Desktop

`@anestis271/dsh-desktop` is a small Electron shell for the official DeepSeek Harness WebUI. It does not replace or re-render the WebUI: dsh starts the Web server, and the plugin opens the supplied URL in one isolated desktop window.

## Install and start

Install the plugin into the `desktop` profile, then start that profile:

```bash
dsh plugin --profile desktop add @anestis271/dsh-desktop
dsh --profile desktop
```

For local development, install the packed artifact so module resolution matches an npm install:

```powershell
pnpm run check
$package = pnpm pack --pack-destination $env:TEMP | Select-Object -Last 1
dsh plugin --profile desktop add $package
dsh --profile desktop
```

Do not use `add .` for runtime verification: pnpm links the checkout, so Node can resolve dsh peers from the repository's development `node_modules` instead of the host fallback.

The shell adds a tray icon with show/hide, WebUI reload, profile-directory, and quit actions. Its menu follows `locale.preference` from dsh settings (`zh` or `en`) live, without restarting the profile. Closing the window hides it in the tray by default. A profile-scoped single-instance lock prevents two desktop windows from sharing the same dsh profile.

On first start, the plugin downloads the pinned Electron runtime for the current OS and architecture, verifies it through Electron's official artifact client, and caches it under the `desktop` profile. Later starts reuse that runtime; the npm install itself runs no dependency build scripts.

## Creating shortcuts

All optional entry points are disabled by default. Open **Settings → General → Desktop shortcuts** in the official WebUI and use the three live switches, or edit the user-level dsh settings file (`~/.dsh/settings.yaml`; on Windows, `C:\Users\<name>\.dsh\settings.yaml`):

```yaml
desktop:
  closeToTray: true
  startHidden: false
  title: DeepSeek Harness
  shortcuts:
    desktop: true
    appMenu: true
    login: false
```

The settings are applied live. `desktop` creates a Desktop icon, `appMenu` creates a Windows Start Menu, macOS Applications, or Linux application-menu entry, and `login` creates a per-user startup entry. On Windows, for example, setting `desktop: true` creates `Desktop\DeepSeek Harness.lnk`; double-click it to run the same operation as `dsh --profile desktop`.

Shortcut files are written only at user level and carry an ownership marker. Disabling an option removes only the matching entry created by this plugin. Each entry invokes the Node executable and dsh entry point used by the running process with `--profile desktop`; it does not install, copy, or sign a separate application. Windows entries use the packaged multi-resolution icon and a `wscript.exe` bridge that launches the same command with its console window hidden. When that profile is already open, the bridge first runs a short-lived Electron activation probe; the existing window is shown through Electron's profile-scoped single-instance lock without booting a second dsh host. If no instance exists, the probe releases the lock and the bridge follows the normal dsh startup path.

The `desktop` namespace remains owned and persisted by dsh's settings provider. Because dsh `0.1.0-rc.6` does not expose third-party namespaces through `settings.describe`, the General-settings contribution uses one guarded same-origin route on the existing dsh Web server. The route accepts only the three shortcut booleans, binds to the active loopback authority, and is removed with the plugin lifecycle; it does not start another server.

## Window behavior

The title-bar overlay keeps each platform's native window controls and reserves a 36 px drag region between the live sidebar edge and the native caption buttons. Its color follows the official WebUI `theme-color` metadata; the plugin does not add or manage WebUI controls.

On Windows, the running window publishes an explicit taskbar identity with the packaged icon and a short profile-local `relaunch.vbs` command that activates the existing profile or starts `dsh --profile desktop` without a console. Pinning the running window therefore preserves the DeepSeek Harness name, icon, and profile entry point instead of pinning the bare Electron runtime.

## Development

```powershell
pnpm run build
pnpm run test:coverage
pnpm pack --dry-run
```

Electron runs as a child process with `contextIsolation`, sandboxing, and disabled Node integration. The only renderer bridge is the bundled `electron-preload.cjs` title-bar helper.
