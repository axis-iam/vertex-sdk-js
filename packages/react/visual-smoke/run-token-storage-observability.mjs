import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../../..')
const fixtureRoot = resolve(import.meta.dirname, 'token-storage-observability')
const taskRoot = join(repoRoot, '.task-tmp/token-storage-observability')
const outputDir = join(taskRoot, 'artifacts')
const consumer = join(taskRoot, 'consumer')
const vendorDir = join(taskRoot, 'vendor')
const profile = join(taskRoot, 'chrome-profile')
const baseUrl = 'http://127.0.0.1:4328'
const chromeUrl = 'http://127.0.0.1:9338'
const sensitiveMarker = 'SENSITIVE_TOKEN_MARKER'
const cases = ['memory', 'read', 'write', 'remove', 'corrupt', 'valid']

let vite
let chrome
try {
  await rm(taskRoot, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await run('pnpm', ['--filter', '@axis-iam/vertex', 'build'], repoRoot)
  await run('pnpm', ['--filter', '@axis-iam/vertex-react', 'build'], repoRoot)
  await run('pnpm', ['--dir', 'packages/core', 'pack', '--pack-destination', outputDir], repoRoot)
  await run('pnpm', ['--dir', 'packages/react', 'pack', '--pack-destination', outputDir], repoRoot)

  const tarballs = (await readdir(outputDir)).filter(name => name.endsWith('.tgz'))
  const reactTarball = tarballs.find(name => name.includes('vertex-react-'))
  const coreTarball = tarballs.find(name => name.includes('vertex-') && name !== reactTarball)
  if (!coreTarball || !reactTarball || tarballs.length !== 2) throw new Error(`Expected exactly Core and React tarballs, found: ${tarballs.join(', ')}`)
  const artifacts = await Promise.all(tarballs.sort().map(async name => ({
    name,
    sha256: createHash('sha256').update(await readFile(join(outputDir, name))).digest('hex'),
  })))
  await scanTarballs(tarballs)

  await mkdir(consumer, { recursive: true })
  await writeFile(join(consumer, 'index.html'), await readFile(join(fixtureRoot, 'index.html')))
  await writeFile(join(consumer, 'src.jsx'), await readFile(join(fixtureRoot, 'src.jsx')))
  const coreTarballPath = relative(consumer, join(outputDir, coreTarball))
  const reactTarballPath = relative(consumer, join(outputDir, reactTarball))
  const vendor = await packLockedRuntimeDependencies()
  await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
    name: 'sdk-js-token-storage-observability-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@axis-iam/vertex': `file:${coreTarballPath}`,
      '@axis-iam/vertex-react': `file:${reactTarballPath}`,
      react: `file:${relative(consumer, vendor.react)}`,
      'react-dom': `file:${relative(consumer, vendor.reactDom)}`,
    },
    pnpm: {
      overrides: {
        jose: `file:${relative(consumer, vendor.jose)}`,
        'lru-cache': `file:${relative(consumer, vendor.lruCache)}`,
        scheduler: `file:${relative(consumer, vendor.scheduler)}`,
      },
    },
  }, null, 2)}\n`)
  await writeFile(join(consumer, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n")
  await run('pnpm', ['install', '--offline'], consumer)
  const consumerProof = await verifyTarballConsumer({ coreTarball, reactTarball })

  const vitestPackage = await realpath(join(repoRoot, 'packages/react/node_modules/vitest'))
  const viteCli = await realpath(join(dirname(vitestPackage), 'vite/bin/vite.js'))
  vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '4328', '--strictPort'], { cwd: consumer, stdio: ['ignore', 'ignore', 'inherit'] })
  chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9338', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] })
  await waitForHttp(baseUrl)
  await waitForHttp(`${chromeUrl}/json/version`)

  const evidence = []
  for (const name of cases) evidence.push(await runCase(name))
  const result = { caseCount: evidence.length, cases: evidence, artifacts, consumerProof }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await stop(vite)
  await stop(chrome)
  await rm(taskRoot, { recursive: true, force: true })
}

async function runCase(name) {
  const target = await fetch(`${chromeUrl}/json/new?about:blank`, { method: 'PUT' }).then(assertJson)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  const output = []
  cdp.on('Runtime.consoleAPICalled', params => output.push(params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')))
  cdp.on('Runtime.exceptionThrown', params => output.push(params.exceptionDetails.text ?? 'runtime exception'))
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: `${baseUrl}/?mode=${name}` })
  let result
  if (name === 'memory') {
    result = await runMemoryCase(cdp)
  } else {
    await waitFor(async () => await evaluate(cdp, 'window.__result !== undefined || window.__runScenario !== undefined'))
    if (name === 'remove') {
      await waitFor(async () => (await evaluate(cdp, 'window.__authObservation?.authenticated')) === true)
      const beforeClear = await evaluate(cdp, 'window.__authObservation')
      await evaluate(cdp, 'window.__runScenario()')
      await waitFor(async () => (await evaluate(cdp, 'window.__authObservation?.authenticated')) === false)
      result = await evaluate(cdp, `({
        ...window.__result,
        authenticatedBeforeClear: ${JSON.stringify(beforeClear.authenticated)},
        accessTokenPresentBeforeClear: ${JSON.stringify(beforeClear.accessTokenPresent)},
        authenticatedAfterClear: window.__authObservation.authenticated,
        accessTokenPresentAfterClear: window.__authObservation.accessTokenPresent,
        authTransitions: window.__authTransitions,
      })`)
    } else {
      if (name === 'write') await evaluate(cdp, 'window.__runScenario()')
      if (name === 'valid') await waitFor(async () => (await evaluate(cdp, 'window.__result?.loaded')) === true)
      result = await evaluate(cdp, 'window.__result')
    }
  }
  const visibleText = await evaluate(cdp, 'document.body.innerText')
  assertCase(name, result)
  const serializedOutput = JSON.stringify({ result, visibleText, output })
  if (serializedOutput.includes(sensitiveMarker) || /SecurityError|denied SENSITIVE/i.test(serializedOutput)) {
    throw new Error(`${name} exposed sensitive storage details`)
  }
  cdp.close()
  await fetch(`${chromeUrl}/json/close/${target.id}`)
  return { name, result, consoleEntryCount: output.length }
}

function assertCase(name, result) {
  if (name === 'memory' && (!result.ok || !result.loaded || !result.authenticatedBeforeClear || result.authenticatedAfterClear || result.accessTokenPresentAfterClear || JSON.stringify(result.authTransitions) !== JSON.stringify([false, true, false]) || Object.values(result.storageCalls).some(Boolean))) throw new Error(`Invalid memory result: ${JSON.stringify(result)}`)
  if (name === 'valid' && (!result.ok || !result.loaded || !result.authenticated)) throw new Error(`Invalid valid-reload result: ${JSON.stringify(result)}`)
  if (name === 'read' && (result.errorName !== 'IamConfigurationError' || result.errorMessage !== 'Token session storage read failed')) throw new Error(`Invalid read result: ${JSON.stringify(result)}`)
  if (name === 'write' && (result.errorName !== 'IamConfigurationError' || result.errorMessage !== 'Token session storage write failed' || result.authenticated || result.canonicalPresent)) throw new Error(`Invalid write result: ${JSON.stringify(result)}`)
  if (name === 'remove' && (result.errorName !== 'IamConfigurationError' || result.errorMessage !== 'Token session storage removal failed' || !result.authenticatedBeforeClear || !result.accessTokenPresentBeforeClear || result.authenticatedAfterClear || result.accessTokenPresentAfterClear || !result.canonicalPresent)) throw new Error(`Invalid remove result: ${JSON.stringify(result)}`)
  if (name === 'corrupt' && (result.errorName !== 'IamConfigurationError' || result.errorMessage !== 'Stored token session is invalid')) throw new Error(`Invalid corrupt result: ${JSON.stringify(result)}`)
}

async function runMemoryCase(cdp) {
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[type="text"]') !== null`))
  await setInput(cdp, 'input[type="text"]', 'memory@example.test')
  await evaluate(cdp, `document.querySelector('input[type="text"]').form.requestSubmit()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[type="password"]') !== null`))
  await setInput(cdp, 'input[type="password"]', 'packed-password')
  await evaluate(cdp, `document.querySelector('input[type="password"]').form.requestSubmit()`)
  await waitFor(async () => (await evaluate(cdp, 'window.__memorySignInCompleted === true && window.__authObservation?.authenticated === true')))
  const beforeClear = await evaluate(cdp, 'window.__authObservation')
  await evaluate(cdp, 'window.__clearMemory()')
  await waitFor(async () => (await evaluate(cdp, 'window.__authObservation?.authenticated')) === false)
  return await evaluate(cdp, `({
    ok: true,
    loaded: window.__authObservation.loaded,
    authenticatedBeforeClear: ${JSON.stringify(beforeClear.authenticated)},
    accessTokenPresentBeforeClear: ${JSON.stringify(beforeClear.accessTokenPresent)},
    authenticatedAfterClear: window.__authObservation.authenticated,
    accessTokenPresentAfterClear: window.__authObservation.accessTokenPresent,
    authTransitions: window.__authTransitions,
    storageCalls: window.__storageCalls,
  })`)
}

