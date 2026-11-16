import { AuthenticationTransactionError } from '@axis-iam/vertex'

const PREFIX = 'axis-iam-provider:'

/** Observe one exact WindowProxy. Broadcast messages never complete authentication. */
export class AuthProviderWindow {
  private cancel: (() => void) | null = null
  constructor(
    private readonly redirectUri: string,
    private readonly timeoutMs = 600_000,
    private readonly returnMode: 'oauth' | 'server-session' = 'oauth',
  ) {}

  /** Callback popups leave consumption to their opener, including in StrictMode. */
  static isCallbackWindow(): boolean {
    return typeof window !== 'undefined' && Boolean(window.opener) && window.name.startsWith(PREFIX)
  }

  /** Open during user activation, then automatically wait for the registered return. */
  start(authorize: () => Promise<string>): Promise<string> {
    this.close()
    const target = new URL(this.redirectUri, window.location.origin)
    if (target.origin !== window.location.origin || !Number.isFinite(this.timeoutMs) ||
        this.timeoutMs <= 0 || this.timeoutMs > 600_000)
      return Promise.reject(new AuthenticationTransactionError('AUTH_CONFIGURATION_INVALID'))
    const popup = window.open('about:blank', `${PREFIX}${crypto.randomUUID()}`)
    if (!popup) return Promise.reject(new AuthenticationTransactionError('AUTH_PROVIDER_POPUP_BLOCKED'))
    return new Promise<string>((resolve, reject) => {
      let finished = false
      let navigated = false
      const finish = (url?: string, error?: Error) => {
        if (finished) return
        finished = true
        clearInterval(poll)
        clearTimeout(deadline)
        if (this.cancel === cancel) this.cancel = null
        popup.close()
        if (error) reject(error)
        else resolve(url!)
      }
      const cancel = () => finish(undefined, new AuthenticationTransactionError('AUTH_PROVIDER_CANCELLED'))
      const poll = setInterval(() => {
        if (popup.closed) return finish(undefined, new AuthenticationTransactionError('AUTH_PROVIDER_CLOSED'))
        if (!navigated) return
        let url: URL
        try { url = new URL(popup.location.href) }
        catch (error) {
          if (error instanceof DOMException && error.name === 'SecurityError') return
          return finish(undefined, new AuthenticationTransactionError('AUTH_PROVIDER_FAILED'))
        }
        if (url.origin !== target.origin || url.pathname !== target.pathname) return
        if (![...target.searchParams].every(([key, value]) =>
          url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value)) return
        if (this.returnMode === 'server-session' ? url.href !== target.href
          : !['code', 'kind', 'error'].some(key => url.searchParams.has(key))) return
        // Core validates the complete callback and original transaction before code I/O.
        const callback = url.href
        try { popup.history.replaceState(null, '', target.href) }
        catch { return finish(undefined, new AuthenticationTransactionError('AUTH_PROVIDER_CLOSED')) }
        finish(callback)
      }, 50)
      const deadline = setTimeout(() => finish(undefined, new AuthenticationTransactionError('AUTH_PROVIDER_TIMEOUT')), this.timeoutMs)
      this.cancel = cancel
      Promise.resolve().then(authorize).then(url => {
        if (finished) return
        const destination = new URL(url)
        if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password)
          throw new AuthenticationTransactionError('AUTH_TRANSACTION_INVALID_RESPONSE')
        navigated = true
        popup.location.href = destination.href
      }).catch((error: unknown) => finish(undefined, error instanceof Error
        ? error : new AuthenticationTransactionError('AUTH_PROVIDER_FAILED')))
    })
  }

  close(): void { this.cancel?.() }
}
