import { join } from 'node:path'

const variants = [
  { name: 'desktop-light-en', width: 1100, height: 900, theme: 'light', locale: 'en' },
  { name: 'desktop-dark-zh', width: 1100, height: 900, theme: 'dark', locale: 'zh-CN' },
  { name: 'mobile-light-en', width: 390, height: 844, theme: 'light', locale: 'en' },
  { name: 'mobile-dark-zh', width: 390, height: 844, theme: 'dark', locale: 'zh-CN' },
]
export async function runDiscoveryScenario({ mount, click, state, checkLayout, checkContrast, assert, fixture, output }) {
  const configure = async (page, variant) => {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await page.evaluate(v => { window.accountSecurityHarness.theme(v.theme); window.accountSecurityHarness.locale(v.locale) }, variant)
    await page.waitForFunction(theme => document.querySelector('.axis-ac-dialog')?.dataset.colorScheme === theme, variant.theme)
  }
  const capture = async (page, name) => {
    await page.mouse.move(0, 0)
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, mask: [page.locator('.axis-security-setup svg,.axis-security-setup code,.axis-security-codes,input')] })
  }
  const resetScroll = page => page.locator('.axis-ac-content').evaluate(node => { node.scrollTop = 0; node.parentElement.scrollTop = 0 })
  const pair = async (page, name, prepare = async () => {}) => {
    for (const v of [variants[0], variants[3]]) {
      await configure(page, v); await prepare(page)
      await checkLayout(page, `${name} ${v.name}`)
      await capture(page, `${name}-${v.name}`)
    }
    await configure(page, variants[0])
  }
  // Capture the retained round02 package with the same fixture and viewports, without replaying its old suite.
  for (const surface of ['methods', 'center']) {
    const before = await mount('server_session', surface, { before: true, username: true })
    await click(before.page, 'Open account security')
    if (surface === 'methods') await before.page.getByText('existing.member', { exact: true }).waitFor()
    else { await click(before.page, 'Set up authenticator'); await before.page.getByRole('button', { name: 'Show setup instructions', exact: true }).waitFor() }
    for (const v of variants) {
      await configure(before.page, v)
      await resetScroll(before.page)
      await capture(before.page, `before-${surface === 'methods' ? 'methods-default' : 'ready'}-${v.name}`)
      if (surface === 'methods') {
        await before.page.locator('.axis-identity-provider-additions').scrollIntoViewIfNeeded()
        await capture(before.page, `before-provider-closed-${v.name}`)
      }
    }
    await before.context.close()
  }

  const methods = await mount('server_session', 'methods', { username: true, longProvider: true })
  const p = methods.page
  await click(p, 'Open account security'); await p.getByText('existing.member', { exact: true }).waitFor()
  for (const v of variants) {
    await configure(p, v)
    const toggle = p.locator('.axis-identity-provider-toggle')
    await resetScroll(p)
    assert(await toggle.getAttribute('aria-expanded') === 'false' && await toggle.locator('svg').count() === 2, `SDK12 ${v.name}: Provider action has link/chevron icons and closed state`)
    assert(await toggle.evaluate(node => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)' && node.tagName === 'BUTTON'), `SDK12 ${v.name}: disclosure is a native visible secondary button`)
    assert(await p.getByRole('button', { name: /^(Add username|添加用户名)$/ }).count() === 0, `SDK13 ${v.name}: an existing username has no duplicate ADD affordance`)
    assert(await p.locator('.axis-identity-record').getByRole('button', { name: /^(Change|更改)$/ }).isEnabled(), `SDK13 ${v.name}: Change is immediately visible outside a menu`)
    assert(await p.locator('.axis-identity-record').getByRole('button', { name: /^(Change|更改)$/ }).evaluate(node => {
      const text = document.createRange(); text.selectNodeContents(node)
      return text.getClientRects().length === 1
    }), `SDK13 ${v.name}: Change label stays on one line in its responsive action row`)
    await checkLayout(p, `methods default ${v.name}`); await checkContrast(p, `methods default ${v.name}`)
    await capture(p, `after-methods-default-${v.name}`)
    await toggle.scrollIntoViewIfNeeded()
    await capture(p, `after-provider-closed-${v.name}`)
  }
  await configure(p, variants[0])
  const toggle = p.locator('.axis-identity-provider-toggle')
  await toggle.focus(); await p.keyboard.press('Space')
  await p.waitForFunction(() => document.querySelector('.axis-identity-provider-toggle')?.getAttribute('aria-expanded') === 'true')
  assert(await p.locator('.axis-identity-provider-additions .axis-identity-addition-row').count() === 2, 'SDK12: expanded Provider choices retain available and denied actions')
  await p.keyboard.press('Enter')
  await p.waitForFunction(() => document.querySelector('.axis-identity-provider-toggle')?.getAttribute('aria-expanded') === 'false')
  assert(await toggle.evaluate(node => node === document.activeElement), 'SDK12: native Space/Enter toggle retains keyboard focus')
  await p.keyboard.press('Enter')
  await pair(p, 'after-provider-expanded', page => page.locator('.axis-identity-provider-additions').scrollIntoViewIfNeeded())
  await p.locator('.axis-identity-provider-additions .axis-identity-addition-row').first().getByRole('button', { name: 'Connect', exact: true }).click()
  await p.getByLabel('Confirm your current password', { exact: true }).waitFor()
  assert(fixture.requests.filter(request => request.path.endsWith('/identity-operations') && request.method === 'POST').length === 1, 'SDK12: Connect opens the existing proof-gated LINK operation')
  await methods.context.close()

  const username = await mount('server_session', 'methods', { username: true })
  await click(username.page, 'Open account security'); await username.page.getByText('existing.member', { exact: true }).waitFor()
  await click(username.page, 'Change')
  await username.page.getByRole('heading', { name: 'Change: existing.member', exact: true }).waitFor()
  await pair(username.page, 'after-username-change')
  await username.page.getByLabel('Identifier', { exact: true }).fill('replacement.member')
  await click(username.page, 'Complete change')
  const proof = username.page.getByLabel('Confirm your current password', { exact: true })
  await proof.waitFor()
  assert(fixture.requests.filter(request => request.path.endsWith('/complete')).length === 0, 'SDK13: Change creates REPLACE without skipping current-account proof')
  await proof.fill('isolated-fixture-password'); await click(username.page, 'Verify and continue')
  await click(username.page, 'Complete change')
  await username.page.getByRole('heading', { name: 'Change completed', exact: true }).waitFor()
  await click(username.page, 'Done'); await username.page.getByText('replacement.member', { exact: true }).waitFor()
  assert(fixture.requests.filter(request => request.path.endsWith('/complete')).length === 1, 'SDK13: one proof-gated REPLACE updates the returned username')
  await username.context.close()

  const managed = await mount('server_session', 'methods', { username: true, usernameManaged: true })
  await click(managed.page, 'Open account security'); await managed.page.getByText('existing.member', { exact: true }).waitFor()
  const change = managed.page.getByRole('button', { name: 'Change', exact: true })
  assert(await change.isDisabled() && Boolean(await change.getAttribute('aria-describedby')), 'SDK13: denied REPLACE keeps an explicit disabled Change and accessible server reason')
  await pair(managed.page, 'after-username-denied')
  await managed.context.close()

  const security = await mount('server_session', 'center')
  const s = security.page
  await click(s, 'Open account security'); await click(s, 'Set up authenticator')
  await s.getByRole('button', { name: 'Show setup instructions', exact: true }).waitFor()
  for (const v of variants) {
    await configure(s, v)
    const composition = await s.locator('.axis-security-operation').evaluate(node => {
      const center = box => (box.left + box.right) / 2
      const bounds = node.getBoundingClientRect(), symbol = node.querySelector('.axis-security-symbol').getBoundingClientRect(), heading = node.querySelector('h3'), footer = node.querySelector('footer').getBoundingClientRect()
      return { symbol: Math.abs(center(symbol) - center(bounds)), heading: Math.abs(center(heading.getBoundingClientRect()) - center(bounds)), footer: Math.abs(center(footer) - center(bounds)), outline: getComputedStyle(heading).outlineStyle, focusable: heading.tabIndex === -1, described: Boolean(node.querySelector('.axis-security-step-description')?.textContent), ready: node.dataset.state === 'READY' }
    })
    assert(composition.ready && composition.described && composition.focusable && composition.outline === 'none' && [composition.symbol, composition.heading, composition.footer].every(offset => offset < 1), `SDK14 ${v.name}: READY is one centered described step; heading focus has no button-like frame`)
    await checkLayout(s, `READY ${v.name}`); await checkContrast(s, `READY ${v.name}`)
    await capture(s, `after-ready-${v.name}`)
  }
  await configure(s, variants[0]); await click(s, 'Show setup instructions')
  await s.getByText('FIXTUREONLYSETUP', { exact: true }).waitFor()
  await pair(s, 'after-material', page => page.locator('.axis-security-footer').scrollIntoViewIfNeeded())
  await click(s, 'Close account center')
  await s.getByRole('button', { name: 'Keep setting up', exact: true }).waitFor()
  await pair(s, 'after-cancel-confirm', page => page.locator('.axis-security-footer').scrollIntoViewIfNeeded())
  assert(await s.getByRole('button', { name: 'Confirm cancellation', exact: true }).count() === 1 && await s.getByRole('button', { name: 'Keep setting up', exact: true }).count() === 1, 'SDK14: host close and panel share exactly one confirmation pair')
  await click(s, 'Keep setting up')
  assert((await state(s)).hasMaterial, 'SDK14: keep preserves the same setup material')
  await click(s, 'Cancel setup'); await click(s, 'Confirm cancellation')
  await s.getByRole('heading', { name: 'Operation cancelled', exact: true }).waitFor()
  await pair(s, 'after-cancelled')
  await click(s, 'Done'); await click(s, 'Set up authenticator'); await click(s, 'Show setup instructions')
  await s.getByLabel('Verification code', { exact: true }).fill('123456'); await click(s, 'Confirm setup')
  await s.getByRole('heading', { name: 'Change completed', exact: true }).waitFor()
  await pair(s, 'after-committed')
  assert(!(await state(s)).hasMaterial, 'SDK14: result clears setup material while retaining the coherent result container')
  await security.context.close()
}
