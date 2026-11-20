import { Router, json, type Router as ExpressRouter, type Request, type Response, type RequestHandler } from 'express'
import { randomBytes } from 'node:crypto'
import { BffSessionClient, BffError, type BffConfig } from '@axis-iam/vertex/server'
import type { ServerSessionView } from '@axis-iam/vertex'

export interface BffSessionBinding {
  /** This binding is the sole owner of the host's existing session Cookie. */
  read(req: Request): Promise<string | undefined>
  write(req: Request, res: Response, id: string): Promise<void>
  clear(req: Request, res: Response): Promise<void>
}
export interface BffExpressConfig extends BffConfig {
  basePath?: string
  binding?: BffSessionBinding
  cookieName?: string
  /** Explicit local development exception. Requires a loopback HTTP origin. */
  allowInsecureLoopback?: boolean
}
export interface BffHandlers {
  client: BffSessionClient
  router: ExpressRouter
  basePath: string
  requireSession: RequestHandler
  binding: BffSessionBinding
}
const verified = new WeakMap<Request, Extract<ServerSessionView, { profile: unknown }>>()
/** Reads only the value validated by requireSession for this exact request. */
export function getBffSession(req: Request) { return verified.get(req) }
export function getBffUser(req: Request) { return verified.get(req)?.profile }

