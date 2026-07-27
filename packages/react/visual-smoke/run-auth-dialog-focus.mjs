import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../../..')
const fixtureRoot = resolve(import.meta.dirname, 'auth-dialog-focus')
const outputDir = process.env.AUTH_DIALOG_FOCUS_OUTPUT ?? '/tmp/sdk-js-auth-dialog-focus-restoration-artifacts'
const vitePort = Number(process.env.AUTH_DIALOG_FOCUS_VITE_PORT ?? 4327)
const chromePort = Number(process.env.AUTH_DIALOG_FOCUS_CHROME_PORT ?? 9337)
const proxy = 'http://127.0.0.1:7897'
const networkEnv = { ...process.env, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy }
const tempRoot = await mkdtemp(join(tmpdir(), 'sdk-js-auth-dialog-focus-'))
const consumer = join(tempRoot, 'consumer')
const profile = join(tempRoot, 'chrome-profile')
const baseUrl = `http://127.0.0.1:${vitePort}`
const chromeUrl = `http://127.0.0.1:${chromePort}`
const cases = [
  { name: 'desktop-external-backdrop', mode: 'external', width: 1280, height: 800, action: 'backdrop', opener: '#external-opener' },
  { name: 'desktop-external-escape', mode: 'external', width: 1280, height: 800, action: 'escape', opener: '#external-opener' },
  { name: 'mobile-external-close-button', mode: 'external', width: 390, height: 844, action: 'close', opener: '#external-opener' },
  { name: 'desktop-sdk-child-backdrop', mode: 'child', width: 1280, height: 800, action: 'backdrop', opener: '#sdk-opener' },
  { name: 'desktop-disconnected-opener', mode: 'disconnected', width: 1280, height: 800, action: 'disconnect', opener: '#external-opener', disconnected: true },
]

if (cases.length > 5) throw new Error(`AuthDialog focus harness exceeds the five-case budget: ${cases.length}`)

let vite
let chrome
try {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await run('pnpm', ['--filter', '@axis-iam/vertex', 'build'], repoRoot)
  await run('pnpm', ['--filter', '@axis-iam/vertex-react', 'build'], repoRoot)
  await run('pnpm', ['--dir', 'packages/core', 'pack', '--pack-destination', outputDir], repoRoot)
  await run('pnpm', ['--dir', 'packages/react', 'pack', '--pack-destination', outputDir], repoRoot)

  const tarballs = (await readdir(outputDir)).filter((name) => name.endsWith('.tgz'))
  const reactTarball = tarballs.find((name) => name.includes('vertex-react-'))
  const coreTarball = tarballs.find((name) => name.includes('vertex-') && name !== reactTarball)
  if (!coreTarball || !reactTarball || tarballs.length !== 2) throw new Error(`Expected exactly Core and React tarballs, found: ${tarballs.join(', ')}`)

  await mkdir(consumer, { recursive: true })
  await writeFile(join(consumer, 'index.html'), await readFile(join(fixtureRoot, 'index.html')))
  await writeFile(join(consumer, 'src.jsx'), await readFile(join(fixtureRoot, 'src.jsx')))
  await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
    name: 'sdk-js-auth-dialog-focus-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@axis-iam/vertex': `file:${join(outputDir, coreTarball)}`,
      '@axis-iam/vertex-react': `file:${join(outputDir, reactTarball)}`,
      react: '19.2.4',
      'react-dom': '19.2.4',
      vite: '6.4.2',
    },
  }, null, 2)}\n`)
  await writeFile(join(consumer, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n')
  await run('pnpm', ['install'], consumer, networkEnv)

  const lockfile = await readFile(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  for (const required of [coreTarball, reactTarball]) {
    if (!lockfile.includes(required)) throw new Error(`Consumer lockfile does not resolve ${required}`)
  }
  for (const forbidden of ['workspace:', 'link:', repoRoot, '/packages/core', '/packages/react']) {
    if (lockfile.includes(forbidden)) throw new Error(`Consumer lockfile contains forbidden workspace/source reference: ${forbidden}`)
  }

  vite = spawn(join(consumer, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: consumer, stdio: ['ignore', 'ignore', 'inherit'] })
  chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] })
  await waitForHttp(baseUrl)
  await waitForHttp(`${chromeUrl}/json/version`)

  const evidence = []
  for (const item of cases) evidence.push(await runCase(item))
  const artifacts = await Promise.all([coreTarball, reactTarball].map(async (name) => ({
    path: join(outputDir, name),
    sha256: createHash('sha256').update(await readFile(join(outputDir, name))).digest('hex'),
  })))
  const result = { caseCount: evidence.length, cases: evidence, artifacts }
  await writeFile(join(outputDir, 'auth-dialog-focus-evidence.json'), `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await stop(vite)
  await stop(chrome)
  await rm(tempRoot, { recursive: true, force: true })
}

