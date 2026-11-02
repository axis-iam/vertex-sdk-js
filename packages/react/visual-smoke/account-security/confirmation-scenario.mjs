import { join } from 'node:path'

const variants = [
  { name: 'desktop-light-en', width: 1100, height: 900, theme: 'light', locale: 'en' },
  { name: 'desktop-dark-zh', width: 1100, height: 900, theme: 'dark', locale: 'zh-CN' },
  { name: 'mobile-light-en', width: 390, height: 844, theme: 'light', locale: 'en' },
  { name: 'mobile-dark-zh', width: 390, height: 844, theme: 'dark', locale: 'zh-CN' },
]
export async function runConfirmationScenario({ mount, click, state, checkLayout, checkContrast, assert, fixture, output }) {
  const configure = async (page, variant) => {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await page.evaluate(v => { window.accountSecurityHarness.theme(v.theme); window.accountSecurityHarness.locale(v.locale) }, variant)
    await page.waitForFunction(theme => (document.querySelector('.axis-account-confirmation') ?? document.querySelector('[data-color-scheme]'))?.getAttribute('data-color-scheme') === theme, variant.theme)
  }
  const capture = async (page, name) => {
    await page.mouse.move(0, 0)
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true,
      style: '.axis-security-setup svg,.axis-security-setup code,.axis-security-codes{visibility:hidden!important}input{color:transparent!important;caret-color:transparent!important}',
      mask: [page.locator('.axis-security-setup svg,.axis-security-setup code,.axis-security-codes,input')] })
  }
  const writes = suffix => fixture.requests.filter(request => request.method === 'POST' && request.path.endsWith(suffix)).length
  const modal = async (page, label) => {
    const box = page.getByRole('alertdialog')
    await box.waitFor()
    assert(await box.count() === 1 && await box.evaluate(node => node.matches(':modal')), `${label}: one real native modal owns the top layer`)
    const buttons = box.getByRole('button')
    assert(await buttons.count() === 2 && await buttons.first().evaluate(node => node === document.activeElement), `${label}: focus enters the safe action of one explicit action pair`)
    const geometry = await box.evaluate(node => {
      const rect = node.getBoundingClientRect(), buttons = [...node.querySelectorAll('button')]
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && buttons.every(button => button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1) && Boolean(node.getAttribute('aria-describedby'))
    })
    assert(geometry, `${label}: themed card, description and actions fit the viewport`)
    await checkContrast(page, label)
    await page.keyboard.press('Shift+Tab')
    assert(await buttons.last().evaluate(node => node === document.activeElement), `${label}: reverse Tab stays inside the modal`)
    await page.keyboard.press('Tab')
    assert(await buttons.first().evaluate(node => node === document.activeElement), `${label}: forward Tab stays inside the modal`)
    return box
  }
  const methods = await mount('server_session', 'methods', { username: true, phone: true })
  const p = methods.page
  await click(p, 'Open account security'); await p.getByText('existing.member', { exact: true }).waitFor()
  for (const [kind, value, label] of [['USERNAME', 'existing.member', 'New username'], ['PHONE', '+12025550108', 'New phone number'], ['EMAIL', 'member@example.invalid', 'New email']]) {
    if (kind === 'EMAIL') await click(p, 'Manage emails')
    const menu = p.getByLabel(`More actions: ${value}`, { exact: true })
    await menu.click()
    assert(await p.getByRole('button', { name: 'Transfer', exact: true }).count() === 0 && await p.getByLabel('Receiving user ID', { exact: true }).count() === 0, `F008 ${kind}: default menus have no TRANSFER or internal-user form`)
    if (kind === 'USERNAME') { await menu.click(); await click(p, 'Change') }
    else await click(p, 'Replace')
    await p.getByLabel(label, { exact: true }).waitFor()
    assert(await p.getByLabel('Identifier type', { exact: true }).count() === 0, `F007 ${kind}: fixed type has no disabled selector`)
    if (kind === 'USERNAME') assert(await p.getByRole('checkbox').count() === 0, 'F007 USERNAME: mandatory removal is readable copy, not a disabled checkbox')
    for (const v of variants) {
      await configure(p, v); await checkLayout(p, `F007 ${kind} ${v.name}`)
      await capture(p, `fixed-${kind.toLowerCase()}-${v.name}`)
    }
    await configure(p, variants[0]); await click(p, 'Continue later')
  }
  await click(p, 'Back to email overview'); await click(p, 'Change')
  await p.getByLabel('New username', { exact: true }).fill('replacement.member'); await click(p, 'Complete change')
  await p.getByLabel('Confirm your current password', { exact: true }).waitFor()
  assert(writes('/identity-operations') === 1 && writes('/complete') === 0, 'F007: username still creates one proof-gated REPLACE rather than ADD')
  for (const v of variants) {
    await configure(p, v)
    await p.locator('.axis-ac-close').click()
    await modal(p, `F010 identity ${v.name}`)
    await capture(p, `identity-exit-${v.name}`)
    await p.keyboard.press('Escape')
    assert(await p.getByRole('alertdialog').count() === 0 && await p.locator('.axis-ac-dialog').isVisible() && writes('/cancel') === 0, `F010 identity ${v.name}: Escape keeps the operation without closing the host`)
  }
  await configure(p, variants[0]); await p.locator('.axis-ac-close').click()
  await p.getByRole('alertdialog').getByRole('button', { name: 'Cancel change', exact: true }).click()
  await p.locator('.axis-ac-dialog').waitFor({ state: 'hidden' })
  assert(writes('/cancel') === 1, 'F010 identity: one definite server cancellation completes the retained close')
  await methods.context.close()

  for (const type of ['RECOVERY_CODES_GENERATE', 'TOTP_DISABLE']) {
    const risk = await mount('server_session', 'center', { enrolled: type === 'TOTP_DISABLE', securityProof: true })
    const s = risk.page, action = type === 'TOTP_DISABLE' ? 'Turn off authenticator' : 'Generate new recovery codes'
    await click(s, 'Open account security'); await click(s, type === 'TOTP_DISABLE' ? 'Turn off authenticator' : 'Generate recovery codes')
    await s.getByLabel('Current password', { exact: true }).waitFor()
    assert(await s.getByRole('alertdialog').count() === 0 && await s.getByRole('button', { name: 'Continue', exact: true }).count() === 0, `F009 ${type}: no duplicate pre-operation confirmation`)
    await s.getByLabel('Current password', { exact: true }).fill('isolated-fixture-password'); await click(s, 'Verify and continue')
    await s.getByRole('button', { name: action, exact: true }).waitFor()
    assert(writes('/complete') === 0, `F009 ${type}: proof and READY never submit automatically`)
    await click(s, action)
    for (const v of variants) {
      await configure(s, v); await modal(s, `F009 ${type} ${v.name}`)
      await capture(s, `risk-${type.toLowerCase()}-${v.name}`)
    }
    await s.keyboard.press('Escape')
    assert(writes('/complete') === 0 && (await state(s)).state === 'READY' && await s.locator('.axis-ac-dialog').isVisible(), `F009 ${type}: Escape safely returns to READY without outer close`)
    await configure(s, variants[0]); await click(s, action)
    await s.getByRole('alertdialog').getByRole('button', { name: action, exact: true }).click()
    await s.getByRole('heading', { name: 'Change completed', exact: true }).waitFor()
    assert(writes('/complete') === 1, `F009 ${type}: only the named final modal action submits once`)
    await capture(s, `result-${type.toLowerCase()}-desktop-light-en`)
    await risk.context.close()
  }

  for (const surface of ['center', 'dialog', 'panel']) {
    const security = await mount('server_session', surface)
    const s = security.page
    if (surface !== 'panel') await click(s, 'Open account security')
    await click(s, 'Set up authenticator'); await click(s, 'Show setup instructions')
    await s.getByText('FIXTUREONLYSETUP', { exact: true }).waitFor()
    const trigger = surface === 'center' ? s.locator('.axis-ac-close') : surface === 'dialog' ? s.locator('.axis-security-dialog-close') : s.locator('.axis-security-footer>button:first-child')
    for (const v of variants) {
      await configure(s, v); await trigger.click()
      await modal(s, `F010 ${surface} ${v.name}`)
      await capture(s, `security-exit-${surface}-${v.name}`)
      await s.keyboard.press('Escape')
      assert(await s.getByRole('alertdialog').count() === 0 && (await state(s)).hasMaterial && writes('/cancel') === 0, `F010 ${surface} ${v.name}: Escape keeps the same material and consumes the outer close`)
      assert(await trigger.evaluate(node => node === document.activeElement), `F010 ${surface} ${v.name}: focus returns to the exit trigger`)
    }
    await configure(s, variants[0]); await trigger.click()
    await s.getByRole('alertdialog').getByRole('button', { name: 'Cancel setup', exact: true }).click()
    if (surface === 'panel') await s.getByRole('heading', { name: 'Operation cancelled', exact: true }).waitFor()
    else await s.getByRole('dialog').waitFor({ state: 'hidden' })
    assert(writes('/cancel') === 1 && !(await state(s)).hasMaterial, `F010 ${surface}: one server cancellation clears material before the stored exit`)
    assert(!/FIXTUREONLYSETUP|FIXTURE-CODE/.test(await s.evaluate(() => [...Object.values(sessionStorage), ...Object.values(localStorage)].join(' '))), `F010 ${surface}: no setup material or recovery codes in host storage`)
    await security.context.close()
  }
}
