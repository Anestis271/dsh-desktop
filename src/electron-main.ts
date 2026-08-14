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
  void main(async () => {
    const electron = await import('electron') as unknown as { default?: ElectronApi }
    return { default: electron.default ?? electron as unknown as ElectronApi }
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`dsh-desktop: ${message}`)
    process.send?.({ type: 'error', message })
    process.exit(1)
  })
}
/* v8 ignore stop */
