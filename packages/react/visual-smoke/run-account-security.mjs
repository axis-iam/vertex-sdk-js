import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, cp, unlink, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { securityFixture } from './account-security/fixture.mjs'

if (!process.env.ACCOUNT_SECURITY_OUTPUT) throw new Error('Set ACCOUNT_SECURITY_OUTPUT to an isolated task-owned output directory')
const output = resolve(process.env.ACCOUNT_SECURITY_OUTPUT), repo = resolve(import.meta.dirname, '../../..')
const consumer = join(output, `consumer-${Date.now()}`), artifacts = join(output, 'artifacts')
await mkdir(consumer, { recursive: true }); await mkdir(artifacts, { recursive: true })
process.env.TMPDIR = join(output, 'tmp')
await mkdir(process.env.TMPDIR, { recursive: true })
const env = { ...process.env, HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897', http_proxy: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897' }
const commands = [], checks = [], hashes = [], failures = []
async function run(command, args, cwd, binary = false) {
  commands.push([command, ...args].join(' '))
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = [], stderr = []
    child.stdout.on('data', data => { stdout.push(data) }); child.stderr.on('data', data => { stderr.push(data) })
    child.on('error', reject)
    child.on('close', code => {
      const text = Buffer.concat([...stdout, ...stderr]).toString('utf8')
      code === 0 ? resolve(binary ? Buffer.concat(stdout) : text) : reject(new Error(`${command} exited ${code}: ${text.slice(-6000)}`))
    })
  })
}
const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name) }
if (!process.argv.includes('--reuse-artifacts')) {
  await run('pnpm', ['--filter', '@axis-iam/vertex', 'build'], repo)
  await run('pnpm', ['--filter', '@axis-iam/vertex-react', 'build'], repo)
  for (const pkg of ['core', 'react']) await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages', pkg))
}
const tarballs = []
for (const name of ['axis-iam-vertex-0.1.0', 'axis-iam-vertex-react-0.1.0']) {
  const original = join(artifacts, `${name}.tgz`)
  const digest = createHash('sha256').update(await readFile(original)).digest('hex')
  // A stable tarball path can reuse pnpm's stale file-dependency resolution.
  const tar = join(artifacts, `${name}-${digest}.tgz`)
  await cp(original, tar)
  tarballs.push(tar)
  const entries = (await run('tar', ['-tzf', tar], repo)).split('\n').filter(name => name && !name.endsWith('/'))
  assert(entries.every(name => /^package\/(dist\/|README\.md$|package\.json$|LICENSE)/.test(name)), `${tar.split('/').at(-1)} has only intended package content`)
  const manifest = []
  for (const entry of entries) {
    const content = await run('tar', ['-xOf', tar, entry], repo, true), data = content.toString('utf8')
    assert(!/\/home\/chaos|TASK-2026|\.worktrees|["']workspace:|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9]{24}/.test(data), `archive scan ${entry}`)
    manifest.push({ path: entry, sha256: createHash('sha256').update(content).digest('hex') })
  }
  hashes.push({ file: tar.split('/').at(-1), sha256: digest, files: manifest })
}
const [coreTar, reactTar] = tarballs
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@axis-iam/vertex': `file:${coreTar}`, '@axis-iam/vertex-react': `file:${reactTar}`, react: '19.2.0', 'react-dom': '19.2.0' }, devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', '@types/node': '^22.0.0', esbuild: '0.25.0', typescript: '5.7.3', 'playwright-core': '1.56.1' } }, null, 2))
await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], consumer)
for (const [i, name] of ['@axis-iam/vertex', '@axis-iam/vertex-react'].entries()) {
  const installed = join(consumer, 'node_modules', name)
  assert((await realpath(installed)).startsWith(join(consumer, 'node_modules') + '/'), `${name}: installed package resolves inside the fresh consumer`)
  for (const entry of hashes[i].files) {
    const content = await readFile(join(installed, entry.path.slice('package/'.length)))
    assert(createHash('sha256').update(content).digest('hex') === entry.sha256, `installed artifact identity ${name}/${entry.path}`)
  }
}
await cp(join(repo, 'packages/react/examples/AccountSecurity.tsx'), join(consumer, 'AccountSecurity.tsx'))
await cp(join(import.meta.dirname, 'account-security/browser.tsx'), join(consumer, 'browser.tsx'))
await writeFile(join(consumer, 'identity-contract.ts'), "import type { IdentifierManagementCapability, IdentityProviderTarget } from '@axis-iam/vertex'; import type { IdentityOperationStore, OperationView } from '@axis-iam/vertex-react'; export async function management(store: IdentityOperationStore) { const snapshot = await store.identifiers(); const phone: IdentifierManagementCapability = snapshot.management.add.PHONE; return { phone, proofOptions: snapshot.management.proofOptions, replacements: snapshot.items.flatMap(item => item.capabilities.REMOVE.replacementPrimaryIds) }; } export function target(operation: OperationView): IdentityProviderTarget | null { return operation.providerTarget; }")
await run('pnpm', ['exec', 'tsc', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', '--jsx', 'react-jsx', 'AccountSecurity.tsx', 'identity-contract.ts'], consumer)
const exportsCheck = "const c=await import('@axis-iam/vertex'); const r=await import('@axis-iam/vertex-react'); for(const k of ['parseMfaOperation','parseMfaCapabilities','CookieSessionTransport','MfaOperationResponseError'])if(!c[k])throw Error(k); for(const k of ['OAuthClient','ServerSessionClient','AccountSecurityPanel','AccountSecurityDialog','AccountCenter','useAccountSecurity','AccountSecurityStore','AccountSecurityOperations'])if(!r[k])throw Error(k);"
await run('node', ['--input-type=module', '-e', exportsCheck], consumer)
await run('node', ['--input-type=module', '-e', "const c=await import('@axis-iam/vertex');for(const key of ['parseIdentifierManagement','parseIdentifierActions','parseIdentityProviderTarget','IdentityManagementResponseError'])if(typeof c[key]!=='function')throw Error(key);"], consumer)
await run('node', ['-e', "const c=require('@axis-iam/vertex'),r=require('@axis-iam/vertex-react'); if(!c.parseMfaOperation||!c.parseIdentityProviderTarget||!c.parseIdentifierManagement||!r.AccountSecurityPanel||!r.ServerSessionClient)throw Error('CJS exports');"], consumer)
assert(true, 'clean tarball consumer: public examples typecheck and ESM/CJS exports')
await run('pnpm', ['exec', 'esbuild', 'browser.tsx', '--bundle', '--format=esm', '--jsx=automatic', '--define:process.env.NODE_ENV="production"', '--outfile=browser.js'], consumer)

const fixture = securityFixture(join(consumer, 'browser.js')), origin = await fixture.listen()
const require = createRequire(join(consumer, 'package.json')), { chromium } = require('playwright-core')
// Chromium's POSIX singleton socket has a short path limit. Keep its relative tmp path task-owned.
process.chdir(output)
process.env.TMPDIR = 'tmp'
let browser, completed = false
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const mount = async (mode, surface = 'panel', options = {}) => {
    fixture.reset(options)
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => failures.push({ kind: 'pageerror', message: error.message }))
    await page.goto(origin)
    const hostBoundary = await page.evaluate(() => JSON.stringify({ html: [...document.documentElement.attributes].map(a => [a.name, a.value]), body: [...document.body.attributes].map(a => [a.name, a.value]), background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily }))
    await page.waitForFunction(() => Boolean(window.accountSecurityHarness))
    await page.evaluate(([mode, surface]) => window.accountSecurityHarness.mount(mode, surface), [mode, surface])
    return { context, page, hostBoundary }
  }
  const click = (page, name) => page.getByRole('button', { name, exact: true }).click()
  const state = page => page.evaluate(() => window.accountSecurityHarness.state())
  const checkContrast = async (page, scheme) => {
    const ratios = await page.evaluate(() => {
      const rgb = color => color.match(/[\d.]+/g).map(Number)
      const luminance = color => rgb(color).slice(0, 3).map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
      return [...document.querySelectorAll('.axis-ac-dialog h2,.axis-ac-dialog h3,.axis-ac-dialog p,.axis-ac-dialog button:not([disabled])')]
        .filter(node => node.getClientRects().length > 0).map(node => {
          let surface = node
          while (surface.parentElement && rgb(getComputedStyle(surface).backgroundColor)[3] === 0) surface = surface.parentElement
          const foreground = luminance(getComputedStyle(node).color), background = luminance(getComputedStyle(surface).backgroundColor)
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        })
    })
    assert(ratios.length > 0 && ratios.every(ratio => ratio >= 4.5), `${scheme}: visible body/control text contrast >=4.5:1 (minimum ${Math.min(...ratios).toFixed(2)}:1)`)
  }
  for (const mode of ['oauth_tokens', 'server_session']) {
    const { context, page } = await mount(mode)
    await click(page, 'Set up authenticator'); await click(page, 'Show setup instructions')
    await page.getByText('FIXTUREONLYSETUP', { exact: true }).waitFor()
    await page.getByLabel('Verification code', { exact: true }).fill('000000'); await click(page, 'Confirm setup')
    await page.getByText('That code did not match. Try a current code.').waitFor()
    assert((await state(page)).hasMaterial, `${mode}: wrong code preserves original setup`)
    await page.getByLabel('Verification code', { exact: true }).fill('123456'); await click(page, 'Confirm setup')
    await page.getByText('Authenticator enabled. You can now generate recovery codes.').waitFor()
    assert(!(await state(page)).hasMaterial, `${mode}: confirmation clears setup; no eager recovery generation`)
    await click(page, 'Done'); await click(page, 'Generate recovery codes'); await click(page, 'Continue'); await click(page, 'Continue')
    await page.getByText('FIXTURE-CODE-ONE', { exact: true }).waitFor()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await click(page, 'Copy')
    assert(await page.evaluate(async () => (await navigator.clipboard.readText()) === 'FIXTURE-CODE-ONE\nFIXTURE-CODE-TWO'), `${mode}: recovery codes copy only on explicit action`)
    await page.evaluate(() => navigator.clipboard.writeText(''))
    const downloadEvent = page.waitForEvent('download')
    await click(page, 'Download codes')
    const download = await downloadEvent, downloaded = join(output, `${mode}-download.txt`)
    await download.saveAs(downloaded)
    assert((await readFile(downloaded, 'utf8')) === 'FIXTURE-CODE-ONE\nFIXTURE-CODE-TWO', `${mode}: recovery codes download is the explicitly delivered set`)
    await unlink(downloaded)
    const stored = await page.evaluate(() => [...Object.values(sessionStorage), ...Object.values(localStorage)].join(' '))
    assert(!/FIXTUREONLYSETUP|FIXTURE-CODE/.test(stored), `${mode}: no setup/codes in storage`)
    assert(!new URL(page.url()).search, `${mode}: no setup/codes in URL`)
    await click(page, 'Done'); await click(page, 'Turn off authenticator'); await click(page, 'Continue'); await click(page, 'Continue')
    await page.getByText('Your change succeeded. Sign in again to continue.').waitFor()
    assert((await state(page)).authenticated, `${mode}: definitive disable success is presented before session clearing`)
    const writes = fixture.requests.filter(r => r.path.includes('/mfa/operations') && r.method === 'POST')
    assert(writes.every(r => mode === 'server_session' ? r.csrf && !r.bearer : r.bearer && !r.csrf), `${mode}: correct bearer versus finite CSRF boundary`)
    await context.close()

    const lost = await mount(mode, 'panel', { lostBegin: true })
    await click(lost.page, 'Set up authenticator'); await click(lost.page, 'Show setup instructions')
    await lost.page.getByText('The result is not confirmed. Check this operation before making another change.').waitFor()
    await click(lost.page, 'Check this operation')
    await lost.page.getByText('Setup material was not received or has been cleared. Cancel this operation before starting a new setup.').waitFor()
    assert(fixture.requests.filter(r => r.path.endsWith('/begin')).length === 1, `${mode}: lost begin uses GET, not replay`)
    await click(lost.page, 'Cancel setup'); await click(lost.page, 'Confirm cancellation')
    await lost.page.getByRole('heading', { name: 'Operation cancelled', exact: true }).waitFor()
    assert(!(await state(lost.page)).hasMaterial, `${mode}: exact cancellation clears setup`)
    await lost.context.close()

    const codes = await mount(mode, 'custom', { lostComplete: true })
    await codes.page.evaluate(() => { window.confirm = () => true })
    await click(codes.page, 'Generate recovery codes'); await click(codes.page, 'Continue')
    await codes.page.getByText('The step did not complete. Check this operation before trying again.').waitFor()
    await click(codes.page, 'Check this operation')
    await codes.page.getByText('This set was generated but cannot be shown again. A new set needs a new deliberate confirmation.').waitFor()
    assert(fixture.requests.filter(r => r.path.endsWith('/complete')).length === 1, `${mode}: actual public Headless example never regenerates a lost code set`)
    await codes.context.close()
  }

  for (const mode of ['oauth_tokens', 'server_session']) {
    const { context, page } = await mount(mode, 'methods', { lostIdentityComplete: true })
    await click(page, 'Open account security')
    await page.getByRole('heading', { name: 'Login methods', exact: true }).waitFor()
    assert(await page.getByRole('button', { name: 'Add phone number', exact: true }).isDisabled(), `${mode}: authenticated kind denial disables addition`)
    await page.getByText('Verification delivery for this identifier is unavailable.').waitFor()
    await click(page, 'Manage emails')
    const summary = page.getByLabel('More actions: member@example.invalid', { exact: true })
    await summary.click()
    await summary.locator('..').getByRole('button', { name: 'Remove', exact: true }).click()
    const replacement = page.getByLabel('Replacement primary identifier (required when removing the primary)', { exact: true })
    assert(await replacement.locator('option').count() === 2 && await replacement.inputValue() === '', `${mode}: only the explicit off-page eligible primary is offered, never auto-selected`)
    await page.getByRole('region', { name: 'Requirements for this change' }).waitFor()
    await click(page, 'Continue later')
    await page.getByText('Connect a provider', { exact: true }).click()
    await click(page, 'Connect')
    await page.getByText('Waiting for the verified external account. Authorize with the provider before confirming the connection.').waitFor()
    assert(await page.getByRole('region', { name: 'External account to connect' }).count() === 0, `${mode}: no guessed target before authorization`)
    await page.getByLabel('Confirm your current password', { exact: true }).fill('isolated-fixture-password')
    await click(page, 'Verify and continue')
    const popupEvent = page.waitForEvent('popup')
    await click(page, 'Use Catalog directory label')
    const popup = await popupEvent
    await popup.waitForURL(url => url.searchParams.get('identity_operation') === 'proof_pending')
    await click(page, 'I completed provider confirmation')
    const target = page.getByRole('region', { name: 'External account to connect', exact: true })
    await target.getByText('v***@verified.invalid', { exact: true }).waitFor()
    assert(!(await target.textContent()).includes('Catalog directory label'), `${mode}: returned target is actual masked adapter identity, not the directory`)
    assert(fixture.requests.filter(request => request.path.includes('/identity-operations/') && request.path.endsWith('/complete')).length === 0, `${mode}: provider return never commits before explicit target confirmation`)
    assert(!(await page.locator('body').textContent()).includes('a'.repeat(64)), `${mode}: opaque target reference is not displayed`)
    if (mode === 'server_session') {
      await page.screenshot({ path: join(output, 'provider-desktop-light-en.png'), fullPage: true })
      await page.evaluate(() => { window.accountSecurityHarness.theme('dark'); window.accountSecurityHarness.locale('zh-CN') })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('region', { name: '即将绑定的第三方账号' }).waitFor()
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'provider target mobile: no horizontal overflow')
      await page.screenshot({ path: join(output, 'provider-mobile-dark-zh.png'), fullPage: true })
      await page.evaluate(() => { window.accountSecurityHarness.theme('light'); window.accountSecurityHarness.locale('en') })
      await page.setViewportSize({ width: 1100, height: 900 })
    }
    await click(page, 'Confirm connection')
    await click(page, 'Check latest status')
    await page.getByRole('heading', { name: 'Change completed', exact: true }).waitFor()
    await page.getByText('v***@verified.invalid', { exact: true }).waitFor()
    const writes = fixture.requests.filter(request => request.path.includes('/identity-operations/') && request.method === 'POST')
    assert(writes.filter(request => request.path.endsWith('/complete')).length === 1, `${mode}: lost LINK completion recovers the same committed target without replay`)
    assert(writes.every(request => mode === 'server_session' ? request.csrf && !request.bearer : request.bearer && !request.csrf), `${mode}: LINK proof and confirmation preserve finite CSRF/bearer boundaries`)
    await click(page, 'Done')
    assert(await page.getByRole('region', { name: 'External account to connect' }).count() === 0, `${mode}: acknowledgement clears the target presentation`)
    await context.close()
  }

  const visual = await mount('server_session', 'center')
  await click(visual.page, 'Open account security')
  await visual.page.getByRole('heading', { name: 'Security verification', exact: true }).waitFor()
  assert(await visual.page.getByRole('navigation', { name: 'Account sections' }).getByRole('button').count() === 6, 'AccountCenter: six actual sections')
  for (const section of ['Profile', 'Login methods', 'Password', 'Sessions', 'Permissions', 'Security']) {
    await visual.page.getByRole('navigation', { name: 'Account sections' }).getByRole('button', { name: section, exact: true }).click()
    assert(await visual.page.locator('.axis-ac-content section').count() > 0, `AccountCenter actual ${section} content`)
  }
  await visual.page.evaluate(() => window.accountSecurityHarness.theme('system'))
  await visual.page.emulateMedia({ colorScheme: 'dark' })
  await visual.page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-color-scheme') === 'dark')
  await visual.page.emulateMedia({ colorScheme: 'light' })
  await visual.page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-color-scheme') === 'light')
  assert(true, 'system theme responds to runtime media changes')
  await checkContrast(visual.page, 'desktop light')
  await visual.page.getByRole('button', { name: 'Close account center', exact: true }).focus()
  await visual.page.keyboard.press('Shift+Tab')
  assert(await visual.page.getByRole('button', { name: 'Generate recovery codes', exact: true }).evaluate(node => node === document.activeElement), 'AccountCenter traps reverse Tab at its first control')
  await visual.page.keyboard.press('Tab')
  assert(await visual.page.getByRole('button', { name: 'Close account center', exact: true }).evaluate(node => node === document.activeElement), 'AccountCenter traps forward Tab at its last control')
  await visual.page.screenshot({ path: join(output, 'desktop-light-en.png'), fullPage: true })
  await visual.page.getByRole('navigation', { name: 'Account sections' }).getByRole('button', { name: 'Security', exact: true }).focus()
  await visual.page.evaluate(() => { window.accountSecurityHarness.theme('dark'); window.accountSecurityHarness.locale('zh-CN') })
  await visual.page.setViewportSize({ width: 390, height: 844 })
  await visual.page.getByRole('heading', { name: '安全验证', exact: true }).waitFor()
  await visual.page.waitForFunction(() => document.activeElement === document.querySelector('.axis-ac-close'))
  assert(true, 'responsive AccountCenter restores focus when desktop navigation becomes hidden')
  await checkContrast(visual.page, 'mobile dark')
  await visual.page.screenshot({ path: join(output, 'mobile-dark-zh.png'), fullPage: true })
  assert(await visual.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile: no document horizontal overflow')
  assert(await visual.page.evaluate(() => document.documentElement.dataset.hostTheme === 'unchanged'), 'theme changes preserve host document attributes')
  assert(await visual.page.evaluate(() => JSON.stringify({ html: [...document.documentElement.attributes].map(a => [a.name, a.value]), body: [...document.body.attributes].map(a => [a.name, a.value]), background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily })) === visual.hostBoundary, 'SDK themes leave all host root/body attributes and computed host background/font unchanged')
  await visual.page.keyboard.press('Escape')
  await visual.page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert(await visual.page.locator('#consumer-open').evaluate(node => node === document.activeElement), 'AccountCenter Escape restores trigger focus')
  await visual.context.close()

  const dialog = await mount('oauth_tokens', 'dialog')
  await click(dialog.page, 'Open account security'); await click(dialog.page, 'Set up authenticator'); await click(dialog.page, 'Show setup instructions')
  await dialog.page.getByText('FIXTUREONLYSETUP', { exact: true }).waitFor()
  await dialog.page.keyboard.press('Escape')
  await dialog.page.getByText('Cancel this operation? Any setup material will stop working.', { exact: true }).waitFor()
  await click(dialog.page, 'Confirm cancellation')
  await dialog.page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert(fixture.requests.filter(r => r.path.endsWith('/cancel')).length === 1, 'Dialog: one protected exact cancellation on Escape')
  assert(await dialog.page.locator('#consumer-open').evaluate(node => node === document.activeElement), 'Dialog restores focus and hides sensitive material')
  await dialog.context.close()
  assert(failures.length === 0, 'browser has no uncaught application errors')
  completed = true
} catch (error) {
  failures.push({ kind: 'harness', message: error instanceof Error ? error.message : 'Harness failed' })
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => fixture.server.close(resolve))
  await writeFile(join(output, completed ? 'consumer-result.json' : `consumer-failure-${Date.now()}.json`), JSON.stringify({ status: completed ? 'PASS' : 'FAIL', scope: 'isolated packed public-package protocol fixtures; NOT real-backend AS13 or independent acceptance', consumer, fixtureOrigin: origin, commands, checks, failures, artifacts: hashes, resourcesReleased: true }, null, 2))
}
console.log(JSON.stringify({ checks: checks.length, failures: failures.length, artifacts: hashes.map(({ file, sha256 }) => ({ file, sha256 })), resourcesReleased: true }))
