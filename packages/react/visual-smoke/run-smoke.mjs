import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const repoRoot = resolve(import.meta.dirname, '../../..')
const outputDir = process.env.ACCOUNT_CENTER_SMOKE_OUTPUT ?? '/tmp/sdk-js-account-center-smoke'
const vitePort = 4317
const chromePort = 9327
const baseUrl = `http://127.0.0.1:${vitePort}`
const consoleFailures = []

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

const vite = spawn('pnpm', [
  '--filter', '@axis-iam/example-react', 'exec', 'vite',
  '../../packages/react/visual-smoke', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${chromePort}`, '--user-data-dir=/tmp/sdk-js-account-center-chrome', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

vite.stderr.on('data', (chunk) => process.stderr.write(chunk))
chrome.stderr.on('data', () => undefined)

try {
  await waitForHttp(baseUrl)
  await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`)

  const cases = [
    { name: 'desktop-light', width: 1440, height: 900, scenario: 'success', scheme: 'light', themeSwitch: true },
    { name: 'desktop-dark', width: 1440, height: 900, scenario: 'success', scheme: 'dark', section: 'permissions' },
    { name: 'tablet-light', width: 768, height: 1024, scenario: 'success', scheme: 'light', section: 'password' },
    { name: 'tablet-dark', width: 768, height: 1024, scenario: 'success', scheme: 'dark', section: 'sessions' },
    { name: 'mobile-light', width: 390, height: 844, scenario: 'success', scheme: 'light', mobile: true },
    { name: 'mobile-dark', width: 390, height: 844, scenario: 'success', scheme: 'dark', mobile: true },
    { name: 'system-dark-to-light', width: 768, height: 1024, scenario: 'success', scheme: 'system', systemDark: true, systemSwitch: true },
    { name: 'chinese-dark-mobile', width: 390, height: 844, scenario: 'success', scheme: 'dark', locale: 'zh', mobile: true },
    { name: 'long-english-desktop', width: 1440, height: 900, scenario: 'long', scheme: 'light', locale: 'long', section: 'permissions' },
    { name: 'tablet-empty', width: 768, height: 1024, scenario: 'empty', scheme: 'light', section: 'sessions' },
    { name: 'mobile-error-retry', width: 390, height: 844, scenario: 'error', scheme: 'dark', retry: true },
    { name: 'mobile-loading', width: 390, height: 844, scenario: 'loading', scheme: 'light' },
    { name: 'desktop-busy', width: 1440, height: 900, scenario: 'busy', scheme: 'dark', busy: true },
    { name: 'auth-desktop-dark-en', width: 1440, height: 900, scenario: 'success', scheme: 'dark', surface: 'auth' },
    { name: 'auth-tablet-light-zh', width: 768, height: 1024, scenario: 'success', scheme: 'light', locale: 'zh', surface: 'auth' },
    { name: 'auth-mobile-dark-zh', width: 390, height: 844, scenario: 'success', scheme: 'dark', locale: 'zh', surface: 'auth' },
    { name: 'auth-dialog-desktop-light-en', width: 1440, height: 900, scenario: 'success', scheme: 'light', surface: 'auth-dialog', expectedRenderedScheme: 'light' },
    { name: 'auth-dialog-desktop-theme-switch-dark-en', width: 1440, height: 900, scenario: 'success', scheme: 'light', surface: 'auth-dialog', dialogThemeSwitch: true, expectedRenderedScheme: 'dark' },
    { name: 'auth-dialog-tablet-light-zh', width: 768, height: 1024, scenario: 'success', scheme: 'light', locale: 'zh', surface: 'auth-dialog', expectedRenderedScheme: 'light' },
    { name: 'auth-dialog-tablet-dark-zh', width: 768, height: 1024, scenario: 'success', scheme: 'dark', locale: 'zh', surface: 'auth-dialog', expectedRenderedScheme: 'dark' },
    { name: 'auth-dialog-mobile-system-dark-long', width: 390, height: 844, scenario: 'success', scheme: 'system', locale: 'long', surface: 'auth-dialog', mobile: true, systemDark: true, expectedRenderedScheme: 'dark' },
    { name: 'auth-dialog-mobile-system-light-long', width: 390, height: 844, scenario: 'success', scheme: 'system', locale: 'long', surface: 'auth-dialog', mobile: true, systemLight: true, expectedRenderedScheme: 'light' },
  ]

  const evidence = []
  for (const item of cases) evidence.push(await runCase(item))
  if (consoleFailures.length > 0) throw new Error(`Browser console failures:\n${consoleFailures.join('\n')}`)

  await writeFile(`${outputDir}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ outputDir, cases: evidence }, null, 2)}\n`)
} finally {
  vite.kill('SIGTERM')
  chrome.kill('SIGTERM')
}

