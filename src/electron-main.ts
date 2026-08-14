import type { ElectronApi } from './electron-shell.js'
import { runElectronShell } from './electron-shell.js'

/** Electron-only composition root; the dsh host launches this file in Electron. */
export async function main(load: () => Promise<{ default?: ElectronApi }>, run = runElectronShell): Promise<void> {
  const module = await load()
  const api = module.default
  if (api === undefined) throw new Error('dsh-desktop: Electron API unavailable')
  await run(api)
}

/* v8 ignore start -- this branch only runs inside the Electron executable. */
if (process.versions.electron !== undefined) {
  void main(() => import('electron') as unknown as Promise<{ default: ElectronApi }>)
}
/* v8 ignore stop */
