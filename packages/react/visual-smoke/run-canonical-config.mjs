import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// This is a bounded protocol fixture, not combined-backend or live IdP acceptance.
const output = process.env.CANONICAL_CONFIG_OUTPUT
if (!output) throw new Error('Set CANONICAL_CONFIG_OUTPUT to a task-owned output directory')
const repo = resolve(import.meta.dirname, '../../..')
const artifacts = join(output, 'artifacts'), consumer = join(output, 'consumer')
await mkdir(artifacts, { recursive: true })
await mkdir(consumer, { recursive: true })
const commands = []
const run = async (command, args, cwd) => {
  const name = `command-${String(commands.length + 1).padStart(2, '0')}.log`
  const item = { command: [command, ...args], cwd, log: name, exit: null }
  commands.push(item)
  const chunks = []
  const code = await new Promise((resolve, reject) => {
    const p = spawn(command, args, { cwd, env: {
      ...process.env, HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897',
      http_proxy: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897',
    }, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', chunk => chunks.push(chunk)); p.stderr.on('data', chunk => chunks.push(chunk))
    p.once('error', reject); p.once('exit', resolve)
  })
  item.exit = code
  await writeFile(join(output, name), Buffer.concat(chunks))
  await writeFile(join(output, 'commands.json'), JSON.stringify(commands, null, 2) + '\n')
  assert.equal(code, 0, `${command} failed; see ${name}`)
}
for (const pkg of ['core', 'react']) await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages', pkg))
const packageRecords = []
for (const file of ['axis-iam-vertex-0.1.0.tgz', 'axis-iam-vertex-react-0.1.0.tgz']) {
  const bytes = await readFile(join(artifacts, file))
  packageRecords.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(join(output, 'packages.json'), JSON.stringify(packageRecords, null, 2) + '\n')
await writeFile(join(consumer, 'package.json'), JSON.stringify({
  private: true, type: 'module', dependencies: {
    '@axis-iam/vertex': `file:${join(artifacts, packageRecords[0].file)}`,
    '@axis-iam/vertex-react': `file:${join(artifacts, packageRecords[1].file)}`,
    react: '19.2.4', 'react-dom': '19.2.4',
  }, devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', typescript: '5.9.3', esbuild: '^0.25.0' },
}, null, 2) + '\n')
await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], consumer)
for (const name of ['CustomAuth', 'AccountSecurity']) await copyFile(join(repo, 'packages/react/examples', `${name}.tsx`), join(consumer, `${name}.tsx`))
await copyFile(join(import.meta.dirname, 'canonical-config/browser.tsx'), join(consumer, 'browser.tsx'))
const typed = `import { createElement } from 'react'
import { IamProvider, SignIn, AccountCenter, AccountSecurityPanel, useAuthFlow, useIdentityProviders } from '@axis-iam/vertex-react'
import type { IamConfig, IamProviderProps, Appearance } from '@axis-iam/vertex-react'
import type { SessionTransport } from '@axis-iam/vertex'
const config = { clientId: 'canonical-client', issuerUri: 'https://iam.example.invalid', redirectUri: '/callback', audience: 'application-resource' } satisfies IamConfig
const appearance: Appearance = { primaryColor: '#164e63', borderRadius: '10px' }
const props = { ...config, appearance, darkAppearance: appearance, colorScheme: 'system', locale: 'zh-CN', localization: { auth: { signIn: 'Host copy' } }, children: null } satisfies IamProviderProps
createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded', renderProviderButton: ({ provider, label, disabled, onClick }) => createElement('button', { disabled, onClick: () => void onClick(), 'data-provider-id': provider.id }, label) }))
const request: SessionTransport = { request: async () => null }
createElement(IamProvider, { ...props, sessionMode: 'server_session', sessionTransport: request })
void [AccountCenter, AccountSecurityPanel, useAuthFlow, useIdentityProviders]
// @ts-expect-error retired option is not a supported config member
const oldMethods: IamConfig = { ...config, authMethods: ['password'] }
// @ts-expect-error retired option is not a supported config member
const oldProviders: IamConfig = { ...config, socialProviders: [] }
// @ts-expect-error retired option is not a provider prop
const oldProps: IamProviderProps = { ...props, socialProviders: [] }
// @ts-expect-error retired provider type has no public export
import type { SocialProviderConfig } from '@axis-iam/vertex-react'
`
await writeFile(join(consumer, 'contract.mts'), typed)
await writeFile(join(consumer, 'contract.cts'), typed)
await run('pnpm', ['exec', 'tsc', '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', '--jsx', 'react-jsx', 'contract.mts', 'contract.cts', 'CustomAuth.tsx', 'AccountSecurity.tsx', 'browser.tsx'], consumer)
const runtime = `import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { OAuthClient, ServerSessionClient, IamConfigurationError, IamProvider, SignIn, AccountCenter, AccountSecurityPanel, useAuthFlow, useIdentityProviders } from '@axis-iam/vertex-react'
import { SessionLifecycle } from '@axis-iam/vertex'
const config = { clientId: 'canonical-client', issuerUri: 'https://iam.example.invalid', redirectUri: '/callback', audience: 'application-resource' }
for (const option of ['authMethods', 'socialProviders']) for (const value of [undefined, [], [{ provider: 'OIDC', clientId: 'retired', displayName: 'Spoofed' }]]) {
 const invalid = { ...config, [option]: value }
 for (const make of [() => new OAuthClient(invalid), () => new ServerSessionClient({ ...invalid, sessionMode: 'server_session', sessionTransport: { request: async () => null } }), () => renderToString(createElement(IamProvider, invalid, null))]) assert.throws(make, error => error instanceof IamConfigurationError && error.message === 'Unsupported IAM configuration option: ' + option)
}
const client = new OAuthClient(config); assert.equal(client.clientId, config.clientId); assert.equal(client.config.audience, config.audience); assert.ok(client.accountSecurity); client.dispose()
assert.ok(SessionLifecycle && AccountCenter && AccountSecurityPanel && useAuthFlow && useIdentityProviders)
const html = renderToString(createElement(IamProvider, { ...config, colorScheme: 'dark', appearance: { primaryColor: '#164e63' }, localization: { auth: { signIn: 'Host label' } } }, createElement(SignIn)))
assert.match(html, /Host label/)
console.log('CANONICAL_PACKAGE_RUNTIME_PASS')
`
await writeFile(join(consumer, 'runtime.mjs'), runtime)
await run('node', ['runtime.mjs'], consumer)
await run('node', ['-e', "const r=require('@axis-iam/vertex-react'),c=require('@axis-iam/vertex');if(!r.OAuthClient||!r.ServerSessionClient||!r.AccountCenter||!c.SessionLifecycle)process.exit(1);for(const key of ['authMethods','socialProviders']){try{new r.OAuthClient({clientId:'c',issuerUri:'https://iam.example.invalid',redirectUri:'/callback',[key]:[]});process.exit(2)}catch(e){if(!(e instanceof r.IamConfigurationError))throw e}}"], consumer)
await run('pnpm', ['exec', 'esbuild', 'browser.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=browser.js'], consumer)

const restrictions = { signup: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } }, login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } } }
let state = 'current', selected = null, origin, requests = [], transaction = null
const provider = (id, displayName, patch = {}) => ({ id, providerType: 'OIDC', displayName, enabled: true, configured: true, clickable: true, availableForLogin: true, availableForSignup: true, unavailableReason: null, authorizationUrl: `${origin}/unused/${id}`, ...patch })
const metadata = () => {
  const password = state !== 'otp-only'
  const providers = [provider('exact-primary', 'Backend Primary'), provider('exact-secondary', 'Backend Secondary'),
    provider('disabled', 'Disabled provider', { enabled: false }), provider('unconfigured', 'Unconfigured provider', { configured: false }),
    provider('unclickable', 'Unclickable provider', { clickable: false }), provider('login-blocked', 'Login blocked', { availableForLogin: false })]
  return { clientId: 'canonical-client', identifierRestrictions: restrictions,
    passwordLoginEnabled: password, emailMagicLinkEnabled: false, emailOtpEnabled: true, smsOtpEnabled: true,
    socialLoginEnabled: true, signupEnabled: false, selfRegistrationEnabled: false, idpAutoProvisioningEnabled: false,
    loginInitiationUri: null, postVerificationRedirectUri: null, allowedSignupIdentifierKinds: [], allowedPasswordIdentifierKinds: ['EMAIL'],
    defaultIdentifierKind: 'EMAIL', defaultLogin: { identifierKind: 'EMAIL', method: password ? 'PASSWORD' : 'EMAIL_OTP' },
    identifierMethods: [{ kind: 'EMAIL', methods: password ? ['PASSWORD', 'EMAIL_OTP'] : ['EMAIL_OTP'] }, { kind: 'PHONE', methods: ['SMS_OTP'] }],
    methods: ['PASSWORD', 'EMAIL_OTP', 'SMS_OTP'].map(type => ({ type, enabled: type !== 'PASSWORD' || password, configured: true, availableForLogin: type !== 'PASSWORD' || password, availableForSignup: false, unavailableReason: null })),
    idpProviders: state === 'empty' ? [] : providers, resend: { emailVerificationCooldownSeconds: 30 },
  }
}
const policy = () => ({ identifierRestrictions: restrictions,
  emailMagicLinkEnabled: false, emailOtpEnabled: true, smsOtpEnabled: true, socialLoginEnabled: true, smsAutoProvisioningEnabled: false,
  totpEnabled: false, webauthnEnabled: false, mfaEnforcement: 'OPTIONAL', stepUpEnabled: false, stepUpTriggers: [], deviceTrustDays: 0, maxTrustedDevices: 0, maxLoginAttempts: 5, lockoutDurationMinutes: 15, progressiveLockout: false, passwordLoginEnabled: metadata().passwordLoginEnabled, allowedPasswordIdentifierKinds: ['EMAIL'],
  defaultLogin: metadata().defaultLogin, allowedSignupIdentifierKinds: [], signupMode: 'DISABLED', allowedRegistrationGrantTypes: [], idpAutoProvisioningEnabled: false,
  minPasswordLength: 10, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecialChar: false, breachedPasswordCheck: false })
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin)
    if (url.pathname === '/' || url.pathname === '/callback') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canonical authentication fixture</title><main id="app" style="padding:16px;max-width:440px;margin:auto"></main><script type="module" src="/browser.js"></script>') }
    if (url.pathname === '/browser.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(await readFile(join(consumer, 'browser.js'))) }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
    if (url.pathname === '/provider-landing') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>Controlled provider landing</p>') }
    requests.push({ path: url.pathname, method: req.method })
    if (url.pathname === '/.well-known/openid-configuration') return json(res, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, userinfo_endpoint: `${origin}/userinfo`, jwks_uri: `${origin}/jwks` })
    if (url.pathname.endsWith('/auth-methods')) return state === 'missing' ? json(res, { error: 'unavailable' }, 503) : json(res, metadata())
    if (url.pathname.endsWith('/auth-policy')) return json(res, policy())
    if (url.pathname.endsWith('/branding')) return json(res, {}, 404)
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk
      const data = JSON.parse(body)
      if (url.pathname === '/api/v1/auth/transactions') {
        transaction = { expiresAt: new Date(Date.now() + 300000).toISOString() }
        return json(res, { transactionId: 'canonical-transaction', controlSecret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', ...transaction, nextAction: 'authenticate' })
      }
      if (url.pathname.endsWith('/canonical-transaction/authorize')) {
        assert.deepEqual(data, { providerId: 'exact-secondary' }); selected = data.providerId
        return json(res, { authorizationUrl: `${origin}/provider-landing`, ...transaction })
      }
      if (url.pathname.endsWith('/cancel')) return json(res, { transactionId: 'canonical-transaction', state: 'CANCELLED', nextAction: 'none', ...transaction })
    }
    return json(res, { error: 'fixture_route_missing' }, 404)
  } catch { return json(res, { error: 'fixture_contract_failed' }, 500) }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(output, 'chrome-profile-'))
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', detached: true })
const exited = new Promise(resolve => chrome.once('exit', resolve))
let socket
const results = [], pending = new Map(), browserErrors = []
let failureSnapshot
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let id = 0
try {
  let debugPort
  for (let attempt = 0; attempt < 100; attempt++) {
    try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (debugPort) break } catch (error) { if (error.code !== 'ENOENT') throw error }
    await wait(50)
  }
  assert.ok(debugPort, 'owned Chrome debugger ready')
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (m.method === 'Runtime.exceptionThrown') browserErrors.push(m.params.exceptionDetails.text)
    const p = pending.get(m.id); if (!p) return
    pending.delete(m.id); clearTimeout(p.timer)
    m.error ? p.reject(new Error('Browser protocol error')) : p.resolve(m.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }))
  })
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, r.exceptionDetails?.text); return r.result?.value }
  const until = async (expression, label) => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await wait(40) } failureSnapshot = await evaluate('({url:location.href,text:document.body.innerText})'); throw new Error(label) }
  const snapshot = () => evaluate(`({ text: document.body.innerText, buttons: [...document.querySelectorAll('button')].map(b=>({text:b.textContent, disabled:b.disabled})), overflow: document.documentElement.scrollWidth > innerWidth, primary: [...document.querySelectorAll('button')].some(b=>getComputedStyle(b).backgroundColor==='rgb(22, 78, 99)'), hostStyle: document.getElementById('app')?.getAttribute('style') })`)
  await send('Runtime.enable'); await send('Page.enable')
  for (const entry of ['embedded', 'dialog', 'custom']) {
    for (const scenario of [{ fixture: 'current', locale: 'en' }, { fixture: 'empty', locale: 'en' }, { fixture: 'missing', locale: 'en' }, { fixture: 'otp-only', locale: 'en' }, { fixture: 'current', locale: 'zh-CN' }]) {
      const { fixture, locale } = scenario
      state = fixture; selected = null; requests = []; transaction = null
      const width = (entry === 'dialog') === (locale === 'en') ? 390 : 1280
      const theme = locale === 'zh-CN' ? entry === 'dialog' ? 'system' : entry === 'custom' ? 'light' : 'dark' : entry === 'dialog' ? 'dark' : entry === 'custom' ? 'system' : 'light'
      await send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width === 390 })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
      await send('Page.navigate', { url: `${origin}/?fixture=${fixture}&entry=${entry}&theme=${theme}&locale=${locale}` })
      await until(`location.search.includes('fixture=${fixture}') && location.search.includes('locale=${locale}') && !!document.getElementById('app')`, 'fresh consumer document')
      if (entry === 'dialog') { await until(`!!document.querySelector('[data-axis-auth-view]')`, 'dialog opener'); await evaluate(`document.querySelector('[data-axis-auth-view]').click()`) }
      await until(`document.body.innerText.includes(${JSON.stringify(fixture === 'missing' ? entry === 'custom' ? 'Authentication is unavailable.' : 'Retry' : fixture === 'empty' ? entry === 'custom' ? 'EMAIL' : 'Email' : 'Backend Secondary')})`, `${entry}/${fixture} resolved state`)
      const value = await snapshot()
      failureSnapshot = { entry, fixture, locale, theme, ...value }
      for (const label of ['Disabled provider', 'Unconfigured provider', 'Unclickable provider', 'Login blocked']) assert.ok(!value.text.includes(label), `${entry}: ${label} hidden`)
      if (fixture === 'empty' || fixture === 'missing') assert.ok(!value.text.includes('Backend Primary'), 'no invented provider')
      if (fixture === 'missing') {
        assert.ok(value.text.includes('Retry'), 'explicit unavailable retry')
        assert.ok(!value.text.includes('unavailable raw backend details'), 'safe unavailable copy')
        assert.equal(await evaluate('document.querySelectorAll("input").length'), 0, 'missing discovery has no credential form')
      }
      if (fixture === 'current' || fixture === 'otp-only') {
        assert.ok(value.text.includes('Backend Primary') && value.text.includes('Backend Secondary'), 'backend labels preserved')
        if (fixture === 'otp-only') assert.ok(!value.buttons.some(x => x.text === 'Password' || x.text === 'password'), 'password not resurrected')
      }
      assert.equal(value.overflow, false, 'container fits viewport')
      assert.match(value.hostStyle, /max-width:440px/, 'host container unchanged')
      if (entry !== 'custom' && fixture === 'current') assert.ok(value.primary, 'host primary appearance retained')
      if (fixture === 'current') {
        const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await writeFile(join(output, `${entry}-${locale}-${width}.png`), Buffer.from(capture.data, 'base64'))
        await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Backend Secondary')).click()`)
        await until(`location.pathname === '/provider-landing'`, `${entry} exact provider landing`)
        assert.equal(selected, 'exact-secondary')
        assert.ok(requests.some(x => x.path.endsWith('/canonical-transaction/authorize')), 'real packed transport reached fixture')
      }
      results.push({ entry, fixture, pass: true, width, theme, locale, selected, labels: fixture === 'current' ? ['Backend Primary', 'Backend Secondary'] : undefined })
    }
  }
  assert.deepEqual(browserErrors, [], 'no uncaught browser exceptions')
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ classification: 'BOUNDED_PROTOCOL_FIXTURE_NOT_COMBINED_BACKEND', origin, chromePid: chrome.pid, packageRecords, results, browserErrors }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'CANONICAL_CONFIG_PASS', scenarios: results.length, packages: packageRecords, consumer }))
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, failureSnapshot, completed: results, requests }, null, 2) + '\n')
  throw error
} finally {
  for (const p of pending.values()) clearTimeout(p.timer)
  socket?.close()
  try { process.kill(-chrome.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await exited
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await writeFile(join(output, 'resource-release.json'), JSON.stringify({ serverClosed: !server.listening, chromeExited: chrome.exitCode !== null || chrome.signalCode !== null, pid: chrome.pid }, null, 2) + '\n')
}
