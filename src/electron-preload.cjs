/* global document, MutationObserver, ResizeObserver, window */

const { ipcRenderer } = require('electron')

function themeColor() {
  const meta = document.querySelector('meta[name="theme-color"]')
  return meta?.getAttribute('content') ?? ''
}

function notifyTheme() {
  const color = themeColor()
  if (color !== '') ipcRenderer.send('dsh-desktop-theme', color)
}

function trackSidebarEdge(region) {
  const nativeInset = process.argv.includes('--dsh-desktop-left-controls') ? 80 : 0
  const attach = () => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.firstElementChild
    if (sidebar === undefined || sidebar === null) return false
    const update = () => {
      region.style.left = `${Math.max(nativeInset, Math.ceil(sidebar.getBoundingClientRect().right))}px`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(sidebar)
    return true
  }
  if (attach()) return
  const observer = new MutationObserver(() => {
    if (attach()) observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function installDragRegion() {
  const region = document.createElement('div')
  region.id = 'dsh-desktop-titlebar-drag-region'
  const style = document.createElement('style')
  const right = process.argv.includes('--dsh-desktop-right-controls') ? '138px' : '0'
  style.textContent = `#dsh-desktop-titlebar-drag-region{position:fixed;top:0;left:50%;right:${right};height:36px;z-index:2147483646;-webkit-app-region:drag;user-select:none}`
  document.head.append(style)
  document.body.append(region)
  trackSidebarEdge(region)
}

window.addEventListener('DOMContentLoaded', () => {
  installDragRegion()
  notifyTheme()
  const observer = new MutationObserver(notifyTheme)
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] })
})
