import { IamApiError, IamConfigurationError, IamNetworkError } from './types'
import type { IamApiErrorDetails } from './types'

export interface BrowserRequestOptions {
  method?: string
  headers?: HeadersInit
  json?: unknown
  body?: BodyInit | null
  bearerToken?: string | null
  timeoutMs?: number
  expectJson?: boolean
}

const DEFAULT_TIMEOUT_MS = 10_000

export async function requestJson<T>(url: string, options: BrowserRequestOptions = {}): Promise<T> {
  const res = await request(url, { ...options, expectJson: true })
  if (res.status === 204) {
    return undefined as T
  }
  const data = await readJsonBody(res)
  return data as T
}

export async function requestNoContent(url: string, options: BrowserRequestOptions = {}): Promise<void> {
  await request(url, { ...options, expectJson: false })
}

export async function request(url: string, options: BrowserRequestOptions = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const headers = headersToRecord(options.headers)
    if (options.json !== undefined && !hasHeader(headers, 'Content-Type')) {
      headers['Content-Type'] = 'application/json'
    }
    if (options.bearerToken) {
      headers.Authorization = `Bearer ${options.bearerToken}`
    }

    const init: RequestInit = {
      method: options.method ?? (options.json === undefined ? 'GET' : 'POST'),
      headers,
      body: options.json === undefined ? options.body : JSON.stringify(options.json),
    }
    Object.defineProperty(init, 'signal', {
      value: controller.signal,
      enumerable: false,
    })
    const res = await fetch(url, init)

    if (!res.ok) {
      throw await readIamApiError(res)
    }

    return res
  } catch (err) {
    if (err instanceof IamApiError) {
      throw err
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new IamNetworkError('IAM request timed out', err)
    }
    throw new IamNetworkError('IAM request failed', err)
  } finally {
    clearTimeout(timeout)
  }
}

export async function readJsonBody(res: Response): Promise<unknown> {
  if (typeof res.text !== 'function' && typeof res.json === 'function') {
    return await res.json()
  }
  if (typeof res.text !== 'function') {
    return undefined
  }
  const text = await res.text()
  if (!text) {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new IamConfigurationError('IAM response was not valid JSON', err)
  }
}

export async function readIamApiError(res: Response, fallback = `IAM API request failed (${res.status})`): Promise<IamApiError> {
  const body = await readErrorBody(res)
  const status = typeof body?.status === 'number' ? body.status : res.status
  const code = typeof body?.error === 'string'
    ? body.error
    : typeof body?.code === 'string'
      ? body.code
      : undefined
  const message = typeof body?.message === 'string' && body.message.length > 0
    ? body.message
    : code ?? fallback
  const details = isRecord(body?.details) ? body.details as IamApiErrorDetails : undefined
  return new IamApiError(message, {
    status,
    code,
    details,
    retryAfterSeconds: parseRetryAfterSeconds(res.headers?.get('Retry-After') ?? null),
  })
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) ? seconds : undefined
}

async function readErrorBody(res: Response): Promise<Record<string, unknown> | null> {
  if (typeof res.text !== 'function' && typeof res.json === 'function') {
    const data = await res.json().catch(() => null) as unknown
    return isRecord(data) ? data : null
  }
  if (typeof res.text !== 'function') {
    return null
  }
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    const data = JSON.parse(text) as unknown
    return isRecord(data) ? data : { message: text }
  } catch {
    return { message: text }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value
    return out
  }
  Object.assign(out, headers)
  return out
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  return Object.keys(headers).some((candidate) => candidate.toLowerCase() === key.toLowerCase())
}
