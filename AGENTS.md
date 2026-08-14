# Repository Guidelines

## Project Structure

This repository currently contains the design documentation for `@anestis/dsh-desktop`, a dsh desktop-shell plugin. Keep proposal and architecture material in `docs/`; the primary document is [`docs/DSH_DESKTOP_PLUGIN_PROPOSAL.md`](docs/DSH_DESKTOP_PLUGIN_PROPOSAL.md). When implementation begins, place runtime code under a focused `src/` tree, platform adapters under `src/platform/`, bundled icons under `assets/`, and automated checks under `tests/`. Keep generated build output and dependency folders out of Git.

## Build, Test, and Development Commands

The repository is documentation-only at present, so no package build or test script exists yet. Before submitting documentation changes, run:

```powershell
git diff --check
git status --short
```

When the npm package is introduced, document its canonical commands here (for example, `npm run build`, `npm test`, and a three-platform smoke test). The required product smoke test must cover installation with `dsh plugin --profile desktop add @anestis/dsh-desktop` followed by `dsh --profile desktop`.

## Coding and Documentation Style

Use Markdown headings, short paragraphs, and fenced code blocks for commands or configuration. Use one physical line per paragraph where practical. Name files in `kebab-case`; use `.ts`/ESM for implementation unless dsh’s published contract requires another format. Prefer explicit platform adapters over scattered `process.platform` branches. Keep public APIs typed, small, and documented. Run the repository’s formatter/linter once implementation tooling exists.

## Testing Guidelines

Add tests beside the owning module in `tests/` and use descriptive names such as `tray-lifecycle.spec.ts` or `shortcut-reconcile.spec.ts`. Cover lifecycle cleanup, WebUI-origin validation, single-instance behavior, native title-bar controls, tray actions, and default-off shortcut settings. CI should exercise Windows, macOS, and Linux; verify that shortcuts invoke exactly `dsh --profile desktop`.

## Commit and Pull Request Guidelines

Use concise imperative Conventional Commit-style subjects, such as `docs: clarify desktop plugin integration` or `feat: add tray lifecycle`. Keep commits focused. Pull requests should explain the user-visible behavior, identify platform-specific changes, include test commands and results, and attach screenshots or recordings for title-bar, tray, or shortcut UI changes. Do not commit credentials, generated binaries, or platform-specific user data.

## Security and Configuration

Never embed WebUI tokens in URLs, logs, or shortcuts. Preserve Electron isolation (`contextIsolation`, sandboxing, and disabled Node integration) and allow navigation only to dsh-provided origins. Store window state and settings in the profile scope, not global files.