async function runCase(item) {
  const target = await fetch(`${chromeUrl}/json/new?about:blank`, { method: 'PUT' }).then(assertJson)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  const errors = []
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') errors.push(params.args.map((arg) => arg.value ?? arg.description).join(' '))
  })
  cdp.on('Runtime.exceptionThrown', (params) => errors.push(params.exceptionDetails.text))
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: item.width < 600 })
  await cdp.send('Page.navigate', { url: `${baseUrl}/?mode=${item.mode}` })
  await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(item.opener)}) !== null`))
  await clickElement(cdp, item.opener)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]') !== null`))

  const openState = await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); return { closeFocused: document.activeElement?.classList.contains('axis-iam-auth-dialog-close'), pageOverflow: document.documentElement.scrollWidth > innerWidth, dialogOverflow: dialog.scrollWidth > dialog.clientWidth, sensitive: /token|proof|secret/i.test(document.body.innerText) } })()`)
  if (!openState.closeFocused || openState.pageOverflow || openState.dialogOverflow || openState.sensitive) throw new Error(`${item.name} invalid open state: ${JSON.stringify(openState)}`)

  if (item.action === 'backdrop') await clickPoint(cdp, 8, 8)
  if (item.action === 'escape') await pressEscape(cdp)
  if (item.action === 'close') await clickElement(cdp, '.axis-iam-auth-dialog-close')
  if (item.action === 'disconnect') {
    await evaluate(cdp, `document.getElementById('disconnect-opener').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('#external-opener') === null`))
    await pressEscape(cdp)
  }

  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]') === null`))
  const closedState = await evaluate(cdp, `({ openerFocused: ${item.disconnected ? 'true' : `document.activeElement?.matches(${JSON.stringify(item.opener)})`}, activeTag: document.activeElement?.tagName, dialogOpen: document.querySelector('[role="dialog"]') !== null, pageOverflow: document.documentElement.scrollWidth > innerWidth, sensitive: /token|proof|secret/i.test(document.body.innerText) })`)
  if (!closedState.openerFocused || closedState.dialogOpen || closedState.pageOverflow || closedState.sensitive || errors.length > 0) throw new Error(`${item.name} invalid closed state: ${JSON.stringify({ closedState, errors })}`)

  cdp.close()
  await fetch(`${chromeUrl}/json/close/${target.id}`)
  return { name: item.name, viewport: `${item.width}x${item.height}`, openState, closedState, errors }
}

async function clickElement(cdp, selector) {
  const point = await evaluate(cdp, `(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()`)
  await clickPoint(cdp, point.x, point.y)
}

async function clickPoint(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const callback = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) callback.reject(new Error(message.error.message))
      else callback.resolve(message.result)
      return
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params)
  })
  return {
    send(method, params = {}) {
      const nextId = ++id
      socket.send(JSON.stringify({ id: nextId, method, params }))
      return new Promise((resolvePromise, reject) => pending.set(nextId, { resolve: resolvePromise, reject }))
    },
    on(method, listener) { listeners.set(method, [...(listeners.get(method) ?? []), listener]) },
    close() { socket.close() },
  }
}

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error('Timed out waiting for browser condition')
}

async function waitForHttp(url) {
  await waitFor(async () => {
    try { return (await fetch(url)).ok } catch { return false }
  })
}

async function assertJson(response) {
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return response.json()
}

async function run(command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
  const exitCode = await new Promise((resolvePromise) => child.once('exit', resolvePromise))
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await new Promise((resolvePromise) => child.once('exit', resolvePromise))
  }
}
