import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import express from 'express'
import session from 'express-session'
import { Module, Controller, Get } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { MemorySessionProvider, BffSessionClient } from '@axis-iam/vertex/server'
import { parseServerSession } from '@axis-iam/vertex'
import { createBff, getBffUser, getBffSession, expressSessionBinding } from '@axis-iam/vertex-express'
import { mountBff } from '@axis-iam/vertex-nestjs'
import { startFixture } from './fixture.mjs'

const require = createRequire(import.meta.url)
const wrongProofOnly = process.argv.includes('--wrong-proof-retry')
const acceptanceRepair = process.argv.includes('--acceptance-repair')
const businessCsrf = process.argv.includes('--business-csrf')
for (const name of ['@axis-iam/vertex', '@axis-iam/vertex/server', '@axis-iam/vertex-react', '@axis-iam/vertex-express', '@axis-iam/vertex-nestjs'])
  assert.ok(require(name))
assert.equal(require('@axis-iam/vertex').BffSessionClient, undefined)
const fixture = await startFixture()
const resources = [], results = []
const record = name => results.push({ scenario: name, pass: true })
function config(provider, origin) {
  return { provider, issuer: fixture.issuer, audience: 'resource', clientId: 'connected-web', clientSecret: 'fixture-confidential',
    applicationOrigin: origin, redirectUri: origin + '/auth/callback', successRedirect: '/done',
    postLogoutRedirect: '/out', allowInsecureLoopback: true, cookieName: 'axis-bff-fixture' }
}
async function host(kind, failureEnvelope) {
  const provider = new MemorySessionProvider()
  resources.push(() => provider.close())
  let application, server, bff, held, release, writes = 0
  const attempts = []
  if (kind === 'nest') {
    class Api { get() { return { anonymous: true } } }
    Controller('unprotected')(Api); Get()(Api.prototype, 'get', Object.getOwnPropertyDescriptor(Api.prototype, 'get'))
    class App {}
    Module({ controllers: [Api] })(App)
    application = await NestFactory.create(App, { logger: false })
    application.useGlobalGuards({ canActivate: () => false })
    server = application.getHttpServer()
  } else {
    application = express()
    if (kind === 'native') application.use(session({ secret: 'fixture-native-session-secret-32-chars', name: 'native-only',
      resave: true, saveUninitialized: true, cookie: { httpOnly: true, sameSite: 'lax', secure: false } }))
    server = await new Promise(resolve => { const s = application.listen(0, '127.0.0.1', () => resolve(s)) })
  }
  // Reserve an ephemeral port first; Nest app has not initialized routes/guards yet.
  if (kind === 'nest') await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const options = config(provider, origin)
  if (kind === 'native') {
    delete options.allowInsecureLoopback; delete options.cookieName
    options.binding = expressSessionBinding()
  }
  bff = kind === 'nest' ? mountBff(application, options) : createBff(options)
  if (failureEnvelope) {
    // Only a wire-shape fixture: Python/Django currently reports the same failed
    // proof as SESSION_INVALIDATED/401. Its SDK/runtime is not reimplemented here.
    application.use('/auth/session/login/authenticate', (_req, res, next) => {
      const json = res.json.bind(res)
      res.json = value => json(res.statusCode === 401 && value.error === 'UNAUTHORIZED'
        ? { ...value, error: failureEnvelope, message: failureEnvelope } : value)
      next()
    })
  }
  if (kind !== 'nest') application.use(bff.basePath, bff.router)
  const app = kind === 'nest' ? application.getHttpAdapter().getInstance() : application
  app.all('/business-write', (req, _res, next) => {
    attempts.push({ method: req.method, origin: req.headers.origin, csrfPresent: Boolean(req.headers['x-csrf-token']),
      cookiePresent: Boolean(req.headers.cookie) }); next()
  }, bff.requireSession, bff.requireSession, (_req, res) => { writes++; res.json({ writes }) })
  app.post('/business-cache-check', bff.requireSession, (req, _res, next) => {
    delete req.headers['x-csrf-token']; next()
  }, bff.requireSession, (_req, res) => { writes++; res.json({ writes }) })
  app.get('/seed-host', (req, res) => { if (req.session) req.session.hostField = 'owned-by-application'; res.json({ ok: true }) })
  app.get('/host-field', (req, res) => res.json({ value: req.session?.hostField }))
  app.get('/api/business', bff.requireSession, bff.requireSession, (req, res) => {
    const user = getBffUser(req), view = getBffSession(req)
    assert.equal(user, getBffUser(req)) // getters perform no hidden IAM request
    res.json({ user: user.id, canRead: view.permissions.permissions.includes('documents:read') })
  })
  app.get('/api/forbidden', bff.requireSession, (_req, res) => res.status(403).json({ error: 'FORBIDDEN' }))
  app.get('/hold', bff.requireSession, (req, res) => {
    held?.()
    release = () => { if (req.session) req.session.fixtureField = 'saved-after-logout'; res.json({ complete: true }) }
  })
  app.get(['/','/done','/out'], (_req, res) => res.type('html').send('<!doctype html><html><body><main id="app"></main><script type="module" src="/browser.js"></script></body></html>'))
  app.get('/browser.js', async (_req, res) => res.type('js').send(await readFile(new URL('./browser.js', import.meta.url), 'utf8')))
  if (kind === 'nest') await application.init()
  resources.push(async () => {
    if (kind === 'nest') await application.close()
    else await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  })
  const jar = new Map()
  async function request(path, body, options = {}) {
    const headers = { cookie: [...jar].map(([k,v]) => k + '=' + v).join('; '), ...(body !== undefined
      ? { origin, 'content-type': 'application/json', 'x-csrf-token': options.csrf ?? csrf } : {}), ...options.headers }
    const response = await fetch(origin + path, { method: options.method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'manual', headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';'), index = pair.indexOf('=')
      if (pair.slice(index + 1) === '') jar.delete(pair.slice(0, index))
      else jar.set(pair.slice(0, index), pair.slice(index + 1))
    }
    return response
  }
  let csrf
  async function bootstrap() {
    const res = await request('/auth/session/bootstrap')
    assert.equal(res.status, 200, kind + ' bootstrap')
    const view = await res.json(); csrf = view.csrfToken
    return view
  }
  async function hosted() {
    await bootstrap()
    const login = await request('/auth/login')
    assert.equal(login.status, 302)
    const authorization = await fetch(login.headers.get('location'), { redirect: 'manual' })
    const callback = new URL(authorization.headers.get('location'))
    const complete = await request(callback.pathname + callback.search)
    assert.equal(complete.status, 302)
    assert.equal(complete.headers.get('location'), origin + '/done')
    await bootstrap()
    return callback
  }
  return { kind, provider, origin, request, bootstrap, hosted, jar, bff,
    writes: () => writes, attempts,
    hold: () => new Promise(resolve => { held = resolve }), release: () => release(), csrf: () => csrf }
}
async function contract(h) {
  if (h.kind === 'native') await h.request('/seed-host')
  assert.equal((await h.request('/api/business')).status, 401)
  assert.equal((await h.request('/auth/login')).status, 401)
  const pre = await h.bootstrap()
  const cookie = [...h.jar.keys()]
  assert.equal(cookie.length, 1)
  const badCsrf = await h.request('/auth/session/login', {}, { csrf: 'wrong' })
  assert.equal(badCsrf.status, 403)
  assert.equal((await h.request('/auth/session/login', {}, { headers: { origin: 'https://evil.test' } })).status, 403)
  const callback = await h.hosted()
  if (h.kind === 'native') assert.equal((await (await h.request('/host-field')).json()).value, 'owned-by-application')
  assert.equal((await h.request(callback.pathname + callback.search)).status, 401)
  const validityBefore = fixture.counts.validity
  const protectedResponse = await h.request('/api/business')
  assert.equal(protectedResponse.status, 200)
  assert.equal(fixture.counts.validity, validityBefore + 1, 'two guards and repeated getters share one request validation')
  assert.equal((await protectedResponse.json()).canRead, true)
  assert.equal((await h.request('/api/forbidden')).status, 403)
  assert.equal((await h.request('/auth/session')).status, 200)
  assert.equal((await h.request('/api/business', undefined, { headers: { authorization: 'Bearer invalid' } })).status, 400)
  fixture.setValidityFailure(true)
  const fault = await h.request('/auth/session')
  assert.equal(fault.status, 503); assert.equal((await fault.json()).error, 'IAM_UNAVAILABLE')
  fixture.setValidityFailure(false)
  const current = await h.request('/auth/session')
  const currentView = await current.json()
  assert.equal(current.headers.get('cache-control'), 'no-store')
  assert.doesNotMatch(JSON.stringify(currentView), /fixture-at|fixture-rt|controlSecret|codeVerifier|fixture-confidential/)
  if (h.kind === 'native') {
    const ready = h.hold()
    const pending = h.request('/hold')
    await ready
    assert.equal((await h.request('/auth/session/logout', {})).status, 200)
    h.release()
    await pending
    assert.equal((await h.request('/api/business')).status, 401)
    assert.equal((await (await h.request('/host-field')).json()).value, 'owned-by-application')
    // Real express-session resave persisted an old reference. It cannot recreate auth.
    record('native-session-resave-after-logout-refuses-authentication')
  } else {
    const logout = await h.request('/auth/session/logout', {})
    assert.deepEqual(await logout.json(), { local: 'INVALIDATED', cookie: 'CLEARED', remote: 'SESSION_REVOKED', sso: 'NOT_REQUESTED' })
  }
  assert.equal((await h.request('/api/business')).status, 401)
  await h.bootstrap()
  assert.equal((await h.request('/auth/session/login', { unexpected: true })).status, 400)
  assert.equal((await h.request('/auth/session/login', {})).status, 200)
  const wrong = await h.request('/auth/session/login/authenticate', { method: 'PASSWORD', identifier: { kind: 'EMAIL', value: 'u@example.test' }, password: 'wrong' })
  assert.equal(wrong.status, 401)
  const primary = await h.request('/auth/session/login/authenticate', { method: 'PASSWORD', identifier: { kind: 'EMAIL', value: 'u@example.test' }, password: 'correct' })
  assert.equal((await primary.json()).state, 'MFA_REQUIRED')
  const mfa = await h.request('/auth/session/login/mfa', { method: 'TOTP', code: '123456' })
  assert.equal((await mfa.json()).nextAction, 'complete')
  const complete = await h.request('/auth/session/login/complete', {})
  const view = await complete.json()
  assert.equal(view.state, 'AUTHENTICATED'); assert.ok(view.profile)
  assert.notEqual(view.csrfToken, pre.csrfToken)
  assert.equal((await h.request('/api/business')).status, 200)
  await h.bootstrap()
  fixture.setLogoutFailure(true)
  const partial = await h.request('/auth/session/logout', {})
  assert.equal(partial.status, 503); assert.equal((await partial.json()).details.remote, 'UNCONFIRMED')
  fixture.setLogoutFailure(false)
  assert.equal((await h.request('/api/business')).status, 401)
  await h.bootstrap()
  const registration = await h.request('/auth/registration', { identifier: { kind: 'EMAIL', value: 'new@example.test' }, password: 'FixturePass123!' },
    { headers: { 'idempotency-key': 'fixed-registration-attempt' } })
  assert.equal(registration.status, 202)
  const reg = await registration.json()
  assert.match(reg.registrationId, /^[A-Za-z0-9_-]{43}$/); assert.equal(reg.controlSecret, undefined)
  assert.equal((await h.request('/auth/registration/' + reg.registrationId)).status, 200)
  assert.equal((await h.request('/auth/registration/' + reg.registrationId + '/complete', { code: '123456' })).status, 200)
  assert.equal((await h.request('/auth/password-reset/request', { email: 'u@example.test' })).status, 204)
  assert.equal((await h.request('/auth/password-reset/complete', { token: 'fixture-email-proof', newPassword: 'NewFixture123!' })).status, 204)
  record(h.kind + '-HTTP-hosted-custom-CSRF-validity-errors-registration-recovery-business')
}

