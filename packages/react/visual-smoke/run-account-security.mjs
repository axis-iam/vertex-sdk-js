import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, cp, unlink, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { securityFixture } from './account-security/fixture.mjs'
import { runActionsScenario } from './account-security/actions-scenario.mjs'
import { runDiscoveryScenario } from './account-security/discovery-scenario.mjs'
import { runConfirmationScenario } from './account-security/confirmation-scenario.mjs'

if (!process.env.ACCOUNT_SECURITY_OUTPUT) throw new Error('Set ACCOUNT_SECURITY_OUTPUT to an isolated task-owned output directory')
const scenarioIndex = process.argv.indexOf('--scenario')
const scenario = scenarioIndex < 0 ? 'full' : process.argv[scenarioIndex + 1]
if (!['full', 'methods-security-cancel', 'discovery-username-ready', 'confirmation-ux'].includes(scenario)) throw new Error('Unknown account-security scenario')
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
if (scenario === 'discovery-username-ready' || scenario === 'confirmation-ux') {
  const binding = JSON.parse(await readFile(join(output, 'package-binding.json'), 'utf8'))
  assert(binding.status === 'PASS' && binding.packages.length === 2, 'final package binding is complete')
  for (const [index, name] of ['core', 'react'].entries()) {
    const entry = binding.packages.find(pkg => pkg.package === name)
    assert(entry?.sha256 === hashes[index].sha256 && entry.sources.length > 0, `${name}: consumer archive matches the final package binding`)
    for (const source of entry.sources) {
      const content = await readFile(join(repo, source.path))
      assert(createHash('sha256').update(content).digest('hex') === source.sha256, `${name}: package source binding ${source.path}`)
    }
  }
}
const baselineHash = '57f7de5ab8902fc110364912bdee8626206eb1c22048821e13c6faf0771f0a6c'
const baselineArtifact = scenario === 'discovery-username-ready' ? resolve(output, '../round02-account-center/artifacts', `axis-iam-vertex-react-0.1.0-${baselineHash}.tgz`) : null
if (baselineArtifact) assert(createHash('sha256').update(await readFile(baselineArtifact)).digest('hex') === baselineHash, 'before screenshots use the exact retained round02 React artifact')
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@axis-iam/vertex': `file:${coreTar}`, '@axis-iam/vertex-react': `file:${reactTar}`, ...(baselineArtifact ? { '@axis-iam/vertex-react-before': `file:${baselineArtifact}` } : {}), react: '19.2.0', 'react-dom': '19.2.0' }, devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', '@types/node': '^22.0.0', esbuild: '0.25.0', typescript: '5.7.3', 'playwright-core': '1.56.1' } }, null, 2))
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

