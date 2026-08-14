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

## Settings

All optional entry points are disabled by default. Add a `desktop` settings section through dsh's settings UI or profile settings:

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

Shortcut files are written only at user level and carry an ownership marker. Disabling a setting removes only entries created by this plugin. Launch targets invoke the active dsh CLI with `--profile desktop`.

The title-bar overlay keeps each platform's native window controls and reserves a 36 px drag region around them. Its color follows the official WebUI `theme-color` metadata; the plugin does not add or manage WebUI controls.

## Development

```powershell
pnpm run build
pnpm run test:coverage
pnpm pack --dry-run
```

Electron runs as a child process with `contextIsolation`, sandboxing, and disabled Node integration. The only renderer bridge is the bundled `electron-preload.cjs` title-bar helper.
