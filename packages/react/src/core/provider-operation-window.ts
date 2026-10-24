import {
  authorizationCallback,
  SessionInvalidatedError,
} from '@axis-iam/vertex'
import { IamConfigurationError } from './types'

/** Open synchronously from the initiating gesture; no top-level navigation fallback. */
export class ProviderOperationWindow {
  private readonly popup: Window
  private closed = false
  private binding: {
    redirectUri: string
    operationId: string
    authorizationId: string
    expiresAt: number
  } | null = null
  private serverReturn: { url: string; expiresAt: number } | null = null
  constructor(private readonly assertOwner: () => void) {
    this.assertOwner()
    const popup = window.open('about:blank', '_blank')
    if (!popup)
      throw new IamConfigurationError(
        'Provider popup was blocked. Allow popups and try again.',
      )
    this.popup = popup
  }
  navigate(binding: {
    redirectUri: string
    operationId: string
    authorizationId: string
    expiresAt: string
    authorizationUrl: string
  }): void {
    this.assertActive()
    const target = new URL(binding.authorizationUrl),
      redirect = new URL(binding.redirectUri)
    const expiresAt = Date.parse(binding.expiresAt)
    if (
      ![target, redirect].every(
        (url) =>
          ['https:', 'http:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.hash,
      ) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    )
      throw new IamConfigurationError(
        'Invalid provider operation authorization',
      )
    this.binding = { ...binding, expiresAt }
    this.popup.location.href = target.href
  }
  callbackUrl(): string {
    this.assertActive()
    if (this.serverReturn) {
      if (Date.now() >= this.serverReturn.expiresAt) { this.close(); throw new SessionInvalidatedError() }
      let url: string
      try { url = this.popup.location.href } catch { throw new IamConfigurationError('Provider has not returned') }
      if (url !== this.serverReturn.url) throw new IamConfigurationError('Provider has not returned')
      return url
    }
    const binding = this.binding
    if (!binding || Date.now() >= binding.expiresAt) {
      this.close()
      throw new IamConfigurationError('Provider confirmation expired')
    }
    let url: string
    try {
      url = this.popup.location.href
    } catch {
      throw new IamConfigurationError(
        'Provider has not returned to the registered callback',
      )
    }
    const params = authorizationCallback(url, binding.redirectUri, [
      'operation_id',
      'authorization_id',
      'identity_operation',
    ])
    if (
      params.get('operation_id') !== binding.operationId ||
      params.get('authorization_id') !== binding.authorizationId ||
      params.get('identity_operation') !== 'proof_pending'
    )
      throw new IamConfigurationError('Provider operation callback mismatch')
    return url
  }
  navigateServer(authorizationUrl: string, returnUri: string, expiresAt: string) {
    this.assertActive()
    const url = new URL(authorizationUrl), returned = new URL(returnUri, window.location.href)
    const expiry = Date.parse(expiresAt)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      returned.origin !== window.location.origin || returned.search || returned.hash ||
      !Number.isFinite(expiry) || expiry <= Date.now()) throw new IamConfigurationError('Invalid provider authorization')
    this.serverReturn = { url: returned.href, expiresAt: expiry }
    this.popup.location.href = url.href
  }
  private assertActive(): void {
    this.assertOwner()
    if (this.closed || this.popup.closed) throw new SessionInvalidatedError()
  }
  close(): void {
    this.closed = true
    this.popup.close()
  }
}
