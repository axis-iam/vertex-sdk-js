import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const repo = resolve(import.meta.dirname, '../../..')
const output = resolve(process.env.AUTH_ENTRIES_OUTPUT ?? join(repo, '.auth-entries-smoke'))
const fixturesOnly = process.argv.includes('--fixtures-only')
if (!fixturesOnly) throw new Error('Unified live authentication smoke awaits the complete backend/Hosted/Provider candidate; use --fixtures-only for protocol fixtures')
const consumer = join(output, 'consumer')
const artifacts = join(output, 'artifacts')
const profile = join(output, 'chrome-profile')
await mkdir(consumer, { recursive: true })
await mkdir(artifacts, { recursive: true })
const environment = {
  ...process.env,
  HTTP_PROXY: 'http://127.0.0.1:7897',
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  http_proxy: 'http://127.0.0.1:7897',
  https_proxy: 'http://127.0.0.1:7897',
}
const commands = []
const run = async (command, args, cwd) => {
  commands.push([command, ...args].join(' '))
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        tail = (tail + chunk).slice(-5000)
      })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${tail}`)),
    )
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
  const files = manifest.split('\n').filter((name) => name && !name.endsWith('/'))
  for (const entry of files) {
    const { stdout: content } = await promisify(execFile)('tar', ['-xOf', file, entry], {
      maxBuffer: 10 * 1024 * 1024,
    })
    if (/\/home\/chaos|TASK-2026|mfa_[a-f0-9]{32}|\.worktrees|workspace:/.test(content))
      throw new Error('Private source or workspace reference in package')
  }
  hashes.push({
    file: file.split('/').at(-1),
    sha256: createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    scannedFiles: files.length,
  })
}
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify(
    {
      private: true,
      type: 'module',
      dependencies: {
        '@axis-iam/vertex': `file:${coreTar}`,
        '@axis-iam/vertex-react': `file:${reactTar}`,
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        esbuild: '^0.25.0',
        typescript: '^5.7.0',
      },
    },
    null,
    2,
  ),
)
await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], consumer)
await writeFile(
  join(consumer, 'consumer.tsx'),
  await readFile(join(import.meta.dirname, '../examples/CustomAuth.tsx')),
)
await run(
  'pnpm',
  [
    'exec',
    'tsc',
    '--noEmit',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--lib',
    'ES2022,DOM',
    'consumer.tsx',
    '--jsx',
    'react-jsx',
  ],
  consumer,
)
await run(
  'node',
  [
    '--input-type=module',
    '-e',
    "import {SessionLifecycle} from '@axis-iam/vertex'; import {OAuthClient,IamTokenRefreshError} from '@axis-iam/vertex-react'; if(!SessionLifecycle||!OAuthClient||!IamTokenRefreshError)process.exit(1)",
  ],
  consumer,
)
await run(
  'node',
  [
    '-e',
    "if(!require('@axis-iam/vertex').SessionLifecycle||!require('@axis-iam/vertex-react').IamTokenRefreshError)process.exit(1)",
  ],
  consumer,
)
await writeFile(
  join(consumer, 'browser.tsx'),
  await readFile(join(import.meta.dirname, 'auth-entries/browser.tsx')),
)
await writeFile(
  join(consumer, 'CustomAuth.tsx'),
  await readFile(join(import.meta.dirname, '../examples/CustomAuth.tsx')),
)
await run(
  'pnpm',
  [
    'exec',
    'esbuild',
    'browser.tsx',
    '--bundle',
    '--platform=browser',
    '--format=esm',
    '--jsx=automatic',
    '--outfile=browser.js',
  ],
  consumer,
)
await run(
  'node',
  [
    '--input-type=module',
    '-e',
    "import {useAuthFlow,AuthFlowStateError} from '@axis-iam/vertex-react'; if(!useAuthFlow||!AuthFlowStateError)process.exit(1); await import('@axis-iam/vertex-react/server').then(()=>{throw new Error('retired export')},e=>{if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw e})",
  ],
  consumer,
)
await run(
  'node',
  [
    '-e',
    "if(!require('@axis-iam/vertex-react').useAuthFlow||!require('@axis-iam/vertex-react').AuthFlowStateError)process.exit(1);try{require('@axis-iam/vertex-react/server');process.exit(1)}catch(e){if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw e}",
  ],
  consumer,
)

const port = Number(process.env.AUTH_ENTRIES_PORT ?? 31427)
const debugPort = Number(process.env.AUTH_ENTRIES_CHROME_PORT ?? 19551)
const origin = `http://127.0.0.1:${port}`
const methods = ['PASSWORD', 'EMAIL_OTP', 'EMAIL_MAGIC_LINK', 'SMS_OTP']
const capabilities = {
  clientId: 'fixture-client',
  passwordLoginEnabled: true,
  emailMagicLinkEnabled: true,
  emailOtpEnabled: true,
  smsOtpEnabled: true,
  socialLoginEnabled: false,
  signupEnabled: true,
  selfRegistrationEnabled: true,
  idpAutoProvisioningEnabled: false,
  loginInitiationUri: null,
  postVerificationRedirectUri: null,
  methods: methods.map((type) => ({
    type,
    enabled: true,
    configured: true,
    availableForLogin: true,
    availableForSignup: type === 'PASSWORD',
    unavailableReason: null,
  })),
  identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_OTP', 'EMAIL_MAGIC_LINK'] }, { kind: 'PHONE', methods: ['PASSWORD', 'SMS_OTP'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }],
  defaultIdentifierKind: 'EMAIL',
  idpProviders: [],
  resend: { emailVerificationCooldownSeconds: 30 },
}
const policy = {
  signupMode: 'OPEN',
  allowedRegistrationGrantTypes: ['ACCESS_CODE'],
  idpAutoProvisioningEnabled: false,
  minPasswordLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecialChar: true,
}
let fixture = {},
  counts = {},
  transaction = null
