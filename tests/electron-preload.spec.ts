import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

interface PreloadHarness {
  bodyObserver?: Observer
  contentLoaded(): void
  headObserver?: Observer
  region: Element
  resizeObserver?: ResizeObserverHarness
  sent: unknown[][]
  style: Element
}

interface Element {
  firstElementChild?: Element
  getBoundingClientRect(): { right: number }
  id?: string
  parentElement?: Element
  style: Record<string, string>
  textContent?: string
}

interface Observer {
  callback(): void
  disconnect: ReturnType<typeof vi.fn>
}

interface ResizeObserverHarness {
  callback(): void
  observed?: Element
}

async function executePreload(options: { argv: string[]; sidebarReady: boolean; sidebarRight: number }): Promise<PreloadHarness> {
  const source = await readFile(new URL('../src/electron-preload.cjs', import.meta.url), 'utf8')
  const sent: unknown[][] = []
  const region: Element = { style: {}, getBoundingClientRect: () => ({ right: 0 }) }
  const style: Element = { style: {}, getBoundingClientRect: () => ({ right: 0 }) }
  const sidebar: Element = { style: {}, getBoundingClientRect: () => ({ right: options.sidebarRight }) }
  const frame: Element = { style: {}, firstElementChild: sidebar, getBoundingClientRect: () => ({ right: 0 }) }
  const overlay: Element = { style: {}, parentElement: frame, getBoundingClientRect: () => ({ right: 0 }) }
  const harness: PreloadHarness = { contentLoaded: () => {}, region, sent, style }
  const document = {
    body: { append: vi.fn() },
    head: { append: vi.fn() },
    createElement: vi.fn((tag: string) => tag === 'style' ? style : region),
    querySelector: vi.fn((selector: string) => {
      if (selector === 'meta[name="theme-color"]') return { getAttribute: () => '#123456' }
      if (selector === '[data-shell-overlay]' && options.sidebarReady) return overlay
      return null
    }),
  }
  class MutationObserverHarness {
    private readonly observer: Observer

    constructor(callback: () => void) {
      this.observer = { callback, disconnect: vi.fn() }
    }

    disconnect(): void {
      this.observer.disconnect()
    }

    observe(target: unknown): void {
      if (target === document.head) harness.headObserver = this.observer
      else harness.bodyObserver = this.observer
    }
  }
  class ResizeObserverMock {
    private readonly observer: ResizeObserverHarness

    constructor(callback: () => void) {
      this.observer = { callback }
      harness.resizeObserver = this.observer
    }

    observe(target: Element): void {
      this.observer.observed = target
    }
  }
  const window = {
    addEventListener: vi.fn((_event: string, callback: () => void) => { harness.contentLoaded = callback }),
  }
  runInNewContext(source, {
    document,
    MutationObserver: MutationObserverHarness,
    process: { argv: options.argv },
    require: () => ({ ipcRenderer: { send: (...args: unknown[]) => { sent.push(args) } } }),
    ResizeObserver: ResizeObserverMock,
    window,
  })
  return harness
}

describe('Electron preload title bar', () => {
  it('starts the drag region after the live sidebar edge', async () => {
    const harness = await executePreload({ argv: ['--dsh-desktop-right-controls'], sidebarReady: true, sidebarRight: 280.2 })
    harness.contentLoaded()
    expect(harness.region.id).toBe('dsh-desktop-titlebar-drag-region')
    expect(harness.region.style.left).toBe('281px')
    expect(harness.style.textContent).toContain('left:50%;right:270px;height:36px')
    expect(harness.style.textContent).toContain("header:has([data-slot='conversation.session.header.utilities']){padding-right:148px!important}")
    expect(harness.style.textContent).toContain("header :has(>[data-slot='conversation.session.header.utilities']){position:relative;z-index:2147483647;-webkit-app-region:no-drag}")
    expect(harness.resizeObserver?.observed).toBeDefined()
    expect(harness.sent).toEqual([['dsh-desktop-theme', '#123456']])
    harness.resizeObserver?.callback()
    harness.headObserver?.callback()
    expect(harness.sent).toHaveLength(2)
  })

  it('waits for the WebUI layout and preserves the native left inset', async () => {
    const options = { argv: ['--dsh-desktop-left-controls'], sidebarReady: false, sidebarRight: 56 }
    const harness = await executePreload(options)
    harness.contentLoaded()
    expect(harness.region.style.left).toBeUndefined()
    options.sidebarReady = true
    harness.bodyObserver?.callback()
    expect(harness.region.style.left).toBe('80px')
    expect(harness.bodyObserver?.disconnect).toHaveBeenCalledOnce()
    expect(harness.style.textContent).toContain('right:0')
    expect(harness.style.textContent).not.toContain('conversation.session.header.utilities')
  })
})
