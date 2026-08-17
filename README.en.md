# DeepSeek Harness Desktop

[简体中文](./README.md) | English

[![npm version](https://img.shields.io/npm/v/%40anestis271%2Fdsh-desktop?logo=npm)](https://www.npmjs.com/package/@anestis271/dsh-desktop)
[![npm downloads](https://img.shields.io/npm/dm/%40anestis271%2Fdsh-desktop)](https://www.npmjs.com/package/@anestis271/dsh-desktop)
[![license](https://img.shields.io/badge/license-MIT-2EA44F)](./LICENSE)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555)

Turn the official DeepSeek Harness WebUI into a natural desktop experience.

This is not a separate client and does not require a standalone desktop installer. It is a lightweight dsh plugin that keeps every capability of the official WebUI and adds a clean, native desktop shell around it.

## Preview

![DeepSeek Harness Desktop preview](./docs/images/desktop-preview.png)

## Why This Plugin

- **No separate app installer**: no additional MSI, DMG, or AppImage; install one npm plugin and start dsh.
- **The official WebUI stays the single source of truth**: no copied, forked, or reimplemented interface.
- **Clean by design**: no second business state, account system, or background service.
- **A native desktop feel**: system tray, native window controls, a coordinated title bar, and optional shortcuts.
- **Fast repeated launches**: clicking a shortcut again activates the existing window instead of creating another dsh and WebUI instance.

## Install

Before installing, make sure:

- Node.js satisfies `^22.19.0` or `>=24.0.0`
- pnpm is installed and `pnpm --version` runs successfully in your terminal
- dsh is installed and already runs successfully in your terminal

Then use:

```bash
dsh plugin --profile desktop add @anestis271/dsh-desktop
dsh --profile desktop
```

On the first launch, the plugin downloads and extracts the Electron runtime for the current platform. The download size and duration depend on the platform and network connection. Extraction may continue briefly after the download reaches 100%, so do not interrupt the process. Once setup completes, later launches reuse the Electron cache stored in the profile and start normally without extra setup.

## Desktop Experience

- Close the window to the system tray
- Show or hide the window, reload the WebUI, open the profile directory, or quit from the tray
- Follow dsh's Chinese or English language setting in real time
- Keep native minimize, maximize, and close controls on every platform
- Match the title bar with the WebUI sidebar for a continuous L-shaped visual
- Keep exactly one window and one tray instance for each profile
- Create user-level shortcuts on Windows, macOS, and Linux

## Shortcuts

After starting dsh Desktop, create desktop and application-menu entries as needed under **Settings → General** in the official WebUI. Launch at login is disabled by default and can be enabled in the same place.

Every entry still launches only `dsh --profile desktop`. It does not install another application or require administrator access. Disabling launch at login removes only the entry created by this plugin.

## Design Principle

`dsh-desktop` does only what a desktop shell should do. Sessions, settings, models, tools, and every product interface continue to come from the official DeepSeek Harness WebUI, without creating a parallel client that must be maintained separately.

## License

[MIT](./LICENSE)