const jwt = () =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'fixture-user', email: 'member@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture-signature`
const fixtureTokens = () => ({
  access_token: jwt(),
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'controlled-refresh',
})
const json = (response, body, status = 200, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin)
    if (url.pathname === '/' || url.pathname === '/callback') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authentication entries consumer</title><style>body{margin:0}button{font-family:serif;text-transform:uppercase;letter-spacing:4px}input{box-sizing:content-box}h2{margin:80px}</style><script type="module" src="/browser.js"></script>',
      )
      return
    }
    if (url.pathname === '/browser.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' })
      response.end(await readFile(join(consumer, 'browser.js')))
      return
    }
    if (url.pathname.startsWith('/fixture') || url.pathname.startsWith('/api/v1/auth')) {
      const path = url.pathname.startsWith('/fixture') ? url.pathname.slice('/fixture'.length) : url.pathname
      counts[path] = (counts[path] ?? 0) + 1
      if (path.includes('auth-methods') || path.includes('auth-policy')) {
        if (fixture.metadataDelay) await new Promise((resolve) => setTimeout(resolve, fixture.metadataDelay))
        if (path.includes('auth-policy')) return json(response, { ...policy, ...fixture.policy })
        const body = { ...capabilities, ...fixture.capabilities }
        if (fixture.unavailable)
          body.methods = body.methods.map((x) => ({
            ...x,
            availableForLogin: false,
            availableForSignup: false,
          }))
        return json(response, body)
      }
      if (path.endsWith('/openid-configuration'))
        return json(response, {
          issuer: `${origin}/fixture`,
          authorization_endpoint: `${origin}/fixture/authorize`,
          token_endpoint: `${origin}/fixture/token`,
          userinfo_endpoint: `${origin}/fixture/userinfo`,
          jwks_uri: `${origin}/fixture/jwks`,
        })
      if (path.endsWith('/branding')) return json(response, {}, 404)
      if (path.endsWith('/me')) return json(response,{ id: 'fixture-user', email: null, username: null, status:'ACTIVE', emailVerified:true, metadata:{}, authenticationContext:{subjectType:'USER',applicationId:'fixture-app',clientId:'fixture-client',sessionId:'fixture-session',workspaceId:null,workspaceSelectionRequired:true,organizationId:null,organizationSlug:null,organizationRole:null,authTime:null,authenticationMethods:[],assuranceLevel:null,impersonation:null} })
      if (path.endsWith('/permissions'))
        return json(response, {
          applicationId: 'fixture-app',
          organizationId: null,
          roles: [],
          permissions: [],
        })
      if (path.endsWith('/auth/transactions')) {
        const chunks=[];for await(const chunk of request)chunks.push(chunk)
        const binding=JSON.parse(Buffer.concat(chunks).toString())
        transaction={...binding,transactionId:randomBytes(16).toString('hex'),controlSecret:randomBytes(32).toString('base64url'),expiresAt:new Date(Date.now()+600000).toISOString()}
        return json(response,{transactionId:transaction.transactionId,controlSecret:transaction.controlSecret,expiresAt:transaction.expiresAt,nextAction:'authenticate'})
      }
      if (path.includes('/auth/transactions/')) {
        if(!transaction||request.headers['authentication-transaction']!==transaction.controlSecret)return json(response,{error:'UNAUTHORIZED'},401)
        const view=(state,nextAction)=>({transactionId:transaction.transactionId,expiresAt:transaction.expiresAt,state,nextAction})
        if(path.endsWith('/authenticate')){
          if(fixture.loginDelay)await new Promise(resolve=>setTimeout(resolve,fixture.loginDelay))
          if(fixture.loginError)return json(response,{error:'INVALID_CREDENTIALS'},401)
          return json(response,fixture.mfa?view('MFA_REQUIRED','mfa'):view('AUTHENTICATED','complete'))
        }
        if(path.endsWith('/mfa'))return json(response,view('AUTHENTICATED','complete'))
        if(path.endsWith('/cancel'))return json(response,view('CANCELLED','none'))
        if(path.endsWith('/complete'))return json(response,{kind:'authorization_code',code:'fixture-code',state:transaction.state,expiresIn:120})
        if(path.endsWith('/challenges')){
          if(fixture.rateLimit)return json(response,{error:'RATE_LIMITED'},429,{'Retry-After':'7'})
          return json(response,{transactionId:transaction.transactionId,expiresAt:transaction.expiresAt,challengeExpiresAt:new Date(Date.now()+120000).toISOString(),cooldownSeconds:30,nextAction:'authenticate'})
        }
      }
      if(path.endsWith('/token'))return json(response,fixtureTokens())
      if (path.endsWith('/signup'))
        return json(
          response,
          {
            registrationId: 'fixture-registration',
            status: 'PENDING_VERIFICATION',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
            nextAction: 'VERIFY_EMAIL',
            controlSecret: 'fixture-registration-control',
          },
          201,
        )
      if(path.endsWith('/verification/send'))return json(response,{sent:true})
      if (path.endsWith('/logout')) {
        response.writeHead(204)
        response.end()
        return
      }
    }
    json(response, {}, 404)
  } catch {
    if (!response.headersSent) json(response, { error: 'fixture_failed' }, 500)
    else response.end()
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', resolve)
})
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
let socket
const results = [],
  visuals = []
