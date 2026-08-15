/* Fast Windows shortcut path: notify Electron's existing profile instance,
 * then report whether the full dsh startup can be skipped. */
const electron = require('electron')

const app = (electron.default ?? electron).app
const profileDir = process.argv[2]
if (!profileDir) app.exit(2)
else {
  void import('./electron-activator.js').then(({ activateExistingInstance }) => {
    app.exit(activateExistingInstance(app, profileDir) ? 0 : 1)
  }).catch(() => { app.exit(2) })
}
