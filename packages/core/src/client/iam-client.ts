import type { IamSdkConfig } from '../config.js'
import type {
  RequestPasswordResetInput,
  ResetPasswordInput,
  ResolvePermissionsResponse,
  PermissionsSnapshot,
} from './types.js'

const DEFAULT_TIMEOUT = 5_000
const MAX_RETRIES = 3

/**
 * Fetch-based HTTP client for IAM server's public auth and confidential SDK endpoints.
 * Handles retries, timeouts, and authentication.
 */
export class IamClient {
  private endpoint: string
  private clientId: string
  private clientSecret: string

  constructor(config: Pick<IamSdkConfig, 'endpoint' | 'clientId' | 'clientSecret'>) {
    if (!config.endpoint?.trim()) {
      throw new Error('IamClient endpoint is required')
    }
    if (!config.clientId?.trim() || !config.clientSecret?.trim()) {
      throw new Error('IamClient requires clientId and clientSecret from a WEB or M2M confidential ApplicationClient')
    }
    this.endpoint = config.endpoint.replace(/\/$/, '')
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  /**
   * Resolve permissions for given roles.
   * POST /open/v1/permissions:resolve
   */
  async resolvePermissions(clientId: string, roles: string[]): Promise<ResolvePermissionsResponse> {
    if (roles.length === 0) return { permissions: [] }
    return this.fetchWithRetry(
      `${this.endpoint}/open/v1/permissions:resolve`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ clientId, roles }),
      },
      parseResolvePermissions,
    )
  }

  /**
   * List role permission snapshots for the app.
   * GET /open/v1/apps/{clientId}/permissions
   */
  async listPermissions(clientId: string): Promise<PermissionsSnapshot> {
    const headers = this.headers()

    return this.fetchWithRetry(
      `${this.endpoint}/open/v1/apps/${encodeURIComponent(clientId)}/permissions`,
      { method: 'GET', headers },
      (value) => parsePermissionsSnapshot(value, clientId),
    )
  }

  /**
   * Request a password reset email for an application user.
   * POST /api/v1/auth/password/forgot
   */
  async requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
    const body: { email: string; client_id: string; redirect_uri?: string } = {
      email: input.email,
      client_id: this.clientId,
    }
    if (input.redirectUri) {
      body.redirect_uri = input.redirectUri
    }

    await this.fetchNoContentWithRetry(
      `${this.endpoint}/api/v1/auth/password/forgot`,
      {
        method: 'POST',
        headers: this.publicJsonHeaders(),
        body: JSON.stringify(body),
      },
    )
  }

  /**
   * Complete password reset with an opaque reset token.
   * POST /api/v1/auth/password/reset
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    await this.fetchNoContentWithRetry(
      `${this.endpoint}/api/v1/auth/password/reset`,
      {
        method: 'POST',
        headers: this.publicJsonHeaders(),
        body: JSON.stringify({
          token: input.token,
          newPassword: input.newPassword,
        }),
      },
    )
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-IAM-Client-Id': this.clientId,
      Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
    }
  }

  private publicJsonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    }
  }

  private async fetchTextWithTimeout(url: string, init: RequestInit): Promise<{ response: Response, body: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      return { response, body: await response.text() }
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchWithRetry<T>(url: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { response, body } = await this.fetchTextWithTimeout(url, init)
        if (!response.ok) throw new HttpResponseError(response.status, body)
        try {
          return parse(parseStrictJSON(body))
        } catch (error) {
          throw new StrictResponseError(error)
        }
      } catch (err) {
        lastError = err
        if (!isRetryableRequestError(err) || attempt === MAX_RETRIES) throw err
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
    throw lastError
  }

  private async fetchNoContentWithRetry(url: string, init: RequestInit): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { response, body } = await this.fetchTextWithTimeout(url, init)
        if (!response.ok) throw new HttpResponseError(response.status, body)
        return
      } catch (err) {
        lastError = err
        if (!isRetryableRequestError(err) || attempt === MAX_RETRIES) throw err
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
    throw lastError
  }
}

class HttpResponseError extends Error {
  constructor(readonly status: number, body: string) {
    super(`HTTP ${status}: ${body}`)
  }
}

class StrictResponseError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : 'invalid JSON response')
  }
}

function isRetryableRequestError(error: unknown): boolean {
  if (error instanceof HttpResponseError) return error.status === 429 || error.status >= 500
  if (error instanceof StrictResponseError) return false
  return !(typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
}

function parseStrictJSON(body: string): unknown {
  const value: unknown = JSON.parse(body)
  rejectDuplicateJSONMembers(body)
  return value
}

function rejectDuplicateJSONMembers(body: string): void {
  let index = 0
  const whitespace = () => {
    while (/\s/.test(body[index] ?? '')) index++
  }
  const stringToken = (): string => {
    const start = index++
    while (index < body.length) {
      if (body[index] === '\\') {
        index += 2
      } else if (body[index++] === '"') {
        return JSON.parse(body.slice(start, index)) as string
      }
    }
    throw new SyntaxError('unterminated JSON string')
  }
  const value = (): void => {
    whitespace()
    if (body[index] === '{') {
      index++
      whitespace()
      const seen = new Set<string>()
      while (body[index] !== '}') {
        const key = stringToken()
        if (seen.has(key)) throw new SyntaxError(`duplicate JSON member ${key}`)
        seen.add(key)
        whitespace()
        index++
        value()
        whitespace()
        if (body[index] === ',') {
          index++
          whitespace()
        } else {
          break
        }
      }
      index++
      return
    }
    if (body[index] === '[') {
      index++
      whitespace()
      while (body[index] !== ']') {
        value()
        whitespace()
        if (body[index] === ',') {
          index++
          whitespace()
        } else {
          break
        }
      }
      index++
      return
    }
    if (body[index] === '"') {
      stringToken()
      return
    }
    while (index < body.length && !/[\s,\]}]/.test(body[index] ?? '')) index++
  }
  value()
}

const CONCRETE_PERMISSION = /^[a-z0-9_-]{1,128}:[a-z0-9_-]{1,128}$/
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function parseResolvePermissions(value: unknown): ResolvePermissionsResponse {
  const payload = exactRecord(value, ['permissions'], 'permission resolve')
  return { permissions: strictPermissionKeys(payload.permissions, 'permission resolve', true) }
}

function parsePermissionsSnapshot(value: unknown, clientId: string): PermissionsSnapshot {
  const payload = exactRecord(value, ['applicationId', 'clientId', 'roles'], 'permission snapshot')
  if (typeof payload.applicationId !== 'string' || !CANONICAL_UUID.test(payload.applicationId) || payload.clientId !== clientId || !Array.isArray(payload.roles)) {
    throw new TypeError('invalid permission snapshot response')
  }
  const roleKeys = new Set<string>()
  const roles = payload.roles.map((item) => {
    const role = exactRecord(item, ['key', 'name', 'permissions'], 'permission snapshot role')
    if (typeof role.key !== 'string' || !/^[a-z0-9_-]{1,128}$/.test(role.key) || typeof role.name !== 'string' || role.name.trim().length === 0 || roleKeys.has(role.key)) {
      throw new TypeError('invalid permission snapshot response')
    }
    roleKeys.add(role.key)
    return { key: role.key, name: role.name, permissions: strictPermissionKeys(role.permissions, 'permission snapshot', true) }
  })
  return { applicationId: payload.applicationId, clientId, roles }
}

function exactRecord(value: unknown, fields: string[], operation: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`invalid ${operation} response`)
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(payload, field))) {
    throw new TypeError(`invalid ${operation} response`)
  }
  return payload
}

function strictPermissionKeys(value: unknown, operation: string, allowWildcards = false): string[] {
  if (!Array.isArray(value)) throw new TypeError(`invalid ${operation} response`)
  const seen = new Set<string>()
  return value.map((item) => {
    const valid = typeof item === 'string' && (CONCRETE_PERMISSION.test(item) || (allowWildcards && (item === '*:*' || (/^[a-z0-9_-]{1,128}:\*$/.test(item)))))
    if (!valid || seen.has(item as string)) throw new TypeError(`invalid ${operation} response`)
    seen.add(item as string)
    return item as string
  })
}
