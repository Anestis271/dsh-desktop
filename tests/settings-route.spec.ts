import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopSettingsRoute, DESKTOP_SETTINGS_PATH, type DesktopSettingsAccess,
} from '../src/settings-route.js'

interface CapturedResponse {
  status: number
  headers: Record<string, string>
  body: string
}

async function invoke(
  access: DesktopSettingsAccess,
  options: { method?: string, host?: string, origin?: string, contentType?: string, body?: string } = {},
): Promise<CapturedResponse> {
  const chunks = options.body === undefined ? [] : [options.body]
  const req = Readable.from(chunks) as IncomingMessage
  req.method = options.method ?? 'GET'
  req.headers = {
    host: options.host ?? '127.0.0.1:3080',
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
  }
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' }
  const res = {
    setHeader: (key: string, value: string) => { captured.headers[key] = value },
    writeHead: (status: number, headers: Record<string, string>) => {
      captured.status = status
      Object.assign(captured.headers, headers)
    },
    end: (body: string) => { captured.body = body },
  } as unknown as ServerResponse
  await createDesktopSettingsRoute(access, '127.0.0.1:3080').handler(req, res)
  return captured
}

function access(): DesktopSettingsAccess {
  const shortcuts = { desktop: false, appMenu: false, login: false }
  return {
    read: () => ({ ...shortcuts }),
    write: vi.fn(async (key, enabled) => { shortcuts[key] = enabled }),
  }
}

describe('desktop settings route', () => {
  it('serves current shortcuts without caching', async () => {
    const routeAccess = access()
    const response = await invoke(routeAccess)
    expect(DESKTOP_SETTINGS_PATH).toBe('/dsh-desktop/settings')
    expect(response).toMatchObject({
      status: 200,
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ shortcuts: routeAccess.read() }),
    })
  })

  it('rejects rebinding hosts and cross-origin callers', async () => {
    expect((await invoke(access(), { host: 'example.test' })).status).toBe(403)
    expect((await invoke(access(), { origin: 'https://example.test' })).status).toBe(403)
    expect((await invoke(access(), { origin: 'http://127.0.0.1:3080' })).status).toBe(200)
  })

  it('enforces the method and JSON media type', async () => {
    const method = await invoke(access(), { method: 'PUT' })
    expect(method).toMatchObject({ status: 405, headers: { allow: 'GET, POST' } })
    expect((await invoke(access(), { method: 'POST' })).status).toBe(415)
  })

  it('updates one validated shortcut and returns the committed snapshot', async () => {
    const routeAccess = access()
    const response = await invoke(routeAccess, {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ key: 'appMenu', enabled: true }),
    })
    expect(routeAccess.write).toHaveBeenCalledWith('appMenu', true)
    expect(response).toMatchObject({
      status: 200,
      body: JSON.stringify({ shortcuts: { desktop: false, appMenu: true, login: false } }),
    })
  })

  it('rejects malformed, oversized, and unsupported writes', async () => {
    const request = (body: string) => invoke(access(), {
      method: 'POST', contentType: 'application/json', body,
    })
    expect((await request('{')).status).toBe(400)
    expect((await request('null')).status).toBe(400)
    expect((await request(JSON.stringify({ key: 'other', enabled: true }))).status).toBe(400)
    expect((await request(JSON.stringify({ key: 'desktop', enabled: 'yes' }))).status).toBe(400)
    expect((await request(JSON.stringify({ value: 'x'.repeat(1100) }))).body).toContain('invalid settings request')
  })

  it('contains provider failures without leaking implementation details', async () => {
    const failing = access()
    failing.write = vi.fn(async () => { throw new Error('disk unavailable') })
    const error = await invoke(failing, {
      method: 'POST', contentType: 'application/json', body: JSON.stringify({ key: 'login', enabled: true }),
    })
    expect(error.body).toBe(JSON.stringify({ error: 'invalid settings request' }))
  })
})
