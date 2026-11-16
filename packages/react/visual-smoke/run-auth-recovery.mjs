import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, cp, realpath, rm } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFixture } from './auth-recovery/fixture.mjs'

const repo = resolve(import.meta.dirname, '../../..')
const output = resolve(repo, '../../.worktrees/task-runtime/TASK-20261116-002', `packed-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
const consumer = join(output, 'consumer')
const artifacts = join(output, 'artifacts')
await mkdir(consumer, { recursive: true })
await mkdir(artifacts, { recursive: true })
// A short task-owned SDK output is required by the Unix-domain socket path limit.
// Exclusive mkdir never reuses or removes an unexplained directory.
const temporary = join(repo, '.ar-tmp')
await mkdir(temporary)
process.env.TMPDIR = temporary
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const commands = [], results = [], packages = [], browserErrors = []
const env = { ...process.env, HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897', http_proxy: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897' }
const run = (command, args, cwd = consumer) => new Promise((resolveCommand, reject) => {
  commands.push({ command, args, cwd, utc: new Date().toISOString() })
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let tail = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { tail = (tail + chunk).slice(-6000) })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolveCommand(tail) : reject(new Error(`${command} exited ${code}: ${tail}`)))
})
const check = (condition, name) => { if (!condition) throw new Error(name) }
const exec = promisify(execFile)
let browser, fixture, lastPage, lastCase, outcome = 'FAIL'
try {
  // Builds are separate declared prerequisites; package exactly their produced dist.
  for (const [name, archive] of [['core', 'axis-iam-vertex-0.1.0.tgz'], ['react', 'axis-iam-vertex-react-0.1.0.tgz']]) {
    await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages', name))
    const file = join(artifacts, archive)
    const { stdout } = await exec('tar', ['-tzf', file])
    const entries = stdout.trim().split('\n')
    check(entries.every(path => /^package\/(?:dist\/|package\.json$|README\.md$|LICENSE$)/.test(path)), 'Archive contains only distributable files')
    for (const entry of entries.filter(path => !path.endsWith('/'))) {
      const { stdout: content } = await exec('tar', ['-xOf', file, entry], { maxBuffer: 12 * 1024 * 1024 })
      check(!/\/home\/chaos|\.worktrees\/|TASK-2026|["'](?:workspace:|link:)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}/.test(content), 'Archive sensitive/private-path scan')
    }
    const { stdout: rawMap } = await exec('tar', ['-xOf', file, 'package/dist/index.js.map'], { maxBuffer: 12 * 1024 * 1024 })
    const map = JSON.parse(rawMap)
    const sourceHashes = []
    for (const [index, source] of map.sources.entries()) {
      check(source.startsWith('../src/'), 'Only package sources in distributable source map')
      const bytes = await readFile(resolve(repo, 'packages', name, 'dist', source))
      check(bytes.toString() === map.sourcesContent[index], 'Archive sources match actual candidate')
      sourceHashes.push({ path: `packages/${name}/${source.slice(3)}`, sha256: digest(bytes) })
    }
    packages.push({ name, archive, sha256: digest(await readFile(file)), entries, sourceHashes })
  }
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true, type: 'module',
    dependencies: {
      '@axis-iam/vertex': `file:${join(artifacts, packages[0].archive)}`,
      '@axis-iam/vertex-react': `file:${join(artifacts, packages[1].archive)}`,
      react: '^19.0.0', 'react-dom': '^19.0.0',
    },
    devDependencies: { esbuild: '^0.25.0', typescript: '^5.7.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', 'playwright-core': '^1.56.0' },
  }, null, 2))
  await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'])
  for (const name of ['vertex', 'vertex-react']) {
    const path = await realpath(join(consumer, 'node_modules/@axis-iam', name))
    check(path.startsWith(consumer + '/'), 'Independent consumer has no workspace/link fallback')
  }
  await cp(join(import.meta.dirname, '../examples/CustomAuth.tsx'), join(consumer, 'CustomAuth.tsx'))
  await cp(join(import.meta.dirname, 'auth-recovery/browser.tsx'), join(consumer, 'browser.tsx'))
  await writeFile(join(consumer, 'types.ts'), `
import { AuthenticationTransaction } from '@axis-iam/vertex'
import { AuthProviderWindow, type AuthFlowActions, type AuthFlowState } from '@axis-iam/vertex-react'
declare const actions: AuthFlowActions; declare const state: AuthFlowState; declare const tx: AuthenticationTransaction
void actions.signInWithProvider('provider', { timeoutMs: 2000 })
void state.error; void tx.exchange({reconcileCompletion:true})
// @ts-expect-error Removed incomplete-login recovery API must not remain consumable.
void actions.retrySessionViews
// @ts-expect-error Failures return to the form, without a separate recovery state.
void state.recovery
const callback: Promise<string> = new AuthProviderWindow('/callback').start(async () => 'https://provider.invalid')
void callback
`)
  await run('pnpm', ['exec', 'tsc', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', '--jsx', 'react-jsx', 'types.ts', 'CustomAuth.tsx'])
  await run('node', ['--input-type=module', '-e', "import {AuthenticationTransaction} from '@axis-iam/vertex';import {AuthProviderWindow,useAuthFlow} from '@axis-iam/vertex-react';if(!AuthenticationTransaction.isProviderCallback||!AuthProviderWindow||!useAuthFlow)process.exit(1)"])
  await run('node', ['-e', "if(!require('@axis-iam/vertex').AuthenticationTransaction.isProviderCallback||!require('@axis-iam/vertex-react').AuthProviderWindow)process.exit(1)"])
  await run('pnpm', ['exec', 'esbuild', 'browser.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=browser.js'])
  const { chromium } = await import(pathToFileURL(join(consumer, 'node_modules/playwright-core/index.mjs')).href)
  fixture = await createFixture(consumer)
  browser = await chromium.launch({ executablePath: '/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const contexts = new Set()
  const record = (name, c, detail = {}) => {
    results.push({ name, status: 'PASS', counts: c ? { ...c.counts } : {}, ...detail })
    console.log(JSON.stringify({ scenario: name, status: 'PASS' }))
  }
  const start = async (id, config = {}, existingContext) => {
    const c = fixture.configure(id, config)
    const context = existingContext ?? await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    contexts.add(context)
    context.on('page', page => page.on('pageerror', error => browserErrors.push({
      case: id, name: error.name,
      message: error.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 300),
      stack: error.stack?.split('\n').slice(0, 4).map(line => line.replace(/https?:\/\/\S+/g, '[url]')),
    })))
    const page = await context.newPage()
    lastPage = page
    lastCase = c
    await page.goto(`${fixture.origin}/app/${id}`)
    await page.waitForFunction(() => window.recovery?.snapshot().loaded)
    if (c.entry === 'headless') await page.waitForFunction(() => window.recovery.snapshot().step === 'identifier')
    else if (c.entry !== 'hosted') await page.getByRole('button', { name: /Continue with Controlled Provider|继续使用.*Controlled Provider|使用.*Controlled Provider/ }).waitFor()
    return { c, context, page }
  }
  const snap = page => page.evaluate(() => window.recovery.snapshot())
  const action = (page, name, ...args) => page.evaluate(({ name, args }) => window.recovery.action(name, ...args), { name, args })
  const ready = page => page.waitForFunction(() => window.recovery?.snapshot().authenticated)
  const providerButton = page => page.getByRole('button', { name: /Continue with Controlled Provider|Headless provider|Controlled Provider/ })
  const beginPopup = async page => {
    const popupEvent = page.waitForEvent('popup')
    await providerButton(page).click()
    const popup = await popupEvent
    await popup.getByRole('link', { name: 'Approve controlled identity' }).waitFor()
    return popup
  }
  const approve = async page => { const popup = await beginPopup(page); await popup.getByRole('link', { name: 'Approve controlled identity' }).click(); return popup }
  const noManual = async page => {
    check(!/I have signed in|Complete authorization|Continue login|Retry completion|完成授权|取消尚未确认/.test(await page.locator('body').innerText()), 'No internal recovery UI during busy or failure')
    check(await page.getByRole('button', { name: /^(Retry loading account|Start sign-in again|重试加载账户|重新登录)$/ }).count() === 0, 'No extra recovery button replaces the login form')
  }
  const primary = async page => {
    await page.getByLabel(/^Email$/i).fill('member@example.invalid')
    await page.getByLabel('Password', { exact: true }).fill('Controlled-fixture-pass')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  }

  for (const entry of ['embedded', 'dialog', 'custom']) {
    const { c, page } = await start(`automatic-${entry}`, { entry, tokenDelay: 400 })
    await approve(page)
    await page.waitForTimeout(120)
    check(!(await snap(page)).authenticated, `${entry} no success before exchange/views`)
    await noManual(page)
    await ready(page)
    check((await snap(page)).successes === 1 && c.counts.token === 1, `${entry} exact completion`)
    check(!(await snap(page)).persistentTokens, 'Memory-only token storage')
    record(`automatic-${entry}`, c, { actualPublicEntry: true, crossOriginPopup: true })
  }
  for (const entry of ['embedded', 'custom']) {
    const { c, page } = await start(`top-level-${entry}`, { entry, navigation: 'redirect' })
    await providerButton(page).click()
    await page.getByRole('link', { name: 'Approve controlled identity' }).click()
    await ready(page)
    check((await snap(page)).successes === 1 && c.counts.token === 1 && new URL(page.url()).search === '', 'StrictMode top-level automatic and scrubbed once')
    record(`top-level-${entry}-strict-mode`, c)
  }
  {
    const { c, page } = await start('denial', { entry: 'embedded' })
    const popup = await beginPopup(page)
    await popup.getByRole('link', { name: 'Decline' }).click()
    await page.getByRole('alert').filter({ hasText: /declined/ }).waitFor()
    check(!c.counts.token, 'Denial never exchanges code')
    await noManual(page)
    await approve(page); await ready(page)
    check(c.counts.token === 1, 'Safe login after denial')
    record('denial-and-relogin', c)
  }
  {
    const { c, page } = await start('closed', { entry: 'dialog' })
    const popup = await beginPopup(page)
    await popup.close()
    await page.getByRole('alert').filter({ hasText: /closed/ }).waitFor()
    await noManual(page)
    await approve(page); await ready(page)
    record('closed-and-relogin', c)
  }
  {
    const { c, page } = await start('timeout', { timeoutMs: 1000 })
    const popup = await beginPopup(page)
    await page.waitForFunction(() => window.recovery.snapshot().errors.includes('AUTH_PROVIDER_TIMEOUT'))
    check(popup.isClosed() && !c.counts.token, 'Timeout closes window without exchange')
    check((await snap(page)).step === 'identifier', 'Timeout returns directly to the login form')
    await approve(page); await ready(page)
    record('timeout-and-relogin', c)
  }
  for (const entry of ['embedded', 'custom']) {
    const { c, page } = await start(`mfa-${entry}`, { entry, mfa: true })
    await approve(page)
    await page.getByLabel(entry === 'custom' ? 'Verification code' : 'Authenticator code', { exact: true }).waitFor()
    check(!c.counts.token && !(await snap(page)).authenticated, 'MFA cannot be bypassed')
    await page.getByLabel(entry === 'custom' ? 'Verification code' : 'Authenticator code', { exact: true }).fill('123456')
    await page.getByRole('button', { name: entry === 'custom' ? 'Verify' : 'Verify and sign in', exact: true }).click()
    await ready(page)
    check(c.counts.mfa === 1 && c.counts.token === 1, 'MFA one proof and exchange')
    record(`mfa-required-${entry}`, c)
  }
  {
    const { c, page } = await start('lost-complete', { entry: 'embedded', loseComplete: 1 })
    await primary(page); await ready(page)
    check(c.counts.authenticate === 1 && c.counts.complete === 2 && c.counts.token === 1, 'Original-key completion reconciliation without credential replay')
    record('lost-completion-original-key', c)
  }
  {
    const { c, page } = await start('lost-code', { entry: 'custom', loseToken: true })
    await approve(page)
    await page.getByRole('alert').waitFor()
    check(c.counts.token === 1 && !(await snap(page)).authenticated, 'Lost token response never replays code')
    c.loseToken = false
    await noManual(page)
    await approve(page); await ready(page)
    check(c.counts.token === 2, 'Fresh attempt exchanges fresh code')
    record('lost-token-and-safe-relogin', c)
  }
  {
    const { c, page } = await start('lost-network', { entry: 'embedded' })
    await page.route('**/token', route => route.abort())
    await approve(page)
    await page.getByRole('alert').waitFor()
    check(!c.counts.token, 'Offline exchange not received by fixture')
    await page.unroute('**/token')
    await noManual(page)
    await approve(page); await ready(page)
    record('network-failure-and-relogin', c)
  }
  for (const entry of ['embedded', 'dialog', 'custom'])
    for (const part of ['profile', 'permissions']) {
      const { c, page, context } = await start(`views-${entry}-${part}`, { entry, failView: part, failLogout: true, logoutDelay: 500 })
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt === 0) await primary(page)
        else await approve(page)
        await page.getByRole('alert').waitFor()
        const state = await snap(page)
        check(!state.tokenPresent && !state.authenticated && state.successes === 0, 'Failed login discards local tokens and never reports success')
        await noManual(page)
        check(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), 'Ordinary login form is ready without reset or logout')
        check(c.counts.authenticate === 1 && c.counts.token === attempt + 1, 'Only manual fresh attempts send a new proof and exchange')
      }
      await page.screenshot({ path: join(output, `${c.id}-failure.png`) })
      c.failView = null
      c.user = 'second-user'
      await primary(page); await ready(page)
      await page.waitForTimeout(550)
      check((await snap(page)).user === 'second-user' && (await snap(page)).successes === 1, 'Late failed logout cannot clear the new account')
      check(c.counts.authenticate === 2 && c.counts.authorize === 1 && c.counts.token === 3 && c.counts.logout === 2, 'No hidden proof, code or view retry')
      record(`failed-${entry}-${part}-direct-relogin`, c)
      await context.close(); contexts.delete(context)
    }
  {
    const { c, page, context } = await start('failure-mobile-zh', { entry: 'embedded', theme: 'dark', locale: 'zh-CN', failView: 'profile' })
    await page.setViewportSize({ width: 390, height: 844 })
    await approve(page)
    await page.getByRole('alert').waitFor()
    await noManual(page)
    check(!(await snap(page)).tokenPresent && !(await snap(page)).overflow, 'Chinese mobile failure keeps a usable, contained form')
    await page.screenshot({ path: join(output, `${c.id}.png`) })
    record('failure-mobile-dark-zh', c)
    await context.close(); contexts.delete(context)
  }
  {
    const { c, page } = await start('duplicate')
    await action(page, 'startProvider', 'provider')
    const callback = fixture.callback(c)
    check((await page.evaluate(url => window.recovery.duplicate(url), callback)).same, 'Duplicate callbacks share one handler')
    await ready(page)
    const before = (await snap(page)).successes
    await action(page, 'resumeProviderCallback', callback)
    check(c.counts.token === 1 && (await snap(page)).successes === before, 'Late duplicate does not exchange or emit success again')
    record('duplicate-and-late-return', c)
  }
  {
    const { c, page } = await start('late-network', { tokenDelay: 500 })
    await action(page, 'startProvider', 'provider')
    const callback = fixture.callback(c)
    await page.evaluate(url => window.recovery.start('resumeProviderCallback', url), callback)
    await page.waitForTimeout(100)
    await action(page, 'reset')
    c.tokenDelay = 0
    await action(page, 'continueWithIdentifier', { kind: 'EMAIL', value: 'member@example.invalid' })
    await action(page, 'submitPassword', 'Controlled-fixture-pass')
    await ready(page)
    await page.waitForTimeout(550)
    check((await snap(page)).successes === 1 && c.counts.token === 2, 'Old token completion cannot commit into restarted flow')
    record('late-completion-after-restart', c)
  }
  {
    const { c, page } = await start('unmount')
    const popup = await beginPopup(page)
    await page.evaluate(() => window.recovery.unmount())
    if (!popup.isClosed()) await popup.waitForEvent('close')
    check(!c.counts.token, 'Unmount releases popup and never exchanges')
    record('unmount-releases-window', c)
  }
  {
    const { c, page } = await start('wrong-state', { wrongState: true })
    await approve(page)
    await page.waitForFunction(() => window.recovery.snapshot().errors.length === 1 && window.recovery.snapshot().step === 'identifier')
    check(!c.counts.token, 'Wrong state refused before token transport')
    record('wrong-state-before-exchange', c)
  }
  {
    const { c, page } = await start('hosted', { entry: 'hosted' })
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await ready(page)
    check(c.counts.hosted === 1 && c.counts.token === 1 && !c.counts.create, 'HOSTED stays on existing authorization path')
    record('hosted-compatible-entry', c)
  }
  {
    const { c, page } = await start('registration', { entry: 'signup' })
    await page.getByLabel('Email', { exact: true }).fill('new-member@example.invalid')
    await page.getByLabel('Password', { exact: true }).fill('Controlled-fixture-pass')
    await page.getByLabel('Confirm password', { exact: true }).fill('Controlled-fixture-pass')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Verification code', { exact: true }).waitFor()
    check(c.counts.signup === 1 && !c.counts.token && !(await snap(page)).authenticated && (await snap(page)).successes === 0, 'Pending registration remains a required challenge without a session')
    record('registration-verification-retained', c)
  }
  for (const provider of [false, true]) {
    const { c, page } = await start(`server-${provider}`, { entry: 'embedded', mode: 'server_session' })
    if (provider) await approve(page)
    else await primary(page)
    await ready(page)
    check(!(await snap(page)).tokenPresent && !c.counts.token, 'Server-session never owns browser token/code')
    record(provider ? 'server-session-provider-return' : 'server-session-primary', c)
  }
  {
    const first = await start('wrong-client-a', { clientId: 'wrong-client-a', sharedIssuer: true })
    const second = await start('wrong-client-b', { clientId: 'wrong-client-b', sharedIssuer: true, user: 'user-b' })
    await action(first.page, 'startProvider', 'provider')
    await action(second.page, 'startProvider', 'provider')
    const firstReturn = fixture.callback(first.c)
    check(!(await action(second.page, 'resumeProviderCallback', firstReturn)).ok && !second.c.counts.token, 'Another Client return is refused before exchange')
    await first.page.evaluate(url => window.recovery.duplicate(url), firstReturn)
    await ready(first.page)
    await action(second.page, 'reset')
    await action(second.page, 'startProvider', 'provider')
    await second.page.evaluate(url => window.recovery.duplicate(url), fixture.callback(second.c))
    await ready(second.page)
    check((await snap(first.page)).user === 'user-a' && (await snap(second.page)).user === 'user-b', 'Mismatched return cannot overwrite either identity')
    record('wrong-client-return-and-recovery', null, { firstExchanges: first.c.counts.token, secondExchanges: second.c.counts.token })
  }
  {
    const lanes = []
    for (const user of ['user-a', 'user-b'])
      for (const client of ['client-a', 'client-b']) {
        // Distinct ApplicationClient identity, with each user represented in each Client.
        lanes.push(await start(`isolation-${user}-${client}`, { user, clientId: client, sharedIssuer: true }))
      }
    // One issuer, two real Client bindings, two users, four independent contexts.
    const popups = await Promise.all(lanes.map(({ page }) => beginPopup(page)))
    await Promise.all(popups.map(popup => popup.getByRole('link', { name: 'Approve controlled identity' }).click()))
    await Promise.all(lanes.map(({ page }) => ready(page)))
    for (const { c, page } of lanes) { const state = await snap(page); check(state.user === c.user && state.clientId === c.clientId && c.counts.token === 1, 'Four-context user/Client isolation') }
    for (const lane of lanes) record(`four-context-${lane.c.id}`, lane.c, { user: lane.c.user, client: lane.c.clientId })
  }
  {
    const context = await browser.newContext()
    const first = await start('tab-one', { user: 'user-a', clientId: 'same-tab-client', sharedIssuer: true }, context)
    const second = await start('tab-two', { user: 'user-b', clientId: 'same-tab-client', sharedIssuer: true }, context)
    const popups = await Promise.all([beginPopup(first.page), beginPopup(second.page)])
    await popups[1].getByRole('link', { name: 'Approve controlled identity' }).click()
    await popups[0].getByRole('link', { name: 'Approve controlled identity' }).click()
    await Promise.all([ready(first.page), ready(second.page)])
    check((await snap(first.page)).user === 'user-a' && (await snap(second.page)).user === 'user-b', 'Same-browser multi-tab identities do not cross')
    record('same-browser-two-tabs', null, { first: first.c.counts.token, second: second.c.counts.token })
  }
  const visuals = []
  for (const [width, theme, locale] of [[1280, 'light', 'en'], [390, 'dark', 'zh-CN'], [390, 'system', 'en']]) {
    const { c, page, context } = await start(`visual-${width}-${theme}`, { entry: 'embedded', theme, locale })
    await page.setViewportSize({ width, height: 844 })
    if (theme === 'system') await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.keyboard.press('Tab')
    check(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard focus reaches the form')
    check(!(await snap(page)).overflow, 'Changed form fits viewport')
    await page.screenshot({ path: join(output, `${c.id}.png`) })
    visuals.push({ width, theme, locale })
    await context.close(); contexts.delete(context)
  }
  record('existing-visual-system', null, { visuals, keyboard: true, reducedMotion: true })
  check(fixture.errors.length === 0 && browserErrors.length === 0, 'No unexpected fixture/browser exceptions')
  for (const context of contexts) await context.close()
  outcome = 'RUNTIME_PASS'
} catch (error) {
  results.push({ name: 'failure', status: 'FAIL', message: error.message,
    counts: lastCase?.counts,
    snapshot: await lastPage?.evaluate(() => window.recovery?.snapshot()).catch(() => null),
    visibleText: await lastPage?.locator('body').innerText().catch(() => null) })
  throw error
} finally {
  await browser?.close()
  await fixture?.close()
  await rm(temporary, { recursive: true })
  const summary = { status: outcome, boundary: 'Real packed Core/React; independent consumer; controlled loopback protocol only. No real third-party identity or DomainHub proof.',
    utc: new Date().toISOString(), output, packages, commands, results, browserErrors, resources: 'RELEASED',
    resourceOwnership: { runnerPid: process.pid, origin: fixture?.origin, providerOrigin: fixture?.providerOrigin, temporary } }
  await writeFile(join(output, 'result.json'), JSON.stringify(summary, null, 2) + '\n')
  await writeFile(join(dirname(output), 'latest.json'), JSON.stringify({ output, status: outcome }, null, 2) + '\n')
  console.log(JSON.stringify({ status: outcome, output, packages: packages.map(({ name, sha256 }) => ({ name, sha256 })), scenarios: results.length, resources: 'RELEASED' }))
}