function standalone(config: BffExpressConfig): BffSessionBinding {
  const origin = new URL(config.applicationOrigin)
  const insecure = config.allowInsecureLoopback === true
  if (insecure && (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
    throw new BffError('CONFIGURATION_INVALID', 400)
  if (!insecure && origin.protocol !== 'https:') throw new BffError('CONFIGURATION_INVALID', 400)
  const name = config.cookieName ?? '__Host-axis-session'
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(name) || (insecure && /^__Host-|^__Secure-/.test(name)))
    throw new BffError('CONFIGURATION_INVALID', 400)
  const options = { httpOnly: true, secure: !insecure, sameSite: 'lax' as const, path: '/' }
  return {
    async read(req) {
      const matches = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='))
      if (matches.length > 1) throw new BffError('SESSION_REQUIRED', 401)
      if (!matches.length) return undefined
      const id = matches[0]!.slice(name.length + 1)
      if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new BffError('SESSION_REQUIRED', 401)
      return id
    },
    async write(_req, res, id) { res.cookie(name, id, options) },
    async clear(_req, res) { res.clearCookie(name, options) },
  }
}

/** Explicit mounting is required. No route is installed by importing the package. */
export function createBff(config: BffExpressConfig): BffHandlers {
  const client = new BffSessionClient(config)
  const basePath = config.basePath ?? '/auth'
  if (!/^\/[A-Za-z0-9/_-]+$/.test(basePath) || basePath.endsWith('/') ||
    new URL(config.redirectUri).pathname !== basePath + '/callback' ||
    (config.binding && (config.cookieName !== undefined || config.allowInsecureLoopback !== undefined)))
    throw new BffError('CONFIGURATION_INVALID', 400)
  const binding = config.binding ?? standalone(config)
  const router = Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next() })
  router.use(json({ limit: '16kb', strict: true }))
  const respond = (res: Response, e: unknown) => {
    const error = e instanceof BffError
      ? e.code === 'SESSION_STORE_CLOSED' ? new BffError('SESSION_STORE_UNAVAILABLE', 503) : e
      : new BffError('IAM_UNAVAILABLE', 503)
    if (error.retryAfterSeconds !== undefined) res.set('Retry-After', String(error.retryAfterSeconds))
    res.status(error.status).json({ status: error.status, error: error.code, message: error.message, timestamp: new Date().toISOString() })
  }
  const validateBody = (body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
      throw new BffError('VALIDATION_ERROR', 400)
  }
  const dispatch: RequestHandler = async (req, res, next) => {
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    req.once('aborted', onAbort)
    try {
      await client.run(async () => {
        if (req.headers.authorization !== undefined) throw new BffError('VALIDATION_ERROR', 400)
        const url = new URL(req.url, client.origin), path = url.pathname
        const id = await binding.read(req)
        if (req.method !== 'GET' && req.method !== 'POST') return next()
        if (req.method === 'POST') await client.verifyCsrf(id ?? '', req.headers.origin, req.headers['x-csrf-token'])
        if (req.method === 'GET' && path === '/session/bootstrap') {
          const result = await client.bootstrap(id)
          if (id !== result.id) await binding.write(req, res, result.id)
          res.json(result.view); return
        }
        if (req.method === 'GET' && path === '/session') { res.json(await client.session(id ?? '')); return }
        if (req.method === 'GET' && path === '/login') {
          if (url.search) throw new BffError('VALIDATION_ERROR', 400)
          res.redirect(await client.hostedLogin(id ?? '')); return
        }
        if (req.method === 'GET' && path === '/callback') {
          if (!url.search) {
            // Email proof is a fragment: only this transient same-origin browser
            // landing can read it. Never copy it into a query or application JS.
            await client.session(id ?? '')
            const nonce = randomBytes(24).toString('base64url')
            const settings = JSON.stringify({ origin: client.origin, path: basePath + '/callback',
              base: basePath, landing: client.successRedirect }).replace(/</g, '\\u003c')
            res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`)
            res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Continue sign in</title><script nonce="${nonce}">
const settings=${settings};
(async()=>{
 const url=new URL(location.href), p=new URLSearchParams(url.hash.slice(1));
 history.replaceState(null,'',settings.path);
 const keys=['kind','method','auth_transaction_id','state','proof'];
 if(url.origin!==settings.origin||url.pathname!==settings.path||url.search||
    [...p.keys()].some(k=>!keys.includes(k))||keys.some(k=>p.getAll(k).length!==1)||
    p.get('kind')!=='AUTH_PROOF'||p.get('method')!=='EMAIL_MAGIC_LINK'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.get('auth_transaction_id')??'')||
    ['state','proof'].some(k=>!p.get(k)?.trim()||p.get(k).length>128)) throw Error('Invalid proof');
 const options={credentials:'same-origin',cache:'no-store',redirect:'error'};
 const boot=await fetch(settings.base+'/session/bootstrap',options);
 if(!boot.ok)throw Error('Session unavailable');
 const view=await boot.json();
 if(!/^[A-Za-z0-9_-]{43}$/.test(view.csrfToken))throw Error('Session unavailable');
 const send=(action,body)=>fetch(settings.base+'/session/login/'+action,{...options,method:'POST',
   headers:{'Content-Type':'application/json','X-CSRF-Token':view.csrfToken},body:JSON.stringify(body)});
 const result=await send('magic',{transactionId:p.get('auth_transaction_id'),state:p.get('state'),proof:p.get('proof')});
 if(!result.ok)throw Error('Authentication unavailable');
 const next=await result.json();
 if(next.state==='AUTHENTICATED'&&next.nextAction==='complete'){
   const complete=await send('complete',{});if(!complete.ok)throw Error('Authentication unavailable');
 }
})().finally(()=>location.replace(settings.landing)).catch(()=>{});
</script>`)
            return
          }
          const result = await client.callback(id ?? '', url.searchParams)
          if (result.id !== id) await binding.write(req, res, result.id)
          res.redirect(result.redirectUrl); return
        }
        if (req.method === 'GET' && ['/auth-methods', '/auth-policy'].includes(path)) {
          res.json(await client.capabilities(path === '/auth-methods' ? 'auth-methods' : 'auth-policy')); return
        }
        if (req.method === 'POST' && path === '/session/login') {
          validateBody(req.body)
          res.json(await client.customLogin(id ?? '')); return
        }
        const action = /^\/session\/login\/(authenticate|challenges|authorize|mfa|complete|cancel|magic)$/.exec(path)
        if (req.method === 'POST' && action) {
          const result = await client.loginAction(id ?? '', action[1]!, req.body)
          if (action[1] === 'cancel') await binding.clear(req, res)
          else if (result.id !== id) await binding.write(req, res, result.id)
          res.json(result.view); return
        }
        if (req.method === 'POST' && path === '/session/logout') {
          validateBody(req.body)
          const result = await client.logout(id)
          try { await binding.clear(req, res) }
          catch { result.local = 'UNCONFIRMED' }
          const status = result.local === 'UNCONFIRMED' || result.remote === 'UNCONFIRMED' ? 503 : 200
          res.status(status).json(status === 200 ? result : { status, error: 'LOGOUT_UNCONFIRMED', message: 'Logout partially confirmed',
            timestamp: new Date().toISOString(), details: result }); return
        }
        const registration = /^\/registration(?:\/([A-Za-z0-9_-]{43})(\/challenges|\/complete|\/cancel)?)?$/.exec(path)
        if (registration && (req.method === 'POST' || registration[1] && !registration[2])) {
          const result = await client.registration(id ?? '', req.method, registration[1], registration[2] ?? '', req.body ?? {},
            typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined)
          res.status(registration[1] ? 200 : result.status === 'PENDING_VERIFICATION' ? 202 : 201).json(result); return
        }
        if (req.method === 'POST' && ['/password-reset/request', '/password-reset/complete'].includes(path)) {
          await client.passwordReset(path.endsWith('/request') ? 'request' : 'complete', req.body)
          res.sendStatus(204); return
        }
        next()
      }, abort.signal)
    } catch (error) { respond(res, error) }
    finally { req.off('aborted', onAbort) }
  }
  router.use(dispatch)
  router.use((error: unknown, _req: Request, res: Response, _next: (e?: unknown) => void) => {
    if (error instanceof SyntaxError || (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large'))
      respond(res, new BffError('VALIDATION_ERROR', 400))
    else respond(res, error)
  })
  const requireSession: RequestHandler = async (req, res, next) => {
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    req.once('aborted', onAbort)
    try {
      if (req.headers.authorization !== undefined) throw new BffError('VALIDATION_ERROR', 400)
      const id = await binding.read(req)
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        await client.verifyCsrf(id ?? '', req.headers.origin, req.headers['x-csrf-token'])
      if (verified.has(req)) { next(); return }
      const view = await client.run(() => client.protect(id ?? ''), abort.signal)
      verified.set(req, view); next()
    } catch (e) { respond(res, e) }
    finally { req.off('aborted', onAbort) }
  }
  return { client, router, basePath, requireSession, binding }
}

export interface NativeBffSession {
  [key: string]: unknown
  regenerate(callback: (error?: unknown) => void): void
  save(callback: (error?: unknown) => void): void
}
type SessionRequest = Request & { session?: NativeBffSession }
/**
 * express-session compatible bridge: only a namespaced opaque reference is saved.
 * Authentication data and fences remain in provider, including on resave/touch.
 * The native middleware owns its sole Cookie; mount it before createBff.router.
 */
export function expressSessionBinding(namespace = 'axisVertexBff'): BffSessionBinding {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(namespace) || ['cookie', 'regenerate', 'save', '__proto__', 'constructor'].includes(namespace))
    throw new BffError('CONFIGURATION_INVALID', 400)
  const session = (req: Request) => {
    const s = (req as SessionRequest).session
    if (!s) throw new BffError('CONFIGURATION_INVALID', 400)
    return s
  }
  const save = (s: NativeBffSession) => new Promise<void>((resolve, reject) => s.save(error => error ? reject(new BffError('SESSION_STORE_UNAVAILABLE', 503)) : resolve()))
  return {
    async read(req) {
      const value = session(req)[namespace]
      if (value === undefined) return undefined
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new BffError('SESSION_REQUIRED', 401)
      return value
    },
    async write(req, _res, id) {
      let s = session(req)
      if (s[namespace] && s[namespace] !== id) {
        const unrelated = Object.fromEntries(Object.entries(s).filter(([key, value]) => key !== namespace && key !== 'cookie' && typeof value !== 'function'))
        await new Promise<void>((resolve, reject) => s.regenerate(error => error ? reject(new BffError('SESSION_STORE_UNAVAILABLE', 503)) : resolve()))
        s = session(req)
        for (const [key, value] of Object.entries(unrelated)) s[key] = value
      }
      s[namespace] = id
      await save(s)
    },
    async clear(req) { const s = session(req); delete s[namespace]; await save(s) },
  }
}
