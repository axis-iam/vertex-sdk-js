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
    { name: 'desktop-dark', width: 1440, height: 900, scenario: 'success', scheme: 'dark', section: 3 },
    { name: 'tablet-light', width: 768, height: 1024, scenario: 'success', scheme: 'light', section: 1 },
    { name: 'tablet-dark', width: 768, height: 1024, scenario: 'success', scheme: 'dark', section: 2 },
    { name: 'mobile-light', width: 390, height: 844, scenario: 'success', scheme: 'light', mobile: true },
    { name: 'mobile-dark', width: 390, height: 844, scenario: 'success', scheme: 'dark', mobile: true },
    { name: 'system-dark-to-light', width: 768, height: 1024, scenario: 'success', scheme: 'system', systemDark: true, systemSwitch: true },
    { name: 'chinese-dark-mobile', width: 390, height: 844, scenario: 'success', scheme: 'dark', locale: 'zh', mobile: true },
    { name: 'long-english-desktop', width: 1440, height: 900, scenario: 'long', scheme: 'light', locale: 'long', section: 3 },
    { name: 'tablet-empty', width: 768, height: 1024, scenario: 'empty', scheme: 'light', section: 2 },
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
      await evaluate(cdp, `Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Sessions').click()`)
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
    await selectSection(cdp, 1, false)
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
    await selectSection(cdp, 3, false)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.axis-iam-permission-checker') !== null`))
    await evaluate(cdp, `(() => {
      const setValue = (id, value) => {
        const input = document.getElementById(id)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const details = document.querySelector('.axis-iam-permission-checker')
      details.open = true
      setValue('iam-permission-check', 'orders:read')
    })()`)
    const permissionGets = requests.filter((url) => url.includes('/api/v1/auth/me/permissions') && !url.includes(':check')).length
    await evaluate(cdp, `document.getElementById('theme-light').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'light'`))
    const preserved = await evaluate(cdp, `({ value: document.getElementById('iam-permission-check').value, active: document.querySelectorAll('.axis-ac-nav button')[3].getAttribute('aria-current') })`)
    if (preserved.value !== 'orders:read' || preserved.active !== 'page') throw new Error(`${item.name} lost permission form or section state: ${JSON.stringify(preserved)}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    const permissionGetsAfter = requests.filter((url) => url.includes('/api/v1/auth/me/permissions') && !url.includes(':check')).length
    if (permissionGetsAfter !== permissionGets) throw new Error(`${item.name} refetched permissions during theme switch`)
  }

  if (item.systemSwitch) {
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
    await selectSection(cdp, 1, false)
    await evaluate(cdp, `(() => { const input = document.getElementById('iam-current-password'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'system-theme-value'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'light'`))
    const systemState = await evaluate(cdp, `({ value: document.getElementById('iam-current-password').value, active: document.querySelectorAll('.axis-ac-nav button')[1].getAttribute('aria-current') })`)
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
    await evaluate(cdp, `document.querySelectorAll('.axis-ac-nav button')[2].click()`)
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

  const tabText = item.locale === 'zh' ? '注册' : item.locale === 'long' ? 'Create a new account for your organization with deliberately extended explanatory wording' : 'Sign up'
  const signInTabText = item.locale === 'zh' ? '登录' : item.locale === 'long' ? 'Sign in using your organization account with deliberately extended explanatory wording' : 'Sign in'
  await evaluate(cdp, `Array.from(document.querySelectorAll('[role="tab"]')).find((node) => node.textContent === ${JSON.stringify(tabText)}).click()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[placeholder="you@example.com"]') !== null`))
  await evaluate(cdp, `(() => {
    const setValue = (selector, value, index = 0) => {
      const input = document.querySelectorAll(selector)[index]
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setValue('input[placeholder="you@example.com"]', 'roundtrip@example.com')
    setValue('input[type="password"]', 'roundtrip-password', 0)
    setValue('input[type="password"]', 'roundtrip-password', 1)
  })()`)
  await evaluate(cdp, `Array.from(document.querySelectorAll('[role="tab"]')).find((node) => node.textContent === ${JSON.stringify(signInTabText)}).click()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('input[placeholder*="example.com"]') !== null`))
  await evaluate(cdp, `Array.from(document.querySelectorAll('[role="tab"]')).find((node) => node.textContent === ${JSON.stringify(tabText)}).click()`)
  await waitFor(async () => await evaluate(cdp, `(() => { const inputs = document.querySelectorAll('[data-auth-dialog-panels] > div:not([hidden]) input'); return inputs[0]?.value === 'roundtrip@example.com' && inputs[1]?.value === 'roundtrip-password' && inputs[2]?.value === 'roundtrip-password' })()`))
  await evaluate(cdp, `(() => { const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((node) => node.textContent === ${JSON.stringify(tabText)}); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="tab"][aria-selected="true"]').textContent !== ${JSON.stringify(tabText)}`))
  await evaluate(cdp, `(() => { const tab = document.querySelector('[role="tab"][aria-selected="true"]'); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="tab"][aria-selected="true"]').textContent === ${JSON.stringify(tabText)}`))

  if (item.dialogThemeSwitch) {
    await evaluate(cdp, `document.getElementById('theme-dark').click()`)
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
  }
  if (item.dialogSystemSwitch) {
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'dark'`))
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]').dataset.colorScheme === 'light'`))
  }
  const preserved = await evaluate(cdp, `({ email: document.querySelector('input[placeholder="you@example.com"]')?.value, dialog: !!document.querySelector('[role="dialog"]') })`)
  if (preserved.email !== 'roundtrip@example.com' || !preserved.dialog) throw new Error(`${item.name} lost auth dialog state after scheme switch: ${JSON.stringify(preserved)}`)

  const mobile = await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); const rect = dialog.getBoundingClientRect(); return { width: rect.width, height: rect.height } })()`)
  if (item.mobile && (mobile.width !== item.width || mobile.height !== item.height)) throw new Error(`${item.name} did not render full-screen mobile dialog: ${JSON.stringify(mobile)}`)

  const openMetrics = await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); const visible = (node) => getComputedStyle(node).display !== 'none'; const activeEngine = document.querySelector('[data-auth-dialog-panels] > div:not([hidden]) > div'); return { pageOverflow: document.documentElement.scrollWidth > window.innerWidth, dialogOverflow: dialog.scrollWidth > dialog.clientWidth, clippedControl: Array.from(document.querySelectorAll('[role="dialog"] button')).some((node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight), visibleHeadings: Array.from(dialog.querySelectorAll('h2')).filter(visible).length, visibleEngineHeadings: Array.from(document.querySelectorAll('[data-auth-dialog-panels] h2')).filter(visible).length, compactEngine: activeEngine ? { backgroundColor: getComputedStyle(activeEngine).backgroundColor, paddingTop: getComputedStyle(activeEngine).paddingTop } : null, renderedScheme: dialog.dataset.colorScheme, hasSensitiveText: /refresh[_ -]?token|access[_ -]?token|proof|client secret/i.test(document.body.innerText) } })()`)
  if (openMetrics.pageOverflow || openMetrics.dialogOverflow || openMetrics.clippedControl || openMetrics.hasSensitiveText || openMetrics.visibleHeadings !== 1 || openMetrics.visibleEngineHeadings !== 0 || openMetrics.compactEngine?.backgroundColor !== 'rgba(0, 0, 0, 0)' || openMetrics.compactEngine?.paddingTop !== '0px' || openMetrics.renderedScheme !== item.expectedRenderedScheme) throw new Error(`${item.name} failed open dialog metrics: ${JSON.stringify(openMetrics)}`)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const bytes = Buffer.from(screenshot.data, 'base64')
  if (bytes.length < 10000) throw new Error(`${item.name} produced an implausibly blank open render`)
  const screenshotPath = `${outputDir}/${item.name}.png`
  await writeFile(screenshotPath, bytes)

  await evaluate(cdp, `(() => { const dialog = document.querySelector('[role="dialog"]'); dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[role="dialog"]') === null`))
  const closeState = await evaluate(cdp, `({ restored: document.activeElement?.id === 'auth-dialog-trigger', pageOverflow: document.documentElement.scrollWidth > window.innerWidth, hasSensitiveText: /refresh[_ -]?token|access[_ -]?token|proof|client secret/i.test(document.body.innerText), storageSensitive: Object.values(sessionStorage).some((value) => /visual-smoke-proof|visual-smoke-refresh-value|visual-smoke-signature/.test(value)) })`)
  const managementRequests = requests.filter((url) => /\/api\/v1\/(admin|management)|\/management\//i.test(url))
  const clientCredentialRequests = requests.filter((url) => /client_credentials|\/m2m\b/i.test(url))
  if (!closeState.restored || closeState.pageOverflow || closeState.hasSensitiveText || closeState.storageSensitive || managementRequests.length > 0 || clientCredentialRequests.length > 0) throw new Error(`${item.name} failed security/focus metrics: ${JSON.stringify({ closeState, managementRequests, clientCredentialRequests })}`)

  cdp.close()
  await fetch(`http://127.0.0.1:${chromePort}/json/close/${target.id}`)
  return { ...item, renderedScheme: openMetrics.renderedScheme, screenshotPath, screenshotBytes: bytes.length, mobile, openMetrics, managementRequests, clientCredentialRequests, ...closeState }
}

async function runAuthSurfaceCase(cdp, item, requests, target) {
  await waitFor(async () => await evaluate(cdp, `document.getElementById('auth-localization-smoke') !== null`))
  try {
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('#auth-localization-smoke > *').length === 6`))
    if (item.locale === 'zh') {
      await waitFor(async () => await evaluate(cdp, `['登录', '创建账户', '重置密码', '创建新密码', '加入 Visual Organization', '已关联账户', 'GitHub（OAuth 2.0）'].every((text) => document.body.innerText.includes(text))`))
    } else {
      await waitFor(async () => await evaluate(cdp, `['Sign in', 'Create account', 'Reset password', 'Create new password', 'Join Visual Organization', 'Connected accounts', 'GitHub (OAuth 2.0)'].every((text) => document.body.innerText.includes(text))`))
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

async function selectSection(cdp, index, mobile = false) {
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
