import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const webPatchUrl = import.meta.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml')
const outputUrl = new URL('../cordis.patch.yml', import.meta.url)
const webPatch = await readFile(fileURLToPath(webPatchUrl), 'utf8')

const desktopPatch = `

# Desktop profile overrides: use an ephemeral loopback port, keep browser URL
# logging quiet, then mount the desktop shell after the Web server is ready.
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 0

- id: web-runtime
  name: '@deepseek-ai/dsh-web-app'
  inject: [webStartup]
  config:
    printUrl: false
    surfaceContext: true
    trustedHosts: !!js ctx.webStartup.trustedHosts

- insert:
    - id: desktop
      name: '@anestis/dsh-desktop'
      inject: [webServer, settings]
`

await writeFile(fileURLToPath(outputUrl), `${webPatch.trimEnd()}${desktopPatch}`)
await mkdir(fileURLToPath(new URL('../lib/', import.meta.url)), { recursive: true })
await copyFile(
  fileURLToPath(new URL('../src/electron-preload.cjs', import.meta.url)),
  fileURLToPath(new URL('../lib/electron-preload.cjs', import.meta.url)),
)
await copyFile(
  fileURLToPath(new URL('../src/electron-entry.cjs', import.meta.url)),
  fileURLToPath(new URL('../lib/electron-entry.cjs', import.meta.url)),
)
