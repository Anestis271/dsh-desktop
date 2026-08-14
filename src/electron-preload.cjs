/* global document, MutationObserver, window */

const { ipcRenderer } = require('electron')

function themeColor() {
  const meta = document.querySelector('meta[name="theme-color"]')
  return meta?.getAttribute('content') ?? ''
}

function notifyTheme() {
  const color = themeColor()
  if (color !== '') ipcRenderer.send('dsh-desktop-theme', color)
}

function installDragRegion() {
  const region = document.createElement('div')
  region.id = 'dsh-desktop-titlebar-drag-region'
  const style = document.createElement('style')
  const left = process.argv.includes('--dsh-desktop-left-controls') ? '80px' : '0'
  const right = process.argv.includes('--dsh-desktop-right-controls') ? '138px' : '0'
  style.textContent = `#dsh-desktop-titlebar-drag-region{position:fixed;top:0;left:${left};right:${right};height:36px;z-index:2147483646;-webkit-app-region:drag;user-select:none}`
  document.head.append(style)
  document.body.append(region)
}

window.addEventListener('DOMContentLoaded', () => {
  installDragRegion()
  notifyTheme()
  const observer = new MutationObserver(notifyTheme)
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] })
})
