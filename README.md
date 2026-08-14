# dsh Desktop

`@anestis/dsh-desktop` is a small Electron shell for the official DeepSeek Harness WebUI. It does not replace or re-render the WebUI: dsh starts the Web server, and the plugin opens the supplied URL in one isolated desktop window.

## Install and start

Install the plugin into the `desktop` profile, then start that profile:

```bash
dsh plugin --profile desktop add @anestis/dsh-desktop
dsh --profile desktop
```

For local development, install the repository instead:

```powershell
pnpm run check
dsh plugin --profile desktop add .
dsh --profile desktop
```

The shell adds a tray icon with show/hide, WebUI reload, profile-directory, and quit actions. Its menu follows `locale.preference` from dsh settings (`zh` or `en`) live, without restarting the profile. Closing the window hides it in the tray by default. A profile-scoped single-instance lock prevents two desktop windows from sharing the same dsh profile.

## Creating shortcuts

All optional entry points are disabled by default. Enable them in the official WebUI settings page, or edit the user-level dsh settings file (`~/.dsh/settings.yaml`; on Windows, `C:\Users\<name>\.dsh\settings.yaml`):

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

Shortcut files are written only at user level and carry an ownership marker. Disabling an option removes only the matching entry created by this plugin. Each entry invokes the Node executable and dsh entry point used by the running process with `--profile desktop`; it does not install, copy, or sign a separate application.

## Window behavior

The title-bar overlay keeps each platform's native window controls and reserves a 36 px drag region around them. Its color follows the official WebUI `theme-color` metadata; the plugin does not add or manage WebUI controls.

## Development

```powershell
pnpm run build
pnpm run test:coverage
pnpm pack --dry-run
```

Electron runs as a child process with `contextIsolation`, sandboxing, and disabled Node integration. The only renderer bridge is the bundled `electron-preload.cjs` title-bar helper.
