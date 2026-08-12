import type { Request, RequestHandler, Response } from 'express'
import {
  WebAuthClient,
  WebAuthError,
  type WebAuthClientConfig,
} from '@axis-iam/vertex/server'

export interface WebAuthSessionView {
  id: string
  accessToken: string
  expiresAt: number
}

export interface WebAuthExpressConfig extends WebAuthClientConfig {
  transactionCookieName?: string
  sessionCookieName?: string
  transactionCookiePath?: string
  sessionCookiePath?: string
  cookieDomain?: string
  secureCookies?: boolean
}

export interface WebAuthHandlers {
  login: RequestHandler
  callback: RequestHandler
  refresh: RequestHandler
  logout: RequestHandler
  requireSession: RequestHandler
  client: WebAuthClient
}

const DEFAULT_TRANSACTION_COOKIE = '__Secure-axis_vertex_tx'
const DEFAULT_SESSION_COOKIE = '__Host-axis_vertex_session'

export function createWebAuth(config: WebAuthExpressConfig): WebAuthHandlers {
  const transactionCookieName = config.transactionCookieName ?? DEFAULT_TRANSACTION_COOKIE
  const sessionCookieName = config.sessionCookieName ?? DEFAULT_SESSION_COOKIE
  const transactionCookiePath = config.transactionCookiePath ?? '/auth/callback'
  const sessionCookiePath = config.sessionCookiePath ?? '/'
  const secure = config.secureCookies ?? true
  validateCookieConfig({ transactionCookieName, sessionCookieName, transactionCookiePath, sessionCookiePath, cookieDomain: config.cookieDomain, secure })
  const client = new WebAuthClient(config)
  const cookieOptions = (path: string) => ({
    httpOnly: true as const,
    secure,
    sameSite: 'lax' as const,
    path,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  })

  const respondError = (res: Response, error: unknown, fallbackStatus: number): void => {
    const webError = error instanceof WebAuthError ? error : new WebAuthError('CONFIGURATION_INVALID')
    const status = webError.code === 'SESSION_STORE_FAILED' || webError.code === 'TRANSACTION_STORE_FAILED' ? 503 : fallbackStatus
    res.status(status).json({ error: webError.code })
  }

  const login: RequestHandler = async (_req, res) => {
    try {
      const result = await client.beginLogin()
      res.cookie(transactionCookieName, result.transactionId, cookieOptions(transactionCookiePath))
      res.redirect(result.authorizationUrl)
    } catch (error) {
      respondError(res, error, 503)
    }
  }

  const callback: RequestHandler = async (req, res) => {
    const transactionId = readCookie(req, transactionCookieName)
    try {
      const input = {
        transactionId: transactionId ?? '',
        state: queryText(req.query.state),
        code: queryText(req.query.code),
        error: queryText(req.query.error),
        errorDescription: queryText(req.query.error_description),
      }
      const result = await client.handleCallback(input)
      res.cookie(sessionCookieName, result.sessionId, cookieOptions(sessionCookiePath))
      res.clearCookie(transactionCookieName, cookieOptions(transactionCookiePath))
      res.redirect(result.redirectUrl)
    } catch (error) {
      res.clearCookie(transactionCookieName, cookieOptions(transactionCookiePath))
      respondError(res, error, 400)
    }
  }

  const refresh: RequestHandler = async (req, res) => {
    const sessionId = readCookie(req, sessionCookieName)
    try {
      if (!sessionId) throw new WebAuthError('SESSION_NOT_FOUND')
      await client.refresh({ sessionId })
      res.json({ ok: true })
    } catch (error) {
      respondError(res, error, 401)
    }
  }

  const logout: RequestHandler = async (req, res) => {
    const sessionId = readCookie(req, sessionCookieName)
    try {
      const result = await client.logout({ sessionId: sessionId ?? undefined })
      res.clearCookie(sessionCookieName, cookieOptions(sessionCookiePath))
      res.redirect(result.redirectUrl)
    } catch (error) {
      res.clearCookie(sessionCookieName, cookieOptions(sessionCookiePath))
      respondError(res, error, 503)
    }
  }

  const requireSession: RequestHandler = async (req, res, next) => {
    const sessionId = readCookie(req, sessionCookieName)
    try {
      if (!sessionId) throw new WebAuthError('SESSION_NOT_FOUND')
      const session = await client.readSession(sessionId)
      req.webAuthSession = {
        id: sessionId,
        accessToken: session.tokens.accessToken,
        expiresAt: session.expiresAt,
      }
      next()
    } catch (error) {
      respondError(res, error, 401)
    }
  }

  return { login, callback, refresh, logout, requireSession, client }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const item of header.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0) continue
    const key = item.slice(0, separator).trim()
    if (key !== name) continue
    const value = item.slice(separator + 1).trim()
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) return null
    return value
  }
  return null
}

function queryText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return value
}

function validateCookieConfig(config: {
  transactionCookieName: string
  sessionCookieName: string
  transactionCookiePath: string
  sessionCookiePath: string
  cookieDomain?: string
  secure: boolean
}): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.transactionCookieName.replace(/^__Host-/, '')) || !/^[A-Za-z0-9_-]{1,64}$/.test(config.sessionCookieName.replace(/^__Host-/, ''))) {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  if (!config.transactionCookiePath.startsWith('/') || !config.sessionCookiePath.startsWith('/')) throw new WebAuthError('CONFIGURATION_INVALID')
  if (config.cookieDomain && (!config.secure || !/^[A-Za-z0-9.-]+$/.test(config.cookieDomain))) throw new WebAuthError('CONFIGURATION_INVALID')
  if (config.transactionCookieName.startsWith('__Secure-') && !config.secure) throw new WebAuthError('CONFIGURATION_INVALID')
  if (config.sessionCookieName.startsWith('__Secure-') && !config.secure) throw new WebAuthError('CONFIGURATION_INVALID')
  if (config.transactionCookieName.startsWith('__Host-') && (config.cookieDomain || config.transactionCookiePath !== '/' || !config.secure)) {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  if (config.sessionCookieName.startsWith('__Host-') && (config.cookieDomain || config.sessionCookiePath !== '/' || !config.secure)) {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
}

declare global {
  namespace Express {
    interface Request {
      webAuthSession?: WebAuthSessionView
    }
  }
}