const check = (value, label) => {
  if (!value) throw new Error(label)
}
try {
  let target
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(
        (r) => r.json(),
      )
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  check(target, 'Task browser startup')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0,
    browserErrors = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors++
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    message.error ? item.reject(new Error('Browser protocol failure')) : item.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Browser timeout: ${method}`))
      }, 30_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression, label = 'browser assertion') => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails)
      throw new Error(
        `${label}: ${String(r.exceptionDetails.exception?.description ?? 'failed')
          .replaceAll(password ?? '__absent_password__', '[redacted]')
          .slice(0, 700)}`,
      )
    return r.result?.value
  }
  const call = (name, ...args) => evaluate(`window.entries.${name}(...${JSON.stringify(args)})`, name)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const ready = async () => {
    for (let i = 0; i < 200; i++) {
      try {
        if (await evaluate('Boolean(window.entries)')) return
      } catch {}
      await wait(50)
    }
    throw new Error('Consumer page unavailable')
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: origin })
  await ready()
  const mount = async (config) => {
    await call('mount', config)
    await wait(80)
  }
  const fixtureMount = async (config = {}, settings = {}) => {
    fixture = settings
    counts = {}
    await mount(config)
  }
  const record = (scenario, detail = {}) => results.push({ scenario, pass: true, ...detail })
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `${name}.png`), Buffer.from(result.data, 'base64'))
  }
  await fixtureMount({ entry: 'dialog' }, { loginDelay: 250 })
  await call('dialogRace', 'member@example.invalid', 'Controlled!42')
  record('dialog-flow-ownership', {
    producer: 'controlled fixture',
    livePasswordLogin: !fixturesOnly,
    esc: true,
    triggerFocus: true,
    reopen: true,
    staleResult: true,
  })
  await fixtureMount({ entry: 'custom' }, { unavailable: true })
  check((await call('state')).step === 'unavailable', 'unavailable methods')
  await fixtureMount({ entry: 'custom' }, { policy: { signupMode: 'DISABLED' } })
  await call('action', 'setIntent', 'sign-up')
  check((await call('state')).step === 'unavailable', 'disabled signup')
  await fixtureMount({ entry: 'custom' }, { policy: { signupMode: 'INVITE_REQUIRED' } })
  await call('action', 'setIntent', 'sign-up')
  check(
    !(await call('action', 'signUp', { identifier: { kind: 'EMAIL', value: 'member@example.invalid' }, password: 'Controlled!42' })).ok,
    'registration grant required',
  )
  check(!counts['/api/v1/auth/signup'], 'grant gate did not reach transport')
  await fixtureMount({ entry: 'custom' }, { rateLimit: true })
  await call('customIdentify', 'member@example.invalid')
  await call('action', 'selectMethod', 'email_otp')
  const retry = await call('action', 'sendCode')
  check(retry.status === 429 && (await call('state')).retryAfterSeconds > 0, 'typed retry cooldown')
  for (const method of ['sms', 'email_otp', 'magic_link']) {
    await fixtureMount({entry:'custom'})
    await call('customIdentify', method === 'sms' ? '+15555550123' : 'member@example.invalid')
    await call('action','selectMethod',method)
    check((await call('action', method === 'magic_link' ? 'sendMagicLink' : 'sendCode')).ok, 'controlled method send')
    const proof=method==='magic_link'?`${transaction.redirect_uri}#${new URLSearchParams({kind:'AUTH_PROOF',auth_transaction_id:transaction.transactionId,method:'EMAIL_MAGIC_LINK',state:transaction.state,proof:'controlled-proof'})}`:'controlled-proof'
    const final = await call('action', method === 'magic_link' ? 'completeMagicLink' : 'verifyCode', proof)
    check(final.ok && final.step === 'success', 'controlled method completion')
  }
  record('availability-contract', {
    producer: 'controlled fixture',
    disabled: true,
    unready: true,
    invitationGate: true,
    typed429: true,
    externalSmsAndIdp: 'not live provider proof',
  })
  for (const width of [1280, 390])
    for (const theme of ['light', 'dark']) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: width === 390 ? 844 : 800,
        deviceScaleFactor: 1,
        mobile: width === 390,
      })
      await fixtureMount({
        entry: 'dialog',
        theme,
        locale: theme === 'dark' ? 'zh-CN' : 'en',
        longCopy: theme === 'light',
      })
      await call('click', '[data-axis-auth-view]')
      await wait(100)
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
      })
      const contrast = await call('contrast')
      check(
        contrast.text >= 4.5 && contrast.control >= 3 && contrast.focus >= 3 && !contrast.overflow,
        `contrast/layout ${width}/${theme}`,
      )
      await screenshot(`dialog-${width}-${theme}`)
      visuals.push({ width, theme, ...contrast })
      await evaluate(
        `(()=>{const d=document.querySelector('[role="dialog"]'),buttons=[...d.querySelectorAll('button,input')].filter(e=>!e.disabled);buttons.at(-1).focus()})()`,
      )
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
      })
      check(
        await evaluate('document.activeElement===document.querySelector("[role=dialog] button")'),
        'Tab wraps focus',
      )
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        modifiers: 8,
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        modifiers: 8,
      })
      check(
        await evaluate(
          'document.activeElement===[...document.querySelectorAll("[role=dialog] button,[role=dialog] input")].filter(e=>!e.disabled).at(-1)',
        ),
        'ShiftTab wraps focus',
      )
    }
  await send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })
  await fixtureMount({ entry: 'dialog', theme: 'system' })
  await call('click', '[data-axis-auth-view]')
  await wait(80)
  check(
    await evaluate('document.querySelector("[role=dialog]").dataset.colorScheme==="light"'),
    'system light',
  )
  await send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })
  await wait(100)
  check(
    await evaluate('document.querySelector("[role=dialog]").dataset.colorScheme==="dark"'),
    'system live dark',
  )
  await fixtureMount({ entry: 'dialog', theme: 'light' })
  await call('click', '[data-axis-auth-view]')
  await wait(80)
  check(
    await evaluate('document.querySelector("[role=dialog]").dataset.colorScheme==="light"'),
    'explicit theme override',
  )
  // Each state is rendered by the actual prebuilt form. Only controlled fixture values are used.
  for (const width of [1280, 390])
    for (const theme of ['light', 'dark'])
      for (const name of ['loading', 'unavailable', 'error', 'cooldown', 'mfa', 'verification', 'success']) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height: width === 390 ? 844 : 800,
          deviceScaleFactor: 1,
          mobile: width === 390,
        })
        await fixtureMount(
          { entry: name === 'verification' ? 'signup' : 'embedded', theme },
          name === 'loading'
            ? { metadataDelay: 600 }
            : name === 'unavailable'
              ? { unavailable: true }
              : name === 'error'
                ? { loginError: true }
                : name === 'mfa'
                  ? { mfa: true }
                  : {},
        )
        const contrast = await call('visualState', name)
        check(
          contrast.text >= 4.5 && contrast.control >= 3 && !contrast.overflow,
          `state contrast/layout ${name}/${width}/${theme}`,
        )
        await screenshot(`${name}-${width}-${theme}`)
        visuals.push({ state: name, width, theme, ...contrast })
        check((await call('state')).storage === false, `memory storage ${name}`)
      }
  await fixtureMount({ entry: 'example' })
  check(
    await evaluate('Boolean(document.querySelector("section[aria-label]"))'),
    'public Custom example rendered',
  )
  record('visual-operate-pair', {
    producer: 'controlled fixture',
    visuals,
    systemChange: true,
    explicitOverride: true,
    locales: ['en', 'zh-CN'],
    longCopy: true,
    keyboard: true,
    hostCss: true,
    reducedMotion: true,
    states: ['loading', 'unavailable', 'error', 'cooldown', 'mfa', 'verification', 'success'],
  })
  check(browserErrors === 0, 'unexpected browser exceptions')
  const result = {
    results,
    hashes,
    consumer: 'packed artifacts; ESM/CJS/types/server roots/browser',
    commands,
    fixturesOnly,
  }
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  socket?.close()
  const closed = new Promise((resolve) => chrome.once('exit', resolve))
  chrome.kill('SIGTERM')
  await closed
  await new Promise((resolve) => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