async function packedCore() {
  const vectors = JSON.parse(await readFile(new URL('./c0-v1.json', import.meta.url), 'utf8'))
  for (const vector of vectors.viewVectors) {
    if (vector.accept) assert.doesNotThrow(() => parseServerSession(vector.value), vector.id)
    else assert.throws(() => parseServerSession(vector.value), vector.id)
  }
  let clock = Date.now()
  const provider = new MemorySessionProvider({ now: () => clock })
  resources.push(() => provider.close())
  const client = new BffSessionClient({ ...config(provider, 'https://packed.example.test'), now: () => clock })
  const login = async instance => {
    const pre = await instance.bootstrap()
    const authorization = await fetch(await instance.hostedLogin(pre.id), { redirect: 'manual' })
    const callback = new URL(authorization.headers.get('location'))
    return instance.callback(pre.id, callback.searchParams)
  }
  const a = await login(client)
  const original = await provider.read(a.id)
  clock += 275000
  const refreshBefore = fixture.counts.refreshes
  const view = await client.run(() => client.protect(a.id))
  assert.equal(view.state, 'AUTHENTICATED')
  assert.equal(fixture.counts.refreshes, refreshBefore + 1)
  assert.equal((await provider.read(a.id)).absoluteExpiresAt, original.absoluteExpiresAt)
  clock += 310000
  assert.equal((await client.logout(a.id)).remote, 'REFRESH_FAMILY_REVOKED')
  assert.equal(fixture.counts.refreshes, refreshBefore + 1, 'logout must not refresh')
  // A new no-offline_access flow gets no RT from the protocol fixture.
  clock = Date.now()
  const noRt = new BffSessionClient({ ...config(provider, 'https://packed.example.test'), now: () => clock, scopes: ['openid', 'profile'] })
  const b = await login(noRt)
  assert.equal((await provider.read(b.id)).tokens.refreshToken, undefined)
  clock += 310000
  assert.equal((await noRt.logout(b.id)).remote, 'NOT_ATTEMPTED')
  const bounded = new MemorySessionProvider({ now: () => clock, maxPrelogins: 1, preloginTtlMs: 20 })
  resources.push(() => bounded.close())
  const r = { schemaVersion: 1, version: 0, kind: 'PRELOGIN', lifecycle: 'READY', owner: 'owner',
    csrfToken: 'csrf', clientId: 'client', createdAt: clock, absoluteExpiresAt: clock + 1000, idleExpiresAt: clock + 1000 }
  await bounded.create('id', r)
  const copy = await bounded.read('id'); copy.owner = 'mutated'
  assert.equal((await bounded.read('id')).owner, 'owner')
  await assert.rejects(bounded.create('other', r), { code: 'SESSION_STORE_CAPACITY' })
  const saved = await bounded.read('id') // create clamps TTL; CAS must use the actual stored deadline.
  const owned = { ...saved, version: 1, lifecycle: 'SEND_INTENT', operation: { fence: 'f', expiresAt: clock + 10 } }
  assert.deepEqual(await Promise.all([bounded.compareAndSet('id', saved, owned),
    bounded.compareAndSet('id', saved, { ...owned, operation: { fence: 'competitor', expiresAt: clock + 10 } })]),
    ['COMMITTED', 'CONFLICT'])
  await bounded.invalidate('id')
  assert.equal(await bounded.compareAndSet('id', owned, { ...owned, version: 2 }), 'CONFLICT')
  await bounded.create('id', r)
  clock += 21
  assert.equal(await bounded.read('id'), null)
  await bounded.close()
  await assert.rejects(bounded.read('id'), { code: 'SESSION_STORE_CLOSED' })
  record('packed-core-memory-TTL-capacity-copy-CAS-invalidation-close-refresh-noRT-expiredAT-logout')
}
async function packedErrors(h) {
  async function newCallback() {
    await h.bootstrap()
    const begin = await h.request('/auth/login')
    assert.equal(begin.status, 302)
    const upstream = await fetch(begin.headers.get('location'), { redirect: 'manual' })
    const callback = new URL(upstream.headers.get('location'))
    return callback.pathname + callback.search
  }
  for (const entry of [
    { status: 400, error: 'invalid_grant', code: 'OAUTH_INVALID_GRANT', host: 401 },
    { status: 401, error: 'invalid_client', code: 'OAUTH_INVALID_CLIENT', host: 401 },
    { status: 503, error: 'server_error', code: 'IAM_UNAVAILABLE', host: 503 },
    { status: 0, error: 'disconnect', code: 'REFRESH_UNCERTAIN', host: 401 },
  ]) {
    await h.hosted()
    const id = [...h.jar.values()][0], current = await h.provider.read(id)
    await h.provider.compareAndSet(id, current, { ...current, version: current.version + 1, tokens: { ...current.tokens, expiresAt: Date.now() } })
    fixture.setTokenFailure(entry.status ? entry : 'disconnect')
    const before = fixture.counts.tokenFailures ?? 0
    const response = await h.request('/auth/session'), body = await response.json()
    assert.equal(response.status, entry.host); assert.equal(body.error, entry.code)
    assert.doesNotMatch(JSON.stringify(body), /private|fixture-at|fixture-rt/)
    assert.equal(await h.provider.read(id), null)
    assert.equal((await h.request('/auth/session')).status, 401)
    assert.equal(fixture.counts.tokenFailures, before + 1)
    fixture.setTokenFailure(null)
    record('A-JS-002-packed-refresh-' + entry.error + '-no-replay')
  }
  for (const mode of ['token-503', 'identity-503']) {
    const callback = await newCallback()
    if (mode === 'token-503') fixture.setTokenFailure({ status: 503, error: 'server_error' })
    else fixture.setIdentityFailure(true)
    const response = await h.request(callback), body = await response.json()
    assert.equal(response.status, 503); assert.equal(body.error, 'IAM_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(body), /private|fixture-at|fixture-rt/)
    fixture.setTokenFailure(null); fixture.setIdentityFailure(false)
    assert.equal((await h.request(callback)).status, 401)
    record('A-JS-002-packed-callback-' + mode + '-consumed')
  }
}

let chrome, socket
try {
  if (!wrongProofOnly && !acceptanceRepair && !businessCsrf) await packedCore()
  const standalone = await host('express')
  const pythonEnvelope = wrongProofOnly ? await host('express', 'SESSION_INVALIDATED') : null
  if (acceptanceRepair) await packedErrors(standalone)
  if (businessCsrf) {
    for (const h of [standalone, await host('native'), await host('nest')]) {
      await h.hosted()
      const before = h.writes()
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        for (const headers of [
          { origin: undefined }, { origin: 'invalid' }, { origin: 'http://127.0.0.1:1' },
          { 'x-csrf-token': undefined }, { 'x-csrf-token': 'wrong' },
        ]) {
          // undefined explicitly removes a header; fetch must not stringify it.
          const cleanHeaders = { origin: h.origin, 'x-csrf-token': h.csrf(), ...headers }
          for (const key of Object.keys(cleanHeaders)) if (cleanHeaders[key] === undefined) delete cleanHeaders[key]
          const response = await fetch(h.origin + '/business-write', { method,
            headers: { cookie: [...h.jar].map(([k,v]) => k+'='+v).join('; '), ...cleanHeaders } })
          assert.equal(response.status, 403); assert.equal((await response.json()).error, 'SESSION_CSRF_INVALID')
          assert.equal(h.writes(), before)
        }
      }
      assert.equal((await h.request('/business-cache-check', {})).status, 403)
      assert.equal(h.writes(), before)
      for (const method of ['POST','PATCH','DELETE']) assert.equal((await h.request('/business-write', {}, { method })).status, 200)
      for (const method of ['GET','HEAD','OPTIONS']) assert.equal((await h.request('/business-write', undefined, { method })).status, 200)
      record('F-BFF-001-' + h.kind + '-POST-PATCH-DELETE-Origin-CSRF-cache-and-safe-methods')
    }
  }
  if (!wrongProofOnly && !acceptanceRepair && !businessCsrf) {
    const native = await host('native')
    const nest = await host('nest')
    for (const h of [standalone, native, nest]) { await contract(h); console.log('HTTP PASS', h.kind) }
    assert.equal((await nest.request('/unprotected')).status, 403) // Nest global business guard remains active.
    record('nest-auth-middleware-before-bearer-guard-business-stays-guarded')
  }
  const profileDir = resolve('chrome-profile-' + process.pid)
  await mkdir(profileDir, { recursive: true })
  chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore' })
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  let port
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(profileDir + '/DevToolsActivePort', 'utf8')).split('\n')[0]); break } catch { await delay(100) }
  }
  assert.ok(port)
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map(), exceptions = [], responses = []
  socket.addEventListener('message', e => {
    const message = JSON.parse(e.data)
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.method === 'Network.responseReceived') responses.push(message.params.response)
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id); clearTimeout(item.timer)
    message.error ? item.reject(new Error('CDP failure')) : item.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    assert.equal(result.exceptionDetails, undefined, 'browser evaluation failed: ' + expression)
    return result.result?.value
  }
  const until = async (expression, name) => {
    for (let i = 0; i < 160; i++) {
      try { if (await evaluate(expression)) return } catch {}
      await delay(50)
    }
    throw new Error('Browser did not reach ' + name)
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  if (businessCsrf) {
    await send('Network.clearBrowserCookies')
    await send('Page.navigate', { url: standalone.origin })
    await until('Boolean(window.bff) && window.bff.step()==="identifier"', 'browser bootstrap')
    await evaluate('void window.bff.hosted()')
    await until('location.pathname==="/done" && Boolean(window.bff)', 'browser authenticated')
    const before = standalone.writes(), attemptsBefore = standalone.attempts.length
    const attacker = express()
    attacker.get('/', (_req,res) => res.type('html').send(`<form method="POST" enctype="text/plain" action="${standalone.origin}/business-write"><button id="submit">Submit</button></form>`))
    const attackServer = await new Promise(resolve => { const s = attacker.listen(0,'127.0.0.1',()=>resolve(s)) })
    resources.push(() => new Promise(resolve => { attackServer.close(resolve); attackServer.closeAllConnections() }))
    const attackerOrigin = 'http://127.0.0.1:' + attackServer.address().port
    assert.notEqual(attackerOrigin, standalone.origin)
    await send('Page.navigate', { url: attackerOrigin })
    await until('Boolean(document.querySelector("#submit"))', 'ordinary foreign form')
    await evaluate('document.querySelector("#submit").click()')
    await until('document.body.innerText.includes("SESSION_CSRF_INVALID")', '403 form response')
    assert.equal(responses.filter(r => r.url === standalone.origin+'/business-write').at(-1).status,403)
    const attempt = standalone.attempts[attemptsBefore]
    assert.equal(attempt.origin, attackerOrigin); assert.equal(attempt.csrfPresent,false); assert.equal(attempt.cookiePresent,true)
    assert.equal(standalone.writes(), before)
    record('F-BFF-001-Chrome-same-site-cross-Origin-text-plain-form-Cookie-403-write-zero')
    await send('Page.navigate', { url: standalone.origin })
    await until('Boolean(window.bff)', 'same-origin application')
    assert.equal(await evaluate('window.bff.businessWrite()'),200)
    assert.equal(standalone.writes(),before+1)
    record('F-BFF-001-Chrome-same-Origin-current-CSRF-write-success')
  } else if (acceptanceRepair) {
    await send('Network.clearBrowserCookies')
    await send('Page.navigate', { url: standalone.origin })
    await until('Boolean(window.bff) && window.bff.step()==="identifier"', 'registration bootstrap')
    const start = await evaluate('window.bff.registrationStart()')
    assert.equal(start.status, 'PENDING_VERIFICATION')
    assert.match(start.registrationId, /^[A-Za-z0-9_-]{43}$/)
    assert.equal((await evaluate(`window.bff.registrationGet(${JSON.stringify(start.registrationId)})`)).registrationId, start.registrationId)
    assert.equal((await evaluate(`window.bff.registrationAction(${JSON.stringify(start.registrationId)},"challenges")`)).registrationId, start.registrationId)
    assert.equal((await evaluate(`window.bff.registrationAction(${JSON.stringify(start.registrationId)},"complete")`)).status, 'COMPLETED')
    const cancel = await evaluate('window.bff.registrationStart()')
    assert.equal((await evaluate(`window.bff.registrationAction(${JSON.stringify(cancel.registrationId)},"cancel")`)).status, 'CANCELLED')
    assert.equal(await evaluate('fetch("/api/business").then(r=>r.status)'), 401)
    record('A-JS-001-public-React-ConnectedApp-BFF-start-get-challenge-complete-cancel')
    await evaluate('window.bff.mount("signup")')
    await until('Boolean(document.querySelector(\'input[name="new-password"]\'))', 'signup UI')
    await evaluate('window.bff.fill(\'input[name="identifier"]\',"new@example.test")')
    await evaluate('window.bff.fill(\'input[name="new-password"]\',"Strong!Password123")')
    await evaluate('window.bff.fill(\'input[name="confirm-password"]\',"Strong!Password123")')
    await evaluate('window.bff.submit(\'input[name="new-password"]\')')
    await until('Boolean(document.querySelector(\'input[name="registration-code"]\'))', 'signup verification UI')
    await evaluate('window.bff.fill(\'input[name="registration-code"]\',"123456")')
    await evaluate('window.bff.submit(\'input[name="registration-code"]\')')
    await until('window.bff.successes()===1', 'signup UI complete')
    assert.equal(await evaluate('fetch("/api/business").then(r=>r.status)'), 401)
    record('A-JS-001-Embedded-signup-verification-completion-browser')
  } else if (wrongProofOnly) {
    for (const [host, code] of [[standalone, 'UNAUTHORIZED'], [pythonEnvelope, 'SESSION_INVALIDATED']]) {
      for (const entry of ['headless', 'embedded']) {
        await send('Network.clearBrowserCookies')
        await send('Page.navigate', { url: host.origin })
        await until('Boolean(window.bff) && window.bff.step() === "identifier"', 'initial identifier')
        if (entry === 'embedded') {
          await evaluate('window.bff.mount("embedded")')
          await until('Boolean(document.querySelector(\'input[name="identifier"]\'))', 'Embedded initial form')
        }
        assert.equal(await evaluate('fetch("/api/business").then(r=>r.status)'), 401)
        if (entry === 'headless') {
          await evaluate('window.bff.identify()')
          assert.equal(await evaluate('window.bff.password("wrong").catch(e=>e.code)'), code)
          await until('window.bff.step()==="identifier" && window.bff.error()===' + JSON.stringify(code), 'visible 401 error')
        } else {
          await evaluate('window.bff.fill(\'input[name="identifier"]\',"u@example.test")')
          await evaluate('window.bff.fill(\'input[name="password"]\',"wrong")')
          await evaluate('window.bff.submit(\'input[name="password"]\')')
          await until('Boolean(document.querySelector("[role=alert]")?.textContent) && document.querySelector(\'input[name="password"]\')?.value===""', 'Embedded 401 error')
        }
        assert.equal(await evaluate('window.bff.authenticated()'), false)
        assert.equal(await evaluate('window.bff.successes()'), 0)
        assert.equal(await evaluate('fetch("/api/business").then(r=>r.status)'), 401)
        if (entry === 'headless') {
          await evaluate('window.bff.identify()')
          await evaluate('window.bff.password("correct")')
          await until('window.bff.step()==="mfa"', 'retry MFA without stale cancellation')
          await evaluate('window.bff.mfa()')
        } else {
          await evaluate('window.bff.fill(\'input[name="identifier"]\',"u@example.test")')
          await evaluate('window.bff.fill(\'input[name="password"]\',"correct")')
          await evaluate('window.bff.submit(\'input[name="password"]\')')
          await until('Boolean(document.querySelector(\'input[name="mfa"]\'))', 'Embedded retry MFA')
          await evaluate('window.bff.fill(\'input[name="mfa"]\',"123456")')
          await evaluate('window.bff.submit(\'input[name="mfa"]\')')
        }
        await until('window.bff.successes()===1', 'retry completion')
        assert.equal(await evaluate('fetch("/api/business").then(r=>r.status)'), 200)
        fixture.invalidateCredentials()
        assert.equal(await evaluate('window.bff.restore().catch(e=>e.code)'), 'SESSION_INVALIDATED')
        await until('window.bff.authenticated()===false', 'established identity invalidation')
        assert.equal(await evaluate('fetch("/api/business").then(r=>r.status)'), 401)
        const visible = await evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage},cookie:document.cookie,dom:document.body.innerHTML})')
        assert.doesNotMatch(visible, /fixture-at-|fixture-rt-|fixture-confidential|fixture-private-control|codeVerifier|id_token/)
        record('F-JS-001-' + code + '-' + entry + '-401-error-retry-and-established-invalidation')
      }
    }
  } else {
  await send('Page.navigate', { url: standalone.origin })
  await until('Boolean(window.bff) && window.bff.step() === "identifier"', 'Headless identifier')
  await evaluate('window.bff.identify()')
  assert.equal(await evaluate('window.bff.password("wrong").catch(e => e.code)'), 'UNAUTHORIZED')
  await until('window.bff.step()==="identifier"', 'wrong-proof reset')
  await evaluate('window.bff.identify()')
  await evaluate('window.bff.password("correct")')
  await until('window.bff.step() === "mfa"', 'Headless MFA')
  await evaluate('window.bff.mfa()')
  await until('window.bff.successes() === 1', 'Headless completion')
  assert.equal(await evaluate('fetch("/api/business").then(r => r.status)'), 200)
  record('packed-react-Headless-password-error-MFA-business-browser')
  for (const entry of ['embedded', 'dialog']) {
    await evaluate('window.bff.logout()')
    await evaluate(`window.bff.mount(${JSON.stringify(entry)})`)
    await until('Boolean(document.querySelector(\'input[placeholder="you@example.com"]\'))', entry + ' identifier')
    await evaluate('window.bff.fill(\'input[placeholder="you@example.com"]\', "u@example.test")')
    await until('Boolean(document.querySelector(\'input[placeholder="Enter your password"]\'))', entry + ' password')
    await evaluate('window.bff.fill(\'input[placeholder="Enter your password"]\', "correct")')
    await evaluate('window.bff.submit(\'input[placeholder="Enter your password"]\')')
    await until('Boolean(document.querySelector(\'input[name="mfa"]\'))', entry + ' MFA')
    await evaluate('window.bff.fill(\'input[name="mfa"]\', "123456")')
    await evaluate('window.bff.submit(\'input[name="mfa"]\')')
    await until('window.bff.successes() === 1', entry + ' completion')
    assert.equal(await evaluate('fetch("/api/business").then(r => r.status)'), 200)
    record('packed-react-' + entry + '-MFA-business-browser')
  }
  for (const mode of ['mfa', 'success', 'error']) {
    await evaluate('window.bff.logout()')
    await evaluate('window.bff.mount("headless")')
    await until('window.bff.step() === "identifier"', 'Provider start')
    fixture.setProviderMode(mode)
    if (mode === 'error') assert.equal(await evaluate('window.bff.provider().catch(e => e.code)'), 'AUTH_PROVIDER_DENIED')
    else await evaluate('window.bff.provider()')
    if (mode === 'mfa') {
      await until('window.bff.step() === "mfa"', 'Provider required MFA')
      await evaluate('window.bff.mfa()')
      await until('window.bff.successes() === 1', 'Provider MFA completion')
    } else if (mode === 'success') await until('window.bff.successes() === 1', 'Provider code completion')
    else {
      await until('window.bff.step() === "identifier"', 'Provider denial returns to original form')
      assert.equal(await evaluate('fetch("/api/business").then(r => r.status)'), 401)
      await evaluate('window.bff.identify()')
      await evaluate('window.bff.password("correct")')
      await evaluate('window.bff.mfa()')
      await until('window.bff.successes() === 1', 'new login after Provider denial')
    }
    record('packed-react-Provider-' + mode + '-bound-clean-popup-return')
  }
  await evaluate('window.bff.logout()')
  await evaluate('window.bff.mount("headless")')
  await until('window.bff.step() === "identifier"', 'magic start')
  await evaluate('window.bff.identify()')
  await evaluate('window.bff.magic()')
  const magicUrl = fixture.magicCallback()
  await send('Page.navigate', { url: magicUrl })
  await until('location.pathname === "/done" && Boolean(window.bff) && window.bff.step() === "mfa"', 'magic fragment bridge to required MFA')
  assert.equal(await evaluate('location.search + location.hash'), '')
  await evaluate('window.bff.mfa()')
  await until('window.bff.successes() === 1', 'magic completion')
  assert.equal(await evaluate('fetch("/api/business").then(r => r.status)'), 200)
  record('packed-react-email-fragment-removed-CSRF-bridge-MFA-browser')
  await evaluate('window.bff.logout()')
  await evaluate('void window.bff.hosted()')
  await until('location.pathname === "/done" && Boolean(window.bff)', 'Hosted clean callback landing')
  assert.equal(await evaluate('location.search + location.hash'), '')
  assert.equal(await evaluate('fetch("/api/business").then(r => r.status)'), 200)
  const leak = await evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage},cookie:document.cookie,dom:document.body.innerHTML})')
  assert.doesNotMatch(leak, /fixture-at-|fixture-rt-|fixture-confidential|fixture-private-control|codeVerifier|id_token/)
  record('packed-react-Hosted-bootstrap-OIDC-clean-URL-and-browser-secret-scan')
  }
  assert.equal(exceptions.length, 0)
  await writeFile(resolve(businessCsrf ? '../F-BFF-001-results.json' : acceptanceRepair ? '../acceptance-repair-results.json' : wrongProofOnly ? '../F-JS-001-results.json' : '../results.json'), JSON.stringify({ classification: 'CONTROLLED_PROTOCOL_AND_BROWSER_NOT_REAL_IAM',
    results, counts: fixture.counts }, null, 2))
  console.log(JSON.stringify({ pass: true, scenarios: results.map(r => r.scenario), fixture: 'exclusive loopback HTTP, signed ES256 OIDC, Chrome' }))
} finally {
  socket?.close()
  if (chrome) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGTERM'); await exited
  }
  for (const close of resources.reverse()) await close()
  await fixture.close()
}
