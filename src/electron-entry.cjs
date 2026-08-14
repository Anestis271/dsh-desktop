/* Electron's Windows bootstrap is intentionally CommonJS; it then loads the
 * typed ESM shell without relying on Electron's ESM main-module heuristics. */
const electron = require('electron')
const net = require('node:net')

const initial = JSON.parse(process.env.DSH_DESKTOP_INIT || 'null')
void import('./electron-shell.js').then(async ({ runElectronShell, createStreamBridge }) => {
  const descriptor = process.env.DSH_DESKTOP_CONTROL
  let input = process.stdin
  let output = process.stdout
  if (descriptor) {
    const { port, token } = JSON.parse(descriptor)
    const socket = net.connect(port, '127.0.0.1')
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    socket.write(`${JSON.stringify({ token })}\n`)
    input = socket
    output = socket
  }
  return runElectronShell(electron.default ?? electron, createStreamBridge(initial, input, output))
}).catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`dsh-desktop: ${message}`)
  process.send?.({ type: 'error', message })
  process.exit(1)
})
