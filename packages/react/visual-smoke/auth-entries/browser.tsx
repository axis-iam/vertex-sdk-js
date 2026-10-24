import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  IamProvider,
  SignIn,
  SignUp,
  AuthDialog,
  SignInButton,
  useAuth,
  useAuthFlow,
  OAuthClient,
} from '@axis-iam/vertex-react'
import { CustomAuth } from './CustomAuth'

let root, flow, auth, openDialog, mountedConfig
let successes = 0,
  errors = 0
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, name) => {
  if (!condition) throw new Error(name)
}
async function until(test, name) {
  for (let i = 0; i < 200; i++) {
    if (test()) return
    await wait(25)
  }
  throw new Error(name)
}
function Probe({ entry }) {
  auth = useAuth()
  return entry === 'custom' ? <CustomProbe /> : null
}
function CustomProbe() {
  flow = useAuthFlow({
    onSignInSuccess: () => successes++,
    onSignUpSuccess: () => successes++,
    onError: () => errors++,
  })
  return <p data-flow-step={flow.state.step}>Custom flow: {flow.state.step}</p>
}
function Dialog() {
  const [open, setOpen] = useState(false)
  openDialog = setOpen
  return (
    <AuthDialog
      open={open}
      onOpenChange={setOpen}
      signInProps={{ onSuccess: () => successes++, onError: () => errors++ }}
    >
      <SignInButton>Open authentication</SignInButton>
    </AuthDialog>
  )
}
const click = (selector) => {
  const node = document.querySelector(selector)
  check(node, 'missing click target')
  node.focus()
  node.click()
}
const fill = (selector, value) => {
  const input = document.querySelector(selector)
  check(input, 'missing input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
const submit = (selector) => {
  const node = document.querySelector(selector)
  check(node, 'missing submit target')
  node.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
window.entries = {
  async mount(config = {}) {
    root?.unmount()
    flow = undefined
    auth = undefined
    successes = 0
    errors = 0
    document.getElementById('app')?.remove()
    const element = document.createElement('main')
    element.id = 'app'
    element.style.cssText = 'padding:24px 8px;min-height:100vh'
    document.body.append(element)
    document.body.style.background = config.theme === 'dark' ? '#090c0e' : '#eef1f4'
    root = createRoot(element)
    const entry = config.entry ?? 'custom'
    const props = {
      issuerUri: config.issuer ?? `${location.origin}/fixture`,
      clientId: config.clientId ?? 'fixture-client',
      redirectUri: `${location.origin}/callback`,
      colorScheme: config.theme ?? 'light',
      locale: config.locale ?? 'en',
      ...(config.longCopy
        ? {
            localization: {
              authDialog: {
                signUpTab: 'Create a new account for your organization and application',
                title: () => 'Continue securely to your application workspace',
              },
            },
          }
        : {}),
    }
    mountedConfig = { issuerUri: props.issuerUri, clientId: props.clientId, redirectUri: props.redirectUri, locale: props.locale }
    root.render(
      <IamProvider {...props}>
        <Probe entry={entry} />
        {entry === 'embedded' ? (
          <SignIn mode="embedded" onSuccess={() => successes++} onError={() => errors++} />
        ) : entry === 'signup' ? (
          <SignUp mode="embedded" onSuccess={() => successes++} onError={() => errors++} />
        ) : entry === 'dialog' ? (
          <Dialog />
        ) : entry === 'hosted' ? (
          <SignIn />
        ) : entry === 'example' ? (
          <CustomAuth />
        ) : null}
      </IamProvider>,
    )
    await until(() => auth?.isLoaded, 'provider initialization')
    if (entry === 'custom') await until(() => flow?.state.step !== 'loading', 'flow metadata')
    return true
  },
  async customPassword(identifier, password) {
    flow.actions.continueWithIdentifier({ kind: 'EMAIL', value: identifier })
    await flow.actions.submitPassword(password)
    await wait(25)
    return {
      step: flow.state.step,
      authenticated: auth.isAuthenticated,
      successes,
      errors,
      privateState: JSON.stringify(flow.state).includes(password),
    }
  },
  async customIdentify(identifier) {
    flow.actions.continueWithIdentifier({ kind: 'EMAIL', value: identifier })
    await wait(25)
  },
  async action(name, ...args) {
    try {
      await flow.actions[name](...args)
      await wait(25)
      return { ok: true, step: flow.state.step }
    } catch (error) {
      await wait(25)
      return { ok: false, code: error.code, name: error.name, status: error.status, step: flow.state.step }
    }
  },
  state() {
    return {
      step: flow?.state.step,
      pending: flow?.state.pending,
      retryAfterSeconds: flow?.state.retryAfterSeconds,
      authenticated: auth?.isAuthenticated,
      successes,
      errors,
      storage:
        sessionStorage.getItem('axis_iam_session') !== null ||
        localStorage.getItem('axis_iam_session') !== null,
    }
  },
  fill,
  submit,
  click,
  wait,
  until,
  async domPassword(identifier, password) {
    await until(() => document.querySelector('input[name="identifier"]'), 'embedded options ready')
    fill('input[name="identifier"]', identifier)
    submit('input[name="identifier"]')
    await until(() => document.querySelector('input[name="password"]'), 'password form')
    fill('input[name="password"]', password)
    submit('input[name="password"]')
    await until(() => auth.isAuthenticated || document.querySelector('[role="alert"]'), 'password completion')
    check(
      auth.isAuthenticated,
      `embedded password login: ${document.querySelector('[role=alert]')?.textContent ?? 'no error'}`,
    )
    return this.state()
  },
  async domSignup(email, password) {
    await until(() => document.querySelector('input[name="identifier"]'), 'signup form')
    fill('input[name="identifier"]', email)
    fill('input[name="new-password"]', password)
    fill('input[name="confirm-password"]', password)
    submit('input[name="identifier"]')
    await until(
      () => document.querySelector('[role="status"]') || document.querySelector('[role="alert"]'),
      'signup operation created',
    )
    check(!document.querySelector('[role="alert"]'), 'signup rejected')
    check(!auth.isAuthenticated, 'signup authenticated unexpectedly')
    return this.state()
  },
  async callback() {
    const result = await auth.handleRedirectCallback()
    await wait(25)
    return {
      status: result.status,
      authenticated: auth.isAuthenticated,
      scrubbed: !location.search.includes('code=') && !location.search.includes('state='),
    }
  },
  async callbackNegative(kind) {
    const client = new OAuthClient(mountedConfig)
    let url
    try {
      url = await client.startAuthorizationFlow()
    } finally {
      client.dispose()
    }
    const state = new URL(url).searchParams.get('state')
    history.replaceState(
      null,
      '',
      `/callback?${kind === 'denied' ? 'error=access_denied' : 'code=controlled-code'}&state=${kind === 'mismatch' ? 'wrong-state' : state}`,
    )
    const result = await auth.handleRedirectCallback()
    return (
      result.status === 'error' && !location.search.includes('code=') && !location.search.includes('state=')
    )
  },
  async dialogRace(identifier, password) {
    click('[data-axis-auth-view="sign-in"]')
    await until(() => document.querySelector('input[name="identifier"]'), 'dialog open')
    fill('input[name="identifier"]', identifier)
    submit('input[name="identifier"]')
    await until(() => document.querySelector('input[name="password"]'), 'dialog password')
    fill('input[name="password"]', password)
    submit('input[name="password"]')
    await wait(30)
    document
      .querySelector('[role="dialog"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(30)
    check(!document.querySelector('[role="dialog"]'), 'Esc failed')
    await wait(400)
    check(!auth.isAuthenticated && successes === 0 && errors === 0, 'stale dialog result')
    check(document.activeElement?.matches('[data-axis-auth-view]'), 'trigger focus not restored')
    click('[data-axis-auth-view]')
    await until(() => document.querySelector('input[name="identifier"]'), 'dialog reopen')
    check(!document.querySelector('input[type="password"]'), 'reopened sensitive step')
    return this.state()
  },
  async visualState(name) {
    if (['error', 'mfa', 'success', 'cooldown'].includes(name)) {
      await until(() => document.querySelector('input[name="identifier"]'), 'visual identifier')
      fill('input[name="identifier"]', 'member@example.invalid')
      submit('input[name="identifier"]')
      await until(() => document.querySelector('input[name="password"]'), 'visual password')
      if (name === 'cooldown') {
        const button = [...document.querySelectorAll('button')].find(
          (e) => e.textContent === 'Email code' || e.textContent === '邮箱验证码',
        )
        check(button, 'email code method')
        button.click()
        await wait(30)
        const send = [...document.querySelectorAll('button')].find(
          (e) => e.textContent === 'Send code' || e.textContent === '发送验证码',
        )
        check(send, 'send code')
        send.click()
        await until(() => document.querySelector('input[name="code"]'), 'cooldown input')
      } else {
        fill('input[name="password"]', 'Controlled!42')
        submit('input[name="password"]')
        await until(
          () =>
            name === 'error'
              ? document.querySelector('[role="alert"]')
              : name === 'mfa'
                ? document.querySelector('input[name="totp"]')
                : auth.isAuthenticated,
          'visual completion',
        )
      }
      await wait(50)
    }
    if (name === 'verification') await this.domSignup('member@example.invalid', 'Controlled!42')
    if (name === 'loading')
      check(
        document.querySelector('[role="status"]')?.textContent?.includes('Loading') ||
          document.querySelector('[role="status"]')?.textContent?.includes('加载'),
        'loading visible',
      )
    if (name === 'unavailable') {
      const expected = mountedConfig.locale === 'zh-CN'
        ? '当前没有可用的登录方式。'
        : 'No sign-in method is currently available.'
      await until(
        () => document.querySelector('[role="status"]')?.textContent === expected,
        'resolved localized unavailable content',
      )
      check(!document.querySelector('input'), 'unavailable has no credential input')
      check(
        !document.body.textContent.includes('Loading sign-in options...') &&
          !document.body.textContent.includes('正在加载登录选项…'),
        'unavailable must not capture loading',
      )
    }
    check(
      ![...document.querySelectorAll('input[type="password"],input[name="code"],input[name="totp"]')].some(
        (input) => input.value,
      ),
      'secret retained in screenshot form',
    )
    return this.contrast()
  },
  contrast() {
    const rgb = (value) => {
      const x = value.match(/[\d.]+/g)?.map(Number)
      return x?.length >= 3 ? x : [0, 0, 0, 0]
    }
    const blend = (fg, bg) => {
      const a = fg.length > 3 ? fg[3] : 1
      return fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a))
    }
    const background = (element) => {
      const stack = []
      for (let e = element; e; e = e.parentElement) stack.unshift(rgb(getComputedStyle(e).backgroundColor))
      return stack.reduce((b, f) => blend(f, b), [255, 255, 255])
    }
    const luminance = (c) =>
      c
        .map((v) => {
          const n = v / 255
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
        })
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0)
    const ratio = (a, b) => {
      const x = luminance(a),
        y = luminance(b)
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    const texts = [
      ...document.querySelectorAll('#app label,#app p,#app h2,#app h3,#app button,#app input'),
    ].filter(
      (e) =>
        (e.getClientRects().length && !e.disabled && e.textContent?.trim()) ||
        (e.matches('input') && e.getClientRects().length),
    )
    let text = 100,
      control = 100,
      focus = 100
    for (const e of texts) {
      const s = getComputedStyle(e),
        bg = background(e)
      text = Math.min(text, ratio(blend(rgb(s.color), bg), bg))
      if (e.matches('input')) control = Math.min(control, ratio(rgb(s.borderColor), bg))
      if (e.matches(':focus-visible'))
        focus = Math.min(focus, ratio(rgb(s.outlineColor), background(e.parentElement)))
    }
    return {
      text: Number(text.toFixed(2)),
      control: Number(control.toFixed(2)),
      focus: Number(focus.toFixed(2)),
      overflow: document.documentElement.scrollWidth > innerWidth,
      inputs: document.querySelectorAll('input').length,
    }
  },
}
