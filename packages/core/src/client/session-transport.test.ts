import { afterEach, expect, it, vi } from 'vitest'
import { CookieSessionTransport, providerAuthorization } from './session-transport.js'
import { ServerSession } from './server-session.js'
const secret = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
const prelogin = () => ({state:'PRELOGIN',csrfToken:secret,expiresAt:new Date(Date.now()+60000).toISOString()})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('bounds same-origin Cookie/CSRF and finite requests without bearer/redirect fallback', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(prelogin())))
  vi.stubGlobal('fetch', fetch)
  const transport = new CookieSessionTransport({origin:'https://app.test'})
  await expect(transport.request({action:'login'})).rejects.toMatchObject({code:'SESSION_CSRF_REQUIRED'})
  await transport.request({action:'bootstrap'})
  await transport.request({action:'authorize',body:providerAuthorization('provider',{registrationAccessCode:'gate'})})
  const [url, init] = fetch.mock.calls[1] as unknown as [string,RequestInit]
  expect(url).toBe('https://app.test/console/session/login/authorize')
  expect(init).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store'})
  expect(new Headers(init.headers).get('X-CSRF-Token')).toBe(secret)
  expect(new Headers(init.headers).has('Authorization')).toBe(false)
  expect(JSON.parse(String(init.body))).toEqual({providerId:'provider',registrationAccessCode:'gate'})
  await expect(transport.request({action:'identityGet',ref:'../proxy'})).rejects.toMatchObject({code:'SESSION_REF_INVALID'})
  await expect(transport.request({action:'arbitrary',url:'https://evil.test'} as never)).rejects.toMatchObject({code:'UNSUPPORTED_OPERATION'})
  vi.stubGlobal('location', {origin:'https://other.test'})
  expect(() => new CookieSessionTransport({origin:'https://app.test'})).toThrow('SESSION_ORIGIN_INVALID')
})
it('rejects mixed, empty, oversized registration proofs before transport', () => {
  expect(providerAuthorization('p',{registrationGrantToken:'t'})).toEqual({providerId:'p',registrationGrantToken:'t'})
  for(const proof of [{registrationGrantToken:'t',registrationAccessCode:'c'},{registrationAccessCode:' '},{registrationGrantToken:'x'.repeat(2049)},{registrationAccessCode:'x'.repeat(129)},{token:'no'}])
    expect(()=>providerAuthorization('p',proof as never)).toThrow('REGISTRATION_GRANT_INVALID')
})
it('rejects private session material and late restore after local owner invalidation', async () => {
  let finish!:(value:unknown)=>void
  const session = new ServerSession({request:()=>new Promise(resolve=>{finish=resolve})})
  const pending=session.restore(),rejected=expect(pending).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
  session.clear();finish(prelogin());await rejected
  expect(session.getSnapshot()).toBeNull()
  const unsafe=new ServerSession({request:async()=>({...prelogin(),access_token:'forbidden'})})
  await expect(unsafe.restore()).rejects.toMatchObject({code:'SESSION_RESPONSE_INVALID'})
  expect(unsafe.getUser()).toBeNull();unsafe.dispose();session.dispose()
})
it('preserves CSRF/server errors and invalidates a late write on logout', async () => {
  let status = 403
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/bootstrap')) return new Response(JSON.stringify(prelogin()))
    if (url.endsWith('/logout')) return new Response(null, { status: 204 })
    if (status) return new Response(JSON.stringify({ error: status === 403 ? 'CSRF_INVALID' : 'SERVER_FAILURE' }), { status })
    return new Promise<Response>(resolve => { finish = resolve })
  }))
  const transport = new CookieSessionTransport({ origin: 'https://app.test' })
  await transport.request({ action: 'bootstrap' })
  await expect(transport.request({ action: 'login' })).rejects.toMatchObject({ code: 'CSRF_INVALID', status: 403 })
  status = 500
  await expect(transport.request({ action: 'login' })).rejects.toMatchObject({ code: 'SERVER_FAILURE', status: 500 })
  status = 0
  const late = transport.request({ action: 'login' })
  const rejected = expect(late).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  await transport.request({ action: 'logout' })
  finish(new Response(JSON.stringify(prelogin())))
  await rejected
  await expect(transport.request({ action: 'login' })).rejects.toMatchObject({ code: 'SESSION_CSRF_REQUIRED' })
})