let baselineBundle
if (baselineArtifact) {
  await writeFile(join(consumer, 'browser-before.tsx'), (await readFile(join(consumer, 'browser.tsx'), 'utf8')).replaceAll('@axis-iam/vertex-react', '@axis-iam/vertex-react-before'))
  await run('pnpm', ['exec', 'esbuild', 'browser-before.tsx', '--bundle', '--format=esm', '--jsx=automatic', '--define:process.env.NODE_ENV="production"', '--outfile=browser-before.js'], consumer)
  baselineBundle = join(consumer, 'browser-before.js')
}
const fixture = securityFixture(join(consumer, 'browser.js'), baselineBundle), origin = await fixture.listen()
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
  const checkLayout = async (page, label) => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const result = await page.evaluate(() => {
      const root = document.querySelector('.axis-ac-content') ?? document.querySelector('.axis-security-content')
      const controls = [...root.querySelectorAll('button,input,select,summary')].filter(node => {
        if (node.getClientRects().length === 0) return false
        const closedDisclosure = node.closest('details:not([open])')
        return !closedDisclosure || (node.matches('summary') && node.parentElement === closedDisclosure)
      })
      const popovers = [...root.querySelectorAll('.axis-identity-action-popover')].filter(node =>
        node.closest('details')?.open && node.getClientRects().length > 0)
      const backgroundControls = controls.filter(node => !node.closest('.axis-identity-action-popover'))
      const boxes = backgroundControls.map(node => node.getBoundingClientRect())
      const menuOverlap = popovers.some(popover => {
        const menuControls = controls.filter(node => popover.contains(node)).map(node => node.getBoundingClientRect())
        return menuControls.some((a, i) => menuControls.slice(i + 1).some(b =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))
      })
      const rootBox = root.getBoundingClientRect()
      const menuClipped = popovers.some(popover => {
        const box = popover.getBoundingClientRect()
        return box.left < rootBox.left - 1 || box.right > rootBox.right + 1 || box.top < rootBox.top - 1 || box.bottom > rootBox.bottom + 1
      })
      return {
        overflow: root.scrollWidth > root.clientWidth + 1,
        clipped: controls.some(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1),
        menuClipped,
        menuBounds: popovers.map(popover => {
          const box = popover.getBoundingClientRect()
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, root: { left: rootBox.left, right: rootBox.right, top: rootBox.top, bottom: rootBox.bottom } }
        }),
        overlap: boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)),
        menuOverlap,
      }
    })
    assert(!result.overflow && !result.clipped && !result.menuClipped && !result.overlap && !result.menuOverlap, `${label}: no overflow, clipped controls, out-of-bounds menus, or overlapping actions (${JSON.stringify(result)})`)
  }
  const checkContrast = async (page, scheme) => {
    const ratios = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1; canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Contrast measurement requires a canvas color context')
      const rgb = color => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
        return [red, green, blue, alpha / 255]
      }
      const luminance = color => rgb(color).slice(0, 3).map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
      return [...document.querySelectorAll('.axis-ac-dialog h2,.axis-ac-dialog h3,.axis-ac-dialog p,.axis-ac-dialog button:not([disabled]),.axis-account-confirmation h2,.axis-account-confirmation p,.axis-account-confirmation button:not([disabled])')]
        .filter(node => node.getClientRects().length > 0).map(node => {
          let surface = node
          while (surface.parentElement && rgb(getComputedStyle(surface).backgroundColor)[3] === 0) surface = surface.parentElement
          const foreground = luminance(getComputedStyle(node).color), background = luminance(getComputedStyle(surface).backgroundColor)
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        })
    })
    assert(ratios.length > 0 && ratios.every(ratio => ratio >= 4.5), `${scheme}: visible body/control text contrast >=4.5:1 (minimum ${Math.min(...ratios).toFixed(2)}:1)`)
  }
  if (scenario === 'confirmation-ux') {
    await runConfirmationScenario({ mount, click, state, checkLayout, checkContrast, assert, fixture, output })
    assert(failures.length === 0, 'browser has no uncaught application errors')
    completed = true
  } else if (scenario === 'discovery-username-ready') {
    await runDiscoveryScenario({ mount, click, state, checkLayout, checkContrast, assert, fixture, output })
    assert(failures.length === 0, 'browser has no uncaught application errors')
    completed = true
  } else if (scenario === 'methods-security-cancel') {
    await runActionsScenario({ mount, click, state, checkLayout, checkContrast, assert, fixture, output })
    assert(failures.length === 0, 'browser has no uncaught application errors')
    completed = true
  } else {
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
    if (mode === 'server_session') {
      await checkLayout(page, 'authenticator success')
      assert(await page.locator('.axis-security-symbol').evaluate(node => {
        const symbol = node.getBoundingClientRect(), result = node.closest('.axis-security-result').getBoundingClientRect()
        return Math.abs((symbol.left + symbol.right - result.left - result.right) / 2) < 1
      }), 'authenticator success icon is centered in the actual packed panel')
      await page.screenshot({ path: join(output, 'authenticator-success-light-en.png'), fullPage: true })
    }
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
    assert(await page.locator('.axis-identity-email-row').count() === 5, `${mode}: eleven emails render only five email rows per page`)
    assert(await page.getByRole('button', { name: 'Add email', exact: true }).count() === 1 && await page.locator('.axis-identity-additions').count() === 0, `${mode}: email management has one addition entry and no unrelated method additions`)
    const primaryEmail = page.locator('.axis-identity-email-row').first()
    assert(await primaryEmail.locator('.axis-identity-email-status .axis-identity-email-badge').count() === 2, `${mode}: primary and verification states use separate badges`)
    await click(page, 'Next'); await click(page, 'Next')
    assert(await page.locator('.axis-identity-email-row').count() === 1, `${mode}: last email page contains only its remaining record`)
    await click(page, 'Previous'); await click(page, 'Previous')
    const longEmailSummary = page.getByLabel('More actions: member.2.with-a-long-address@example.invalid', { exact: true })
    await longEmailSummary.click()
    const primaryAction = longEmailSummary.locator('..').getByRole('button', { name: 'Set primary', exact: true })
    assert(await primaryAction.isVisible() && await primaryAction.isDisabled(), `${mode}: unavailable primary action remains explicitly disabled in the menu`)
    await longEmailSummary.locator('..').getByText('Verify this identifier first.', { exact: true }).waitFor()
    assert(await longEmailSummary.locator('..').locator('[data-action="REMOVE"] button').evaluate(node => {
      const root = document.querySelector('.axis-identity-methods'), expected = document.createElement('span')
      expected.style.color = 'var(--a-danger)'; root.append(expected)
      const danger = getComputedStyle(expected).color, actual = getComputedStyle(node).color
      expected.remove()
      return actual === danger
    }), `${mode}: removal action uses the active semantic danger color`)
    if (mode === 'server_session') {
      await page.screenshot({ path: join(output, 'email-actions-desktop-light-en.png'), fullPage: true })
      await checkLayout(page, 'expanded long email actions on desktop')
      await page.evaluate(() => { window.accountSecurityHarness.theme('dark'); window.accountSecurityHarness.locale('zh-CN') })
      const longEmailSummaryZh = page.getByLabel('更多操作: member.2.with-a-long-address@example.invalid', { exact: true })
      await longEmailSummaryZh.waitFor()
      await page.screenshot({ path: join(output, 'sdk08-emails-desktop-dark-zh.png'), fullPage: true })
      await page.setViewportSize({ width: 768, height: 900 })
      await checkLayout(page, 'expanded long email actions in a narrow desktop container dark zh')
      await page.screenshot({ path: join(output, 'sdk08-emails-tablet-dark-zh.png'), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await checkLayout(page, 'expanded long email actions on mobile dark zh')
      await page.screenshot({ path: join(output, 'sdk08-emails-mobile-dark-zh.png'), fullPage: true })
      await page.evaluate(() => { window.accountSecurityHarness.theme('light'); window.accountSecurityHarness.locale('en') })
      await page.setViewportSize({ width: 1100, height: 900 })
    }
    await page.getByLabel('More actions: member.2.with-a-long-address@example.invalid', { exact: true }).click()
    const summary = page.getByLabel('More actions: member@example.invalid', { exact: true })
    await summary.click()
    await summary.locator('..').getByRole('button', { name: 'Remove', exact: true }).click()
    const replacement = page.getByLabel('Replacement primary identifier (required when removing the primary)', { exact: true })
    assert(await replacement.locator('option').count() === 2 && await replacement.inputValue() === '', `${mode}: only the explicit off-page eligible primary is offered, never auto-selected`)
    await page.getByRole('region', { name: 'Requirements for this change' }).waitFor()
    await click(page, 'Continue later')
    await click(page, 'Back to email overview')
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
  const sections = [
    { en: 'Profile', zh: '个人资料', file: 'profile' },
    { en: 'Login methods', zh: '登录方式', file: 'methods' },
    { en: 'Password', zh: '密码', file: 'password' },
    { en: 'Security', zh: '安全验证', file: 'security' },
    { en: 'Sessions', zh: '会话', file: 'sessions' },
    { en: 'Permissions', zh: '访问权限', file: 'permissions' },
  ]
  const selectSection = async index => visual.page.locator('.axis-ac-nav button').nth(index).click()
  for (const [index, section] of sections.entries()) {
    await selectSection(index)
    if (section.en === 'Profile') await visual.page.getByRole('region', { name: 'Account profile' }).waitFor()
    if (section.en === 'Login methods') await visual.page.getByRole('region', { name: 'Login methods' }).waitFor()
    if (section.en === 'Password') await visual.page.getByRole('region', { name: 'Password change' }).waitFor()
    if (section.en === 'Sessions') await visual.page.getByRole('region', { name: 'Account sessions' }).waitFor()
    if (section.en === 'Permissions') await visual.page.getByRole('region', { name: 'Account permissions' }).waitFor()
    if (section.en === 'Security') await visual.page.getByRole('region', { name: 'Security verification' }).waitFor()
    await checkLayout(visual.page, `${section.en} section desktop light EN`)
    await checkContrast(visual.page, `${section.en} desktop light`)
    if (section.en === 'Login methods') assert(await visual.page.locator('.axis-identity-methods').evaluate(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'), 'light methods inherit the single AccountCenter content surface')
    assert(await visual.page.locator('.axis-ac-content section').count() > 0, `AccountCenter actual ${section.en} content`)
    if (section.en === 'Permissions') {
      await visual.page.locator('.axis-iam-permission-overview').waitFor()
      assert(await visual.page.locator('#iam-permission-check,.axis-iam-permission-checker').count() === 0, 'packed AccountCenter never renders the raw permission checker')
      assert(!(await visual.page.locator('.axis-ac-content').textContent()).includes('documents:read'), 'packed permissions summary contains no raw internal permission code')
    }
    await visual.page.screenshot({ path: join(output, `sdk08-${section.file}-desktop-light-en.png`), fullPage: true })
  }
  await visual.page.evaluate(() => { window.accountSecurityHarness.theme('dark'); window.accountSecurityHarness.locale('zh-CN') })
  for (const [index, section] of sections.entries()) {
    await selectSection(index)
    await visual.page.getByRole('heading', { name: section.zh, exact: true }).waitFor()
    await checkLayout(visual.page, `${section.zh} section desktop dark zh`)
    await checkContrast(visual.page, `${section.en} desktop dark`)
    if (section.en === 'Login methods') assert(await visual.page.locator('.axis-identity-methods').evaluate(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'), 'dark methods inherit the single AccountCenter content surface')
    await visual.page.screenshot({ path: join(output, `sdk08-${section.file}-desktop-dark-zh.png`), fullPage: true })
  }
  await visual.page.evaluate(() => window.accountSecurityHarness.theme('system'))
  await visual.page.emulateMedia({ colorScheme: 'dark' })
  await visual.page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-color-scheme') === 'dark')
  await visual.page.emulateMedia({ colorScheme: 'light' })
  await visual.page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-color-scheme') === 'light')
  assert(true, 'system theme responds to runtime media changes')
  await checkContrast(visual.page, 'desktop light')
  await visual.page.evaluate(() => { window.accountSecurityHarness.theme('light'); window.accountSecurityHarness.locale('en') })
  await visual.page.keyboard.press('Escape')
  await visual.page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert(await visual.page.locator('#consumer-open').evaluate(node => node === document.activeElement), 'AccountCenter Escape restores trigger focus')
  await click(visual.page, 'Open account security')
  await visual.page.getByRole('heading', { name: 'Security verification', exact: true }).waitFor()
  await visual.page.getByRole('button', { name: 'Close account center', exact: true }).focus()
  await visual.page.keyboard.press('Shift+Tab')
  assert(await visual.page.getByRole('button', { name: 'Generate recovery codes', exact: true }).evaluate(node => node === document.activeElement), 'AccountCenter traps reverse Tab at its first control')
  await visual.page.keyboard.press('Tab')
  assert(await visual.page.getByRole('button', { name: 'Close account center', exact: true }).evaluate(node => node === document.activeElement), 'AccountCenter traps forward Tab at its last control')
  await visual.page.screenshot({ path: join(output, 'desktop-light-en.png'), fullPage: true })
  await visual.page.getByRole('navigation', { name: 'Account sections' }).getByRole('button', { name: 'Security', exact: true }).focus()
  await visual.page.evaluate(() => { window.accountSecurityHarness.theme('dark'); window.accountSecurityHarness.locale('zh-CN') })
  await visual.page.setViewportSize({ width: 390, height: 844 })
  await visual.page.waitForFunction(() => document.activeElement === document.querySelector('.axis-ac-close'))
  assert(true, 'responsive AccountCenter restores focus when desktop navigation becomes hidden')
  for (const [index, section] of sections.entries()) {
    await visual.page.locator('.axis-ac-back').click()
    await visual.page.locator('.axis-ac-nav button').nth(index).click()
    await visual.page.getByRole('heading', { name: section.zh, exact: true }).waitFor()
    await checkLayout(visual.page, `${section.zh} section mobile dark zh`)
    await checkContrast(visual.page, `${section.en} mobile dark`)
    await visual.page.screenshot({ path: join(output, `sdk08-${section.file}-mobile-dark-zh.png`), fullPage: true })
  }
  await checkContrast(visual.page, 'mobile dark')
  assert(await visual.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile: no document horizontal overflow')
  assert(await visual.page.evaluate(() => document.documentElement.dataset.hostTheme === 'unchanged'), 'theme changes preserve host document attributes')
  assert(await visual.page.evaluate(() => JSON.stringify({ html: [...document.documentElement.attributes].map(a => [a.name, a.value]), body: [...document.body.attributes].map(a => [a.name, a.value]), background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily })) === visual.hostBoundary, 'SDK themes leave all host root/body attributes and computed host background/font unchanged')
  await visual.page.evaluate(() => { window.accountSecurityHarness.theme('light'); window.accountSecurityHarness.locale('en') })
  await visual.page.setViewportSize({ width: 1100, height: 900 })
  await selectSection(3)
  await click(visual.page, 'Set up authenticator')
  await click(visual.page, 'Cancel setup')
  await visual.page.getByText('Cancel this operation? Any setup material will stop working.', { exact: true }).waitFor()
  await checkLayout(visual.page, 'security cancellation confirmation')
  await visual.page.screenshot({ path: join(output, 'cancel-confirmation-desktop-light-en.png'), fullPage: true })
  await click(visual.page, 'Confirm cancellation')
  await visual.page.getByRole('heading', { name: 'Operation cancelled', exact: true }).waitFor()
  await checkLayout(visual.page, 'cancelled security result')
  await click(visual.page, 'Done')
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
  }
} catch (error) {
  failures.push({ kind: 'harness', message: error instanceof Error ? error.message : 'Harness failed' })
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => fixture.server.close(resolve))
  await writeFile(join(output, completed ? 'consumer-result.json' : `consumer-failure-${Date.now()}.json`), JSON.stringify({ status: completed ? 'PASS' : 'FAIL', scenario, baselineArtifact, baselineHash: baselineArtifact ? baselineHash : null, scope: 'isolated packed public-package protocol fixtures; NOT real-backend AS13 or independent acceptance', consumer, fixtureOrigin: origin, commands, checks, failures, artifacts: hashes, resourcesReleased: true }, null, 2))
}
console.log(JSON.stringify({ checks: checks.length, failures: failures.length, artifacts: hashes.map(({ file, sha256 }) => ({ file, sha256 })), resourcesReleased: true }))