async function runCase(item) {
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then(assertJson)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  const requests = []
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error' || params.type === 'warning') {
      consoleFailures.push(`${item.name}: ${params.args.map((arg) => arg.value ?? arg.description).join(' ')}`)
    }
  })
  cdp.on('Runtime.exceptionThrown', (params) => consoleFailures.push(`${item.name}: ${params.exceptionDetails.text}`))
  cdp.on('Network.requestWillBeSent', (params) => requests.push(params.request.url))

  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: item.width,
    height: item.height,
    deviceScaleFactor: 1,
    mobile: item.width < 600,
  })
  if (item.systemDark) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  if (item.systemLight) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  const query = new URLSearchParams({ scenario: item.scenario, scheme: item.scheme, ...(item.locale && { locale: item.locale }), ...(item.surface && { surface: item.surface }) })
  await cdp.send('Page.navigate', { url: `${baseUrl}/?${query}` })
  if (item.surface === 'auth') return await runAuthSurfaceCase(cdp, item, requests, target)
  if (item.surface === 'auth-dialog') return await runAuthDialogCase(cdp, item, requests, target)
  await waitFor(async () => await evaluate(cdp, `document.getElementById('account-center-trigger') !== null`))
  await evaluate(cdp, `(() => { const trigger = document.getElementById('account-center-trigger'); trigger.focus(); trigger.click() })()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]') !== null`))

  try {
    if (item.scenario === 'success' || item.scenario === 'busy' || item.scenario === 'long') {
      await waitFor(async () => await evaluate(cdp, `document.querySelector('.axis-iam-profile-identity-copy strong') !== null`))
    } else if (item.scenario === 'empty') {
      await selectSection(cdp, 'sessions', item.mobile)
      await waitFor(async () => await evaluate(cdp, `document.body.innerText.includes('No active sessions')`))
    } else if (item.scenario === 'error') {
      await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('[role="alert"]').length >= 1`))
    } else {
      await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('.axis-iam-account-loading').length >= 1`))
    }
  } catch (error) {
    const body = await evaluate(cdp, `document.body.innerText`)
    throw new Error(`${item.name} did not reach ${item.scenario} state. Body:\n${body}\n${error.message}`)
  }

  if (item.section !== undefined) {
    await selectSection(cdp, item.section, item.mobile)
  }

  if (item.retry) {
    const alertsBefore = await evaluate(cdp, `document.querySelectorAll('[role="alert"]').length`)
    await evaluate(cdp, `document.querySelector('.axis-iam-account-text-button').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('[role="alert"]').length >= ${alertsBefore}`))
  }

  if (item.themeSwitch) {
    await selectSection(cdp, 'password', false)
    await waitFor(async () => await evaluate(cdp, `document.getElementById('iam-current-password') !== null`))
    await evaluate(cdp, `(() => {
      const setValue = (id, value) => {
        const input = document.getElementById(id)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setValue('iam-current-password', 'typed-before-theme-switch')
    })()`)
    await evaluate(cdp, `document.getElementById('theme-dark').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
    const passwordValue = await evaluate(cdp, `document.getElementById('iam-current-password').value`)
    if (passwordValue !== 'typed-before-theme-switch') throw new Error(`${item.name} cleared typed password during theme switch`)
    await selectSection(cdp, 'permissions', false)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.axis-iam-permission-list') !== null`))
    const summaryBefore = await evaluate(cdp, `document.querySelector('.axis-iam-permission-list').textContent`)
    const permissionGets = requests.filter((url) => url.includes('/api/v1/auth/me/permissions') && !url.includes(':check')).length
    await evaluate(cdp, `document.getElementById('theme-light').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'light'`))
    const preserved = await evaluate(cdp, `({ summary: document.querySelector('.axis-iam-permission-list').textContent, active: document.querySelectorAll('.axis-ac-nav button')[5].getAttribute('aria-current'), checker: !!document.querySelector('.axis-iam-permission-checker') })`)
    if (preserved.summary !== summaryBefore || preserved.active !== 'page' || preserved.checker) throw new Error(`${item.name} lost permission summary or section state: ${JSON.stringify(preserved)}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    const permissionGetsAfter = requests.filter((url) => url.includes('/api/v1/auth/me/permissions') && !url.includes(':check')).length
    if (permissionGetsAfter !== permissionGets) throw new Error(`${item.name} refetched permissions during theme switch`)
  }

  if (item.systemSwitch) {
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
    await selectSection(cdp, 'password', false)
    await evaluate(cdp, `(() => { const input = document.getElementById('iam-current-password'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'system-theme-value'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'light'`))
    const systemState = await evaluate(cdp, `({ value: document.getElementById('iam-current-password').value, active: document.querySelectorAll('.axis-ac-nav button')[2].getAttribute('aria-current') })`)
    if (systemState.value !== 'system-theme-value' || systemState.active !== 'page') throw new Error(`${item.name} lost state following system theme`)
  }

  if (item.mobile) {
    const mobile = await evaluate(cdp, `(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const rect = dialog.getBoundingClientRect()
      return { width: rect.width, height: rect.height, backVisible: getComputedStyle(document.querySelector('.axis-ac-back')).display !== 'none' }
    })()`)
    if (mobile.width !== item.width || mobile.height !== item.height || !mobile.backVisible) throw new Error(`${item.name} did not render as a full-screen mobile dialog: ${JSON.stringify(mobile)}`)
    await evaluate(cdp, `document.querySelector('.axis-ac-back').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').classList.contains('axis-ac-menu')`))
    await selectSection(cdp, 'sessions', true)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.axis-iam-session-current') !== null`))
  }

  if (item.busy) {
    await evaluate(cdp, `(() => {
      const setValue = (id, value) => {
        const input = document.getElementById(id)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setValue('iam-account-display-name', 'Busy Profile')
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Save profile').click()
    })()`)
    await waitFor(async () => await evaluate(cdp, `document.body.innerText.includes('Saving profile')`))
  }

  const metrics = await evaluate(cdp, `(() => ({
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    surfaceOverflow: Array.from(document.querySelectorAll('.axis-iam-account-surface')).some((node) => node.scrollWidth > node.clientWidth),
    surfaceCount: document.querySelectorAll('.axis-iam-account-surface').length,
    embeddedPanelCount: document.querySelectorAll('.axis-ac-e').length,
    hasNestedPanelFrame: Array.from(document.querySelectorAll('.axis-ac-e')).some((node) => {
      const panel = getComputedStyle(node)
      return panel.borderTopWidth !== '0px' || panel.paddingTop !== '0px' || panel.borderTopLeftRadius !== '0px' || panel.boxShadow !== 'none' || panel.backgroundColor !== 'rgba(0, 0, 0, 0)'
    }),
    hasRawToken: document.body.innerText.includes('visual-smoke-refresh-value') || document.body.innerText.includes('visual-smoke-signature'),
    hasSensitiveText: /refresh[_ -]?token|access[_ -]?token|proof|client secret/i.test(document.body.innerText),
    clippedControl: Array.from(document.querySelectorAll('button')).some((node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight),
    escapedContent: Array.from(document.querySelectorAll('.axis-iam-account-surface *')).some((node) => { const rect = node.getBoundingClientRect(); return rect.right > window.innerWidth + 1 || rect.left < -1 }),
    overflowNodes: Array.from(document.querySelectorAll('.axis-iam-account-surface *')).filter((node) => node.scrollWidth > node.clientWidth).slice(0, 5).map((node) => ({ tag: node.tagName, className: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
    clippedNodes: Array.from(document.querySelectorAll('button')).filter((node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight).slice(0, 5).map((node) => ({ text: node.textContent, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })),
    dialogScheme: document.querySelector('[role="dialog"]').dataset.colorScheme,
    focusStyles: (() => { const input = document.querySelector('.axis-iam-account-input'); const style = input ? getComputedStyle(input) : null; return style ? { minWidth: style.minWidth, letterSpacing: style.letterSpacing } : null })(),
    bodyLength: document.body.innerText.length,
  }))()`)
  const managementRequests = requests.filter((url) => /\/api\/v1\/(admin|management)|\/management\//i.test(url))
  if (metrics.pageOverflow || metrics.surfaceOverflow || metrics.hasNestedPanelFrame || metrics.hasRawToken || metrics.hasSensitiveText || metrics.clippedControl || metrics.escapedContent || metrics.surfaceCount !== 1 || metrics.embeddedPanelCount !== 1 || managementRequests.length > 0) {
    throw new Error(`${item.name} failed metrics: ${JSON.stringify(metrics)}`)
  }

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const bytes = Buffer.from(screenshot.data, 'base64')
  if (bytes.length < 10000 || metrics.bodyLength < 100) throw new Error(`${item.name} produced an implausibly blank render`)
  const screenshotPath = `${outputDir}/${item.name}.png`
  await writeFile(screenshotPath, bytes)
  cdp.close()
  await fetch(`http://127.0.0.1:${chromePort}/json/close/${target.id}`)
  return { ...item, screenshotPath, screenshotBytes: bytes.length, managementRequests, requestCount: requests.length, ...metrics }
}

async function runAuthDialogCase(cdp, item, requests, target) {
  await waitFor(async () => await evaluate(cdp, `document.getElementById('auth-dialog-trigger') !== null`))
  await evaluate(cdp, `(() => { const trigger = document.getElementById('auth-dialog-trigger'); trigger.focus(); trigger.click() })()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]') !== null`))
  const initial = await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); return { focus: document.activeElement?.getAttribute('aria-label'), scheme: dialog.dataset.colorScheme, hasIdentifier: document.querySelector('input[placeholder*="example.com"]') !== null } })()`)
  if (initial.focus !== (item.locale === 'zh' ? '关闭认证窗口' : 'Close authentication dialog') || !initial.hasIdentifier) throw new Error(`${item.name} did not focus the localized close control or render sign in: ${JSON.stringify(initial)}`)
  await evaluate(cdp, `window.__authDialogStorageBaseline = JSON.stringify(Object.entries(sessionStorage).sort(([a], [b]) => a.localeCompare(b)))`)

  const tabText = item.locale === 'zh' ? '注册' : item.locale === 'long' ? 'Create a new account for your organization with deliberately extended explanatory wording' : 'Sign up'
  const signInTabText = item.locale === 'zh' ? '登录' : item.locale === 'long' ? 'Sign in using your organization account with deliberately extended explanatory wording' : 'Sign in'
  await evaluate(cdp, `Array.from(document.querySelectorAll('.axis-iam-auth-dialog-content button')).find((node) => node.textContent.includes(${JSON.stringify(tabText)})).click()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[placeholder="you@example.com"]') !== null`))
  await evaluate(cdp, `Array.from(document.querySelectorAll('.axis-iam-auth-dialog-content button')).find((node) => node.textContent.includes(${JSON.stringify(signInTabText)})).click()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[placeholder*="example.com"]') !== null`))
  const clearedOnIntentChange = await evaluate(cdp, `document.querySelector('input[placeholder*="example.com"]').value === ''`)
  if (!clearedOnIntentChange) throw new Error(`${item.name} retained sign-up input after switching authentication intent`)
  await evaluate(cdp, `Array.from(document.querySelectorAll('.axis-iam-auth-dialog-content button')).find((node) => node.textContent.includes(${JSON.stringify(tabText)})).click()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[placeholder="you@example.com"]') !== null`))
  if (await evaluate(cdp, `document.querySelectorAll('[data-auth-view]').length`) !== 1) throw new Error(`${item.name} rendered more than one authentication view`)
  await evaluate(cdp, `(() => {
    const input = document.querySelector('input[placeholder="you@example.com"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'roundtrip@example.com')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  if (item.locale === 'long') {
    await waitFor(async () => await evaluate(cdp, `document.querySelector('input[placeholder="you@example.com"]').value === 'roundtrip@example.com'`))
  }

  if (item.dialogThemeSwitch) {
    await evaluate(cdp, `document.getElementById('theme-dark').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
  }
  if (item.dialogSystemSwitch) {
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'light'`))
  }
  if (item.scheme === 'system') {
    const alternate = item.systemDark ? 'light' : 'dark'
    const initial = item.systemDark ? 'dark' : 'light'
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: alternate }] })
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === '${alternate}'`))
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: initial }] })
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === '${initial}'`))
  }
  const preserved = await evaluate(cdp, `({ email: document.querySelector('input[placeholder="you@example.com"]')?.value, dialog: !!document.querySelector('[role="dialog"]'), views: document.querySelectorAll('[data-auth-view]').length })`)
  if (preserved.email !== 'roundtrip@example.com' || !preserved.dialog || preserved.views !== 1) throw new Error(`${item.name} lost active sign-up state after scheme switch: ${JSON.stringify(preserved)}`)

  const mobile = await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); const rect = dialog.getBoundingClientRect(); return { width: rect.width, height: rect.height } })()`)
  if (item.mobile && (mobile.width !== item.width || mobile.height !== item.height)) throw new Error(`${item.name} did not render full-screen mobile dialog: ${JSON.stringify(mobile)}`)

  const openMetrics = await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); const visible = (node) => getComputedStyle(node).display !== 'none'; const activeEngine = document.querySelector('[data-auth-dialog-panels] > div:not([hidden]) > div'); const engineStyle = activeEngine ? getComputedStyle(activeEngine) : null; return { pageOverflow: document.documentElement.scrollWidth > window.innerWidth, dialogOverflow: dialog.scrollWidth > dialog.clientWidth, clippedControl: Array.from(document.querySelectorAll('[role="dialog"] button')).some((node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight), visibleHeadings: Array.from(dialog.querySelectorAll('h2')).filter(visible).length, visibleEngineHeadings: Array.from(document.querySelectorAll('[data-auth-dialog-panels] h2')).filter(visible).length, compactEngine: engineStyle ? { backgroundColor: engineStyle.backgroundColor, borderWidth: engineStyle.borderWidth, borderRadius: engineStyle.borderRadius, padding: engineStyle.padding, margin: engineStyle.margin, dialogBackground: getComputedStyle(dialog).backgroundColor } : null, renderedScheme: dialog.dataset.colorScheme, hasSensitiveText: /refresh[_ -]?token|access[_ -]?token|proof|client secret/i.test(document.body.innerText) } })()`)
  if (openMetrics.pageOverflow || openMetrics.dialogOverflow || openMetrics.clippedControl || openMetrics.hasSensitiveText || openMetrics.visibleHeadings !== 1 || openMetrics.visibleEngineHeadings !== 0 || openMetrics.compactEngine?.backgroundColor !== 'rgba(0, 0, 0, 0)' || openMetrics.compactEngine?.borderWidth !== '0px' || openMetrics.compactEngine?.borderRadius !== '0px' || openMetrics.compactEngine?.padding !== '0px' || openMetrics.compactEngine?.margin !== '0px' || openMetrics.renderedScheme !== item.expectedRenderedScheme) throw new Error(`${item.name} failed open dialog metrics: ${JSON.stringify(openMetrics)}`)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const bytes = Buffer.from(screenshot.data, 'base64')
  if (bytes.length < 10000) throw new Error(`${item.name} produced an implausibly blank open render`)
  const screenshotPath = `${outputDir}/${item.name}.png`
  await writeFile(screenshotPath, bytes)

  await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]') === null`))
  const closeState = await evaluate(cdp, `(() => { const before = new Map(JSON.parse(window.__authDialogStorageBaseline)); const changed = Object.keys(sessionStorage).filter(key => before.get(key) !== sessionStorage.getItem(key)); const pending = sessionStorage.getItem('axis_iam_pending_authorization'); let pendingValid = false; try { const value = pending && JSON.parse(pending); pendingValid = !!value && value.entryMode === 'HOSTED' && value.version === 1 && Object.keys(value).every(key => ['version','issuer','clientId','redirectUri','entryMode','flowOwner','state','verifier','nonce','expiresAt'].includes(key)) && !JSON.stringify(value).includes('visual-smoke-proof') } catch {} return { restored: document.activeElement?.id === 'auth-dialog-trigger', pageOverflow: document.documentElement.scrollWidth > innerWidth, hasSensitiveText: /refresh[_ -]?token|access[_ -]?token|proof|client secret/i.test(document.body.innerText), changedStorageKeys: changed, pendingAuthorizationValid: pendingValid, storageBoundaryValid: changed.every(key => key === 'axis_iam_pending_authorization') && (!changed.includes('axis_iam_pending_authorization') || pendingValid) } })()`)
  const managementRequests = requests.filter((url) => /\/api\/v1\/(admin|management)|\/management\//i.test(url))
  const clientCredentialRequests = requests.filter((url) => /client_credentials|\/m2m\b/i.test(url))
  if (!closeState.restored || closeState.pageOverflow || closeState.hasSensitiveText || !closeState.storageBoundaryValid || managementRequests.length > 0 || clientCredentialRequests.length > 0) throw new Error(`${item.name} failed security/focus metrics: ${JSON.stringify({ closeState, managementRequests, clientCredentialRequests })}`)

  cdp.close()
  await fetch(`http://127.0.0.1:${chromePort}/json/close/${target.id}`)
  return { ...item, renderedScheme: openMetrics.renderedScheme, screenshotPath, screenshotBytes: bytes.length, mobile, openMetrics, managementRequests, clientCredentialRequests, ...closeState }
}

