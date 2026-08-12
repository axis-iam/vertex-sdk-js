import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const taskRoot = join(repository, '.task-tmp/web-bff-pkce')
const artifacts = join(taskRoot, 'artifacts')
const consumer = join(taskRoot, 'consumer')
const proxy = 'http://127.0.0.1:7897'
const environment = {
  ...process.env,
  HTTP_PROXY: process.env.HTTP_PROXY ?? proxy,
  HTTPS_PROXY: process.env.HTTPS_PROXY ?? proxy,
  http_proxy: process.env.http_proxy ?? proxy,
  https_proxy: process.env.https_proxy ?? proxy,
}

rmSync(taskRoot, { recursive: true, force: true })
mkdirSync(artifacts, { recursive: true })
mkdirSync(consumer, { recursive: true })
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'web-bff-packed-consumer', private: true, type: 'module' }, null, 2))
writeFileSync(join(consumer, 'pnpm-workspace.yaml'), "packages: []\n")

try {
  run('pnpm', ['pack', '--pack-destination', artifacts], join(repository, 'packages/core'))
  const coreTarball = join(artifacts, 'axis-iam-vertex-0.1.0.tgz')
  run('pnpm', ['--dir', consumer, '--ignore-workspace', 'add', coreTarball], repository)
  run('pnpm', ['pack', '--pack-destination', artifacts], join(repository, 'packages/express'))
  const expressTarball = join(artifacts, 'axis-iam-vertex-express-0.1.0.tgz')
  run('pnpm', ['--dir', consumer, '--ignore-workspace', 'add', expressTarball, 'express@5.1.0'], repository)

  const packageJson = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'))
  const dependencyValues = Object.values(packageJson.dependencies ?? {})
  assert(dependencyValues.every(value => !String(value).startsWith('workspace:') && !String(value).startsWith('link:')), 'consumer dependency graph contains workspace/link fallback')

  for (const tarball of [coreTarball, expressTarball]) {
    const manifest = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex')
    assert(!manifest.includes('.task-tmp') && !manifest.includes('docs/tasks') && !manifest.includes('/home/'), 'artifact manifest contains internal paths')
    assert(!readFileSync(tarball).includes(Buffer.from('runtime-client-secret')), 'artifact contains runtime secret')
    process.stdout.write(`ARTIFACT ${tarball.slice(artifacts.length + 1)} sha256=${digest} files=${manifest.trim().split('\n').length}\n`)
  }

  writeFileSync(join(consumer, 'runtime.mjs'), runtimeSource())
  const output = execFileSync(process.execPath, ['runtime.mjs'], { cwd: consumer, env: environment, encoding: 'utf8' })
  assert(output.includes('PACKED_WEB_BFF_PKCE_RUNTIME_PASS'), 'packed runtime did not report success')
  const forbidden = ['runtime-client-secret', 'verifier-value', 'access-token-value', 'refresh-token-value', 'id-token-value']
  for (const value of forbidden) assert(!output.includes(value), `runtime output exposed ${value}`)
  process.stdout.write(output)
} finally {
  rmSync(taskRoot, { recursive: true, force: true })
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: environment, stdio: 'inherit' })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runtimeSource() {
  return String.raw`
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import express from 'express'
import { createWebAuth } from '@axis-iam/vertex-express'

const CLIENT_ID = 'runtime-web-client'
const CLIENT_SECRET = 'runtime-client-secret'
const ACCESS_1 = 'access-token-value-1'
const ACCESS_2 = 'access-token-value-2'
const REFRESH_1 = 'refresh-token-value-1'
const REFRESH_2 = 'refresh-token-value-2'
const ID_TOKEN = 'id-token-value'
const transactions = new Map()
const sessions = new Map()
const codes = new Map()
const visible = []
let refreshCount = 0

const transactionStore = {
  async save(id, value) { transactions.set(id, value) },
  async consume(id) { const value = transactions.get(id) ?? null; transactions.delete(id); return value },
}
const sessionStore = {
  async create(id, value) { sessions.set(id, value) },
  async read(id) { return sessions.get(id) ?? null },
  async replace(id, expected, value) {
    if (sessions.get(id)?.revision !== expected) return false
    sessions.set(id, value); return true
  },
  async delete(id) { sessions.delete(id) },
}

const oauth = createServer(async (req, res) => {
  const base = 'http://' + req.headers.host
  const url = new URL(req.url, base)
  if (url.pathname === '/.well-known/openid-configuration') {
    json(res, 200, { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', jwks_uri: base + '/jwks', end_session_endpoint: base + '/end-session' })
    return
  }
  if (url.pathname === '/authorize') {
    assert(url.searchParams.get('response_type') === 'code', 'response_type')
    assert(url.searchParams.get('code_challenge_method') === 'S256', 'S256 method')
    assert(url.searchParams.get('redirect_uri') === appOrigin + '/auth/callback', 'exact redirect')
    const code = 'code-' + codes.size
    codes.set(code, { challenge: url.searchParams.get('code_challenge'), used: false })
    const callback = new URL(url.searchParams.get('redirect_uri'))
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', url.searchParams.get('state'))
    callback.searchParams.set('returnTo', 'https://evil.example.test')
    res.writeHead(302, { location: callback.toString() }); res.end(); return
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const expectedBasic = 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
    if (req.headers.authorization !== expectedBasic) { json(res, 401, { error: 'invalid_client', error_description: 'secret upstream body' }); return }
    const form = new URLSearchParams(await body(req))
    if (form.has('client_secret') || form.has('client_id')) { json(res, 400, { error: 'invalid_request' }); return }
    if (form.get('grant_type') === 'authorization_code') {
      const record = codes.get(form.get('code'))
      const actual = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
      if (!record || record.used || actual !== record.challenge || form.get('redirect_uri') !== appOrigin + '/auth/callback') { json(res, 400, { error: 'invalid_grant' }); return }
      record.used = true
      json(res, 200, { access_token: ACCESS_1, refresh_token: REFRESH_1, id_token: ID_TOKEN, token_type: 'Bearer', expires_in: 300 }); return
    }
    if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === REFRESH_1) {
      refreshCount += 1
      json(res, 200, { access_token: ACCESS_2, refresh_token: REFRESH_2, id_token: ID_TOKEN, token_type: 'Bearer', expires_in: 300 }); return
    }
    json(res, 400, { error: 'invalid_grant' }); return
  }
  if (url.pathname === '/end-session') { res.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') }); res.end(); return }
  res.writeHead(404); res.end()
})
oauth.listen(0, '127.0.0.1'); await once(oauth, 'listening')
const issuer = 'http://127.0.0.1:' + oauth.address().port

const app = express()
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
const appOrigin = 'http://127.0.0.1:' + server.address().port
const auth = createWebAuth({
  issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  redirectUri: appOrigin + '/auth/callback', applicationOrigin: appOrigin,
  successRedirect: '/dashboard', postLogoutRedirect: '/signed-out',
  transactionStore, sessionStore, secureCookies: false,
  transactionCookieName: 'axis_vertex_tx', sessionCookieName: 'axis_vertex_session',
})
app.get('/auth/login', auth.login)
app.get('/auth/callback', auth.callback)
app.post('/auth/refresh', auth.refresh)
app.post('/auth/logout', auth.logout)
app.get('/session', auth.requireSession, (req, res) => res.json({ authenticated: true, expiresAt: req.webAuthSession.expiresAt }))
app.get('/dashboard', (_req, res) => res.end('dashboard'))
app.get('/signed-out', (_req, res) => res.end('signed-out'))

try {
  const login = await request(appOrigin + '/auth/login')
  assert(login.status === 302, 'login status')
  const transactionCookie = cookieFrom(login, 'axis_vertex_tx')
  assert(transactionCookie.attributes.includes('httponly') && transactionCookie.attributes.includes('samesite=lax') && transactionCookie.attributes.includes('path=/auth/callback'), 'transaction cookie attributes')
  const authorize = await request(login.location)
  const callbackUrl = authorize.location
  const callback = await request(callbackUrl, { cookie: transactionCookie.pair })
  assert(callback.status === 302 && callback.location === appOrigin + '/dashboard', 'fixed success redirect')
  const sessionCookie = cookieFrom(callback, 'axis_vertex_session')
  assert(sessionCookie.attributes.includes('httponly') && sessionCookie.attributes.includes('samesite=lax') && sessionCookie.attributes.includes('path=/'), 'session cookie attributes')
  assert(!sessionCookie.pair.includes(ACCESS_1) && !sessionCookie.pair.includes(REFRESH_1) && !sessionCookie.pair.includes(ID_TOKEN), 'opaque session cookie')
  assert(sessions.size === 1, 'server session created')

  const session = await request(appOrigin + '/session', { cookie: sessionCookie.pair })
  assert(session.status === 200 && session.text.includes('authenticated'), 'requireSession')
  const replay = await request(callbackUrl, { cookie: transactionCookie.pair })
  assert(replay.status === 400 && sessions.size === 1, 'callback replay')
  const refresh = await request(appOrigin + '/auth/refresh', { method: 'POST', cookie: sessionCookie.pair })
  assert(refresh.status === 200 && refresh.text === '{"ok":true}' && refreshCount === 1, 'refresh response')
  assert([...sessions.values()][0].tokens.refreshToken === REFRESH_2, 'rotated refresh token')

  const wrongVerifierLogin = await request(appOrigin + '/auth/login')
  const wrongVerifierCookie = cookieFrom(wrongVerifierLogin, 'axis_vertex_tx')
  const wrongAuthorize = await request(wrongVerifierLogin.location)
  const transactionId = wrongVerifierCookie.pair.split('=')[1]
  transactions.get(transactionId).codeVerifier = 'verifier-value-wrong'
  const wrongVerifierCallback = await request(wrongAuthorize.location, { cookie: wrongVerifierCookie.pair })
  assert(wrongVerifierCallback.status === 400 && sessions.size === 1, 'wrong verifier creates no session')

  const badTransactions = new Map()
  const badAuth = createWebAuth({
    issuer, clientId: CLIENT_ID, clientSecret: 'wrong-runtime-secret',
    redirectUri: appOrigin + '/auth/callback', applicationOrigin: appOrigin,
    successRedirect: '/dashboard', postLogoutRedirect: '/signed-out',
    transactionStore: { async save(id, value) { badTransactions.set(id, value) }, async consume(id) { const value = badTransactions.get(id) ?? null; badTransactions.delete(id); return value } },
    sessionStore, secureCookies: false, transactionCookieName: 'bad_tx', sessionCookieName: 'bad_session',
  })
  app.get('/bad/login', badAuth.login); app.get('/bad/callback', badAuth.callback)
  const badLogin = await request(appOrigin + '/bad/login')
  const badCookie = cookieFrom(badLogin, 'bad_tx')
  const badAuthorize = await request(badLogin.location)
  const badCallback = await request(badAuthorize.location.replace('/auth/callback', '/bad/callback'), { cookie: badCookie.pair })
  assert(badCallback.status === 400 && sessions.size === 1, 'invalid secret creates no session')

  const failingAuth = createWebAuth({
    issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    redirectUri: appOrigin + '/auth/callback', applicationOrigin: appOrigin,
    successRedirect: '/dashboard', postLogoutRedirect: '/signed-out',
    transactionStore: { async save() { throw new Error('store payload secret') }, async consume() { return null } },
    sessionStore, secureCookies: false, transactionCookieName: 'fail_tx', sessionCookieName: 'fail_session',
  })
  app.get('/fail/login', failingAuth.login)
  const storeFailure = await request(appOrigin + '/fail/login')
  assert(storeFailure.status === 503 && !storeFailure.text.includes('store payload secret'), 'store failure sanitized')

  const logout = await request(appOrigin + '/auth/logout', { method: 'POST', cookie: sessionCookie.pair })
  assert(logout.status === 302 && logout.location.startsWith(issuer + '/end-session'), 'upstream logout redirect')
  assert(sessions.size === 0, 'local logout first')
  await new Promise(resolve => oauth.close(resolve))
  const stale = await request(appOrigin + '/session', { cookie: sessionCookie.pair })
  assert(stale.status === 401, 'logged-out cookie unusable when upstream unavailable')

  const forbidden = [CLIENT_SECRET, 'verifier-value-wrong', ACCESS_1, ACCESS_2, REFRESH_1, REFRESH_2, ID_TOKEN, 'secret upstream body', 'store payload secret']
  for (const item of forbidden) assert(visible.every(value => !value.includes(item)), 'browser-visible sensitive value')
  process.stdout.write('PACKED_WEB_BFF_PKCE_RUNTIME_PASS scenarios=login,callback,session,replay,refresh,wrong-verifier,wrong-secret,store-failure,logout-upstream-unavailable\n')
} finally {
  if (oauth.listening) await new Promise(resolve => oauth.close(resolve))
  await new Promise(resolve => server.close(resolve))
}

async function request(url, options = {}) {
  const response = await fetch(url, { method: options.method ?? 'GET', headers: options.cookie ? { cookie: options.cookie } : {}, redirect: 'manual' })
  const text = await response.text()
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)
  const result = { status: response.status, location: response.headers.get('location'), text, setCookies }
  visible.push(url, result.location ?? '', text, ...setCookies)
  return result
}

function cookieFrom(response, name) {
  const line = response.setCookies.find(value => value.startsWith(name + '='))
  assert(line, 'missing cookie ' + name)
  const parts = line.split(';').map(value => value.trim())
  return { pair: parts[0], attributes: parts.slice(1).map(value => value.toLowerCase()) }
}

async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8') }
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
function assert(condition, message) { if (!condition) throw new Error(message) }
`
}