async function setInput(cdp, selector, value) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
}

async function scanTarballs(tarballs) {
  for (const tarball of tarballs) {
    const listing = await capture('tar', ['-tzf', join(outputDir, tarball)], repoRoot)
    for (const forbidden of ['.task-tmp', 'docs/tasks/', '.env', 'node_modules/', '.git/']) {
      if (listing.includes(forbidden)) throw new Error(`${tarball} contains forbidden path ${forbidden}`)
    }
    const content = await capture('tar', ['-xOzf', join(outputDir, tarball)], repoRoot)
    for (const forbidden of [repoRoot, sensitiveMarker, 'BEGIN PRIVATE KEY', 'npm_']) {
      if (content.includes(forbidden)) throw new Error(`${tarball} contains sensitive/internal marker`)
    }
  }
}

async function packLockedRuntimeDependencies() {
  await mkdir(vendorDir, { recursive: true })
  const reactSource = await realpath(join(repoRoot, 'packages/react/node_modules/react'))
  const reactDomSource = await realpath(join(repoRoot, 'packages/react/node_modules/react-dom'))
  const sources = [
    reactSource,
    reactDomSource,
    await realpath(join(dirname(reactDomSource), 'scheduler')),
    await realpath(join(repoRoot, 'packages/core/node_modules/jose')),
    await realpath(join(repoRoot, 'packages/core/node_modules/lru-cache')),
  ]
  for (const source of sources) await run('npm', ['pack', '--ignore-scripts', '--pack-destination', vendorDir], source)
  const tarballs = await readdir(vendorDir)
  const findTarball = (prefix) => {
    const matches = tarballs.filter(name => name.startsWith(prefix) && name.endsWith('.tgz'))
    if (matches.length !== 1) throw new Error(`Expected one vendor tarball for ${prefix}, found: ${matches.join(', ')}`)
    return join(vendorDir, matches[0])
  }
  return {
    react: findTarball('react-19.2.4'),
    reactDom: findTarball('react-dom-19.2.4'),
    scheduler: findTarball('scheduler-0.27.0'),
    jose: findTarball('jose-5.10.0'),
    lruCache: findTarball('lru-cache-11.3.5'),
  }
}