async function runAuthSurfaceCase(cdp, item, requests, target) {
  await waitFor(async () => await evaluate(cdp, `document.getElementById('auth-localization-smoke') !== null`))
  try {
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('#auth-localization-smoke > *').length === 6`))
    if (item.locale === 'zh') {
      await waitFor(async () => await evaluate(cdp, `['登录', '创建账户', '重置密码', '创建新密码', '组织邀请', '登录方式'].every((text) => document.body.innerText.includes(text)) && document.querySelector('.axis-identity-methods [role="alert"]') === null && document.querySelector('.axis-identity-overview-row p')?.textContent === 'alex.morgan@example.com'`))
    } else {
      await waitFor(async () => await evaluate(cdp, `['Sign in', 'Create account', 'Reset password', 'Create new password', 'Organization invitation', 'Login methods'].every((text) => document.body.innerText.includes(text)) && document.querySelector('.axis-identity-methods [role="alert"]') === null && document.querySelector('.axis-identity-overview-row p')?.textContent === 'alex.morgan@example.com'`))
    }
  } catch (error) {
    const body = await evaluate(cdp, `document.body.innerText`)
    throw new Error(`${item.name} did not reach auth surface. Body:\n${body}\n${error.message}`)
  }

  const metrics = await evaluate(cdp, `(() => {
    const roots = Array.from(document.querySelectorAll('#auth-localization-smoke > *'))
    return {
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      rootCount: roots.length,
      darkRoots: roots.filter((node) => getComputedStyle(node).backgroundColor === 'rgb(16, 20, 23)').length,
      hasRawToken: document.body.innerText.includes('visual-smoke-refresh-value') || document.body.innerText.includes('visual-smoke-signature'),
      hasSensitiveText: /refresh[_ -]?token|access[_ -]?token|proof|client secret/i.test(document.body.innerText),
      clippedControl: Array.from(document.querySelectorAll('#auth-localization-smoke button')).some((node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight),
      escapedContent: Array.from(document.querySelectorAll('#auth-localization-smoke *')).some((node) => { const rect = node.getBoundingClientRect(); return rect.right > window.innerWidth + 1 || rect.left < -1 }),
      bodyLength: document.body.innerText.length,
    }
  })()`)
  const managementRequests = requests.filter((url) => /\/api\/v1\/(admin|management)|\/management\//i.test(url))
  const requiresDark = item.scheme === 'dark'
  if (metrics.pageOverflow || metrics.rootCount !== 6 || (requiresDark && metrics.darkRoots !== 6) || metrics.hasRawToken || metrics.hasSensitiveText || metrics.clippedControl || metrics.escapedContent || managementRequests.length > 0) {
    throw new Error(`${item.name} failed auth metrics: ${JSON.stringify(metrics)}`)
  }

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const bytes = Buffer.from(screenshot.data, 'base64')
  if (bytes.length < 10000 || metrics.bodyLength < 100) throw new Error(`${item.name} produced an implausibly blank auth render`)
  const screenshotPath = `${outputDir}/${item.name}.png`
  await writeFile(screenshotPath, bytes)
  cdp.close()
  await fetch(`http://127.0.0.1:${chromePort}/json/close/${target.id}`)
  return { ...item, screenshotPath, screenshotBytes: bytes.length, managementRequests, requestCount: requests.length, ...metrics }
}

async function selectSection(cdp, section, mobile = false) {
  const index = ['profile', 'methods', 'password', 'security', 'sessions', 'permissions'].indexOf(section)
  if (index < 0) throw new Error(`Unknown AccountCenter section: ${section}`)
  if (mobile) {
    const dialogMenu = await evaluate(cdp, `document.querySelector('[role="dialog"]').classList.contains('axis-ac-menu')`)
    if (!dialogMenu) await evaluate(cdp, `document.querySelector('.axis-ac-back').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').classList.contains('axis-ac-menu')`))
  }
  await evaluate(cdp, `document.querySelectorAll('.axis-ac-nav button')[${index}].click()`)
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
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener])
    },
    close() { socket.close() },
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function assertJson(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${response.url}`)
  return await response.json()
}

async function waitForHttp(url) {
  await waitFor(async () => {
    try { return (await fetch(url)).ok } catch { return false }
  }, 15000)
}

async function waitFor(predicate, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await predicate()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out after ${timeout}ms`)
}
