import { describe, expect, it, vi } from 'vitest'
import { main } from '../src/electron-main.js'

describe('Electron entrypoint', () => {
  it('loads the Electron API and delegates to the shell', async () => {
    const api = {} as never
    const run = vi.fn(async () => {})
    await main(async () => ({ default: api }), run)
    expect(run).toHaveBeenCalledWith(api)
  })

  it('fails loudly when Electron did not expose an API', async () => {
    await expect(main(async () => ({}), vi.fn())).rejects.toThrow(/unavailable/)
  })
})