async function verifyTarballConsumer({ coreTarball, reactTarball }) {
  const corePackage = join(consumer, 'node_modules/@axis-iam/vertex')
  const reactPackage = join(consumer, 'node_modules/@axis-iam/vertex-react')
  const manifest = await readFile(join(consumer, 'package.json'), 'utf8')
  const lockfile = await readFile(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  for (const required of [coreTarball, reactTarball]) {
    if (!manifest.includes(required) || !lockfile.includes(required)) throw new Error(`Consumer does not resolve ${required}`)
  }
  for (const forbidden of ['workspace:', 'link:', repoRoot, '/packages/core', '/packages/react']) {
    if (manifest.includes(forbidden) || lockfile.includes(forbidden)) throw new Error(`Consumer contains forbidden source reference: ${forbidden}`)
  }
  for (const packagePath of [corePackage, reactPackage]) {
    if (!(await realpath(packagePath)).startsWith(`${consumer}/node_modules/.pnpm/`)) throw new Error(`Consumer SDK package escapes packed install: ${packagePath}`)
  }
  const coreManifest = JSON.parse(await readFile(join(corePackage, 'package.json'), 'utf8'))
  const reactManifest = JSON.parse(await readFile(join(reactPackage, 'package.json'), 'utf8'))
  if (coreManifest.name !== '@axis-iam/vertex' || coreManifest.version !== '0.1.0') throw new Error('Unexpected packed Core identity')
  if (reactManifest.name !== '@axis-iam/vertex-react' || reactManifest.version !== '0.1.0') throw new Error('Unexpected packed React identity')
  return {
    mode: 'pnpm-offline-tarballs',
    sdkPackages: [
      { name: coreManifest.name, version: coreManifest.version, tarball: coreTarball, installedPath: relative(consumer, corePackage) },
      { name: reactManifest.name, version: reactManifest.version, tarball: reactTarball, installedPath: relative(consumer, reactPackage) },
    ],
    workspaceFallback: false,
    linkFallback: false,
    sourceFallback: false,
  }
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
  socket.addEventListener('message', event => {
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
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
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

async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'inherit' })
  const exitCode = await new Promise(resolvePromise => child.once('exit', resolvePromise))
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}`)
}

async function capture(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  const exitCode = await new Promise(resolvePromise => child.once('exit', resolvePromise))
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}`)
  return output
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolvePromise => child.once('exit', resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 5000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await new Promise(resolvePromise => child.once('exit', resolvePromise))
  }
}
