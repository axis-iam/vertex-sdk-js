import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const repo = resolve(import.meta.dirname, '../../..')
const output = resolve(process.env.SESSION_LIFECYCLE_OUTPUT ?? join(repo, '.lifecycle-smoke'))
const issuer = process.env.IAM_LIFECYCLE_ISSUER
const clientId = process.env.IAM_LIFECYCLE_CLIENT_ID
const identifier = process.env.IAM_LIFECYCLE_IDENTIFIER
const password = process.env.IAM_LIFECYCLE_PASSWORD
const fixturesOnly = process.argv.includes('--fixtures-only')
if (!fixturesOnly && !(issuer && clientId && identifier && password)) throw new Error('The live gate requires IAM_LIFECYCLE_ISSUER/CLIENT_ID/IDENTIFIER/PASSWORD')
const consumer = join(output, 'consumer')
const artifacts = join(output, 'artifacts')
const profile = join(output, 'chrome-profile')
await mkdir(consumer, { recursive: true })
await mkdir(artifacts, { recursive: true })
const environment = { ...process.env, HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897', http_proxy: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897' }
const commands = []
const run = async (command, args, cwd) => {
  commands.push([command, ...args].join(' '))
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { tail = (tail + chunk).slice(-5000) })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${tail}`)))
  })
}
await run('pnpm', ['build'], join(repo, 'packages/core'))
await run('pnpm', ['build'], join(repo, 'packages/react'))
await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages/core'))
await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages/react'))
const coreTar = join(artifacts, 'axis-iam-vertex-0.1.0.tgz')
const reactTar = join(artifacts, 'axis-iam-vertex-react-0.1.0.tgz')
const hashes = []
for (const file of [coreTar, reactTar]) {
  const { stdout: manifest } = await promisify(execFile)('tar', ['-tzf', file])
  if (/\.env|docs\/tasks|node_modules|\.git\//.test(manifest)) throw new Error('Unexpected package content')
  const files = manifest.split('\n').filter(name => name && !name.endsWith('/'))
  for (const entry of files) {
    const { stdout: content } = await promisify(execFile)('tar', ['-xOf', file, entry], { maxBuffer: 10 * 1024 * 1024 })
    if (/\/home\/chaos|TASK-20261015|\.worktrees|workspace:/.test(content)) throw new Error('Private source or workspace reference in package')
  }
  hashes.push({ file: file.split('/').at(-1), sha256: createHash('sha256').update(await readFile(file)).digest('hex'), scannedFiles: files.length })
}
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@axis-iam/vertex': `file:${coreTar}`, '@axis-iam/vertex-react': `file:${reactTar}`, react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', esbuild: '^0.25.0', typescript: '^5.7.0' } }, null, 2))
await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], consumer)
await writeFile(join(consumer, 'consumer.ts'), "import { SessionLifecycle } from '@axis-iam/vertex';\nimport { OAuthClient, IamTokenRefreshError, type IamContextValue } from '@axis-iam/vertex-react';\nconst lifecycle = new SessionLifecycle<number>(); const client = new OAuthClient({issuerUri:'http://localhost',clientId:'consumer',redirectUri:'http://localhost/callback'}); const refresh: IamContextValue['refreshToken'] = () => client.refreshToken(); void lifecycle; void refresh; void IamTokenRefreshError; client.dispose();\n")
await run('pnpm', ['exec', 'tsc', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', 'consumer.ts'], consumer)
await run('node', ['--input-type=module', '-e', "import {SessionLifecycle} from '@axis-iam/vertex'; import {OAuthClient,IamTokenRefreshError} from '@axis-iam/vertex-react'; if(!SessionLifecycle||!OAuthClient||!IamTokenRefreshError)process.exit(1)"], consumer)
await run('node', ['-e', "if(!require('@axis-iam/vertex').SessionLifecycle||!require('@axis-iam/vertex-react').IamTokenRefreshError)process.exit(1)"], consumer)
await writeFile(join(consumer, 'browser.mjs'), await readFile(join(import.meta.dirname, 'session-lifecycle-cases.mjs')))
await run('pnpm', ['exec', 'esbuild', 'browser.mjs', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js'], consumer)

const counts = new Map()
let oauthCookies = ''
const json = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)) }
const port = Number(process.env.SESSION_LIFECYCLE_PORT ?? 31207)
const debugPort = Number(process.env.SESSION_LIFECYCLE_CHROME_PORT ?? 19331)
const origin = `http://127.0.0.1:${port}`
const jwt = subject => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture-signature`
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin)
    if (url.pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>SDK session lifecycle consumer</title><script type="module" src="/browser.js"></script>'); return }
    if (url.pathname === '/browser.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(await readFile(join(consumer, 'browser.js'))); return }
    if (url.pathname === '/counts') return json(response, { count: counts.get(url.searchParams.get('name')) ?? 0 })
    if (url.pathname === '/live/config') return json(response, { enabled: !fixturesOnly, issuer, clientId })
    if (url.pathname === '/live/login') {
      if (fixturesOnly || request.method !== 'POST') return json(response, {}, 404)
      const upstream = await fetch(`${issuer}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password, client_id: clientId }) })
      response.writeHead(upstream.status, { 'Content-Type': 'application/json' })
      response.end(await upstream.text())
      return
    }
    if (url.pathname === '/live/oauth/authorize') {
      if (fixturesOnly || request.method !== 'POST') return json(response, {}, 404)
      let body = ''
      for await (const chunk of request) body += chunk
      const { authorizationUrl } = JSON.parse(body)
      if (new URL(authorizationUrl).origin !== new URL(issuer).origin) throw new Error('Unexpected OAuth issuer')
      const cookies = new Map()
      const capture = res => { for (const cookie of res.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1)) } }
      const headers = () => ({ Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') })
      const page = await fetch(`${issuer}/login?client_id=${encodeURIComponent(clientId)}`, { redirect: 'manual' })
      capture(page)
      const html = await page.text()
      const csrf = /name="(_csrf)"[^>]*value="([^"]+)"/.exec(html)
      if (!csrf) throw new Error('Hosted OAuth login CSRF missing')
      const login = await fetch(`${issuer}/login`, { method: 'POST', redirect: 'manual', headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: identifier, password, [csrf[1]]: csrf[2] }) })
      capture(login)
      if (login.status < 300 || login.status >= 400 || login.headers.get('location')?.includes('error')) throw new Error('Hosted OAuth login rejected')
      const authorization = await fetch(authorizationUrl, { redirect: 'manual', headers: headers() })
      capture(authorization)
      const location = authorization.headers.get('location')
      if (!location) throw new Error(`OAuth authorization did not redirect (${authorization.status})`)
      const callback = new URL(location, issuer)
      if (callback.origin !== origin || !callback.searchParams.get('code')) throw new Error('Public PKCE authorization did not return a code')
      oauthCookies = headers().Cookie
      return json(response, { code: callback.searchParams.get('code'), state: callback.searchParams.get('state') })
    }
    if (url.pathname === '/live/oauth/logout') {
      if (fixturesOnly || request.method !== 'POST') return json(response, {}, 404)
      let body = ''
      for await (const chunk of request) body += chunk
      const { logoutUrl } = JSON.parse(body)
      if (new URL(logoutUrl).origin !== new URL(issuer).origin) throw new Error('Unexpected logout issuer')
      const result = await fetch(logoutUrl, { redirect: 'manual', headers: { Cookie: oauthCookies } })
      oauthCookies = ''
      return json(response, { redirected: result.status >= 300 && result.status < 400 })
    }
    if (url.pathname.endsWith('/openid-configuration')) return json(response, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, userinfo_endpoint: `${origin}/userinfo`, jwks_uri: `${origin}/jwks`, end_session_endpoint: `${origin}/end-session` })
    if (url.pathname.endsWith('/permissions')) return json(response, { applicationId: 'fixture-app', organizationId: null, roles: ['member'], permissions: ['orders:read'] })
    if (url.pathname === '/api/v1/auth/logout') { response.writeHead(204); response.end(); return }
    if (url.pathname === '/api/v1/auth/token/refresh' || url.pathname === '/token') {
      let body = ''
      for await (const chunk of request) body += chunk
      const oauth = url.pathname === '/token'
      const payload = oauth ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body)
      if (oauth && (payload.grant_type !== 'refresh_token' || !String(request.headers['content-type']).includes('application/x-www-form-urlencoded'))) return json(response, {}, 400)
      const match = /^fixture-(.+)-initial$/.exec(payload.refresh_token)
      if (!match) return json(response, { error: 'invalid_grant' }, 400)
      const name = match[1]
      const count = (counts.get(name) ?? 0) + 1
      counts.set(name, count)
      await new Promise(resolve => setTimeout(resolve, name === 'failure' ? 20 : 150))
      if (name === 'failure' && count === 1) return json(response, { error: 'temporarily_unavailable', message: 'fixture-private-marker' }, 503)
      return json(response, { access_token: jwt(name), token_type: 'Bearer', expires_in: 3600, refresh_token: `fixture-${name}-rotated` })
    }
    return json(response, {}, 404)
  } catch { json(response, { error: 'fixture_failed' }, 500) }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
let socket
try {
  let target
  for (let attempt = 0; attempt < 100; attempt++) {
    try { target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json()); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  if (!target) throw new Error('Task browser did not start')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  let browserErrors = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors += 1
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error('Browser protocol command failed'))
    else item.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)) }, 30_000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.navigate', { url: origin })
  let loaded = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await send('Runtime.evaluate', { expression: 'typeof window.runSessionLifecycle === "function"', returnByValue: true })
    if (result.result?.value) { loaded = true; break }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (!loaded) throw new Error('Packed browser consumer did not load')
  const evaluation = await send('Runtime.evaluate', { expression: 'window.runSessionLifecycle()', awaitPromise: true, returnByValue: true })
  if (evaluation.exceptionDetails) throw new Error(`Browser lifecycle failed: ${evaluation.exceptionDetails.exception?.description ?? 'scenario failure'}`)
  if (browserErrors) throw new Error('Browser emitted unexpected runtime exceptions')
  const result = { ...evaluation.result.value, hashes, consumer: 'packed artifacts; ESM/CJS/types/browser', commands }
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  socket?.close()
  const closed = new Promise(resolve => chrome.once('exit', resolve))
  chrome.kill('SIGTERM')
  await closed
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
