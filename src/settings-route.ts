import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ShortcutSettings } from './index.js'

/** Same-origin endpoint used by the desktop WebUI contribution. */
export const DESKTOP_SETTINGS_PATH = '/dsh-desktop/settings'
const MAX_BODY_BYTES = 1024
const SHORTCUT_KEYS = new Set<keyof ShortcutSettings>(['desktop', 'appMenu', 'login'])

export interface DesktopSettingsAccess {
  read(): ShortcutSettings
  write(key: keyof ShortcutSettings, enabled: boolean): Promise<void>
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(value))
}

function isAuthorized(req: IncomingMessage, expectedHost: string): boolean {
  if (req.headers.host !== expectedHost) return false
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${expectedHost}`
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isShortcutWrite(value: unknown): value is { key: keyof ShortcutSettings, enabled: boolean } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return SHORTCUT_KEYS.has(candidate.key as keyof ShortcutSettings) && typeof candidate.enabled === 'boolean'
}

/** Build the guarded host route without exposing unrelated desktop settings. */
export function createDesktopSettingsRoute(access: DesktopSettingsAccess, expectedHost: string): WebRoute {
  return {
    kind: 'exact',
    path: DESKTOP_SETTINGS_PATH,
    async handler(req, res) {
      if (!isAuthorized(req, expectedHost)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { shortcuts: access.read() })
        return
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST')
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!req.headers['content-type']?.startsWith('application/json')) {
        sendJson(res, 415, { error: 'application/json required' })
        return
      }
      try {
        const body = await readBody(req)
        if (!isShortcutWrite(body)) {
          sendJson(res, 400, { error: 'invalid shortcut setting' })
          return
        }
        await access.write(body.key, body.enabled)
        sendJson(res, 200, { shortcuts: access.read() })
      } catch {
        sendJson(res, 400, { error: 'invalid settings request' })
      }
    },
  }
}
