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

function officialSidebarButton() {
  return [...document.querySelectorAll('button[aria-label]')].find(button => {
    const label = button.getAttribute('aria-label')?.toLocaleLowerCase() ?? ''
    return label.includes('sidebar') || label.includes('侧边栏')
  })
}

function installTitlebarToggle() {
  if (!process.argv.includes('--dsh-desktop-right-controls')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'dsh-desktop-sidebar-toggle'
  button.title = 'Toggle sidebar'
  button.setAttribute('aria-label', 'Toggle sidebar')
  button.addEventListener('click', () => officialSidebarButton()?.click())
  const style = document.createElement('style')
  style.textContent = '#dsh-desktop-sidebar-toggle{position:fixed;top:4px;left:8px;width:32px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;z-index:2147483647;-webkit-app-region:no-drag;cursor:pointer}#dsh-desktop-sidebar-toggle:hover{background:color-mix(in srgb,currentColor 12%,transparent)}#dsh-desktop-sidebar-toggle:focus-visible{outline:2px solid currentColor;outline-offset:-2px}#dsh-desktop-sidebar-toggle:before{content:"";display:block;width:15px;height:13px;margin:auto;border:1.5px solid currentColor;border-radius:2px;background:linear-gradient(90deg,currentColor 0 2px,transparent 2px 100%)}'
  document.head.append(style)
  document.body.append(button)
}

window.addEventListener('DOMContentLoaded', () => {
  installTitlebarToggle()
  notifyTheme()
  const observer = new MutationObserver(notifyTheme)
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] })
})
