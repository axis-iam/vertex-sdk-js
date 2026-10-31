import { managedIdentifiers } from './identity-management-fixtures.test-support'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CookieSessionTransport, UnsupportedOperationError } from '@axis-iam/vertex'
import { IamProvider, useIamContext } from '../provider/IamProvider'
import { SignIn } from '../components/SignIn'
import { AuthDialog } from '../components/AuthDialog'
import { ConnectedAccounts } from '../components/ConnectedAccounts'
import { AccountProfilePanel } from '../components/AccountProfilePanel'
import { useAuth } from '../hooks/useAuth'
import { useServerSession } from '../hooks/useServerSession'
import { ServerSessionClient } from './server-session-client'
import { makeTestUser } from '../test-utils'
import { flowCapabilities, flowPolicy } from './auth-flow-fixtures.test-support'
import { invitationProof, invitationView, invitationRef } from './invitation-fixtures.test-support'

const ref = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
const expiry = () => new Date(Date.now()+600000).toISOString()
const user = () => { const u=makeTestUser();u.authenticationContext.clientId='flow-test';return u }
const authenticated = (owner=ref,version=1) => ({state:'AUTHENTICATED',owner,version,csrfToken:ref,expiresAt:expiry(),profile:user(),permissions:{roles:[],permissions:[]}})
const pending = (state='PRELOGIN') => ({state,csrfToken:ref,expiresAt:expiry(),...(state==='PRELOGIN'?{}:{nextAction:state==='MFA_REQUIRED'?'mfa':state==='AUTHENTICATED'?'complete':'authenticate'})})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear()})
function config() {return {sessionMode:'server_session' as const,sessionTransport:new CookieSessionTransport({origin:window.location.origin}),clientId:'flow-test',issuerUri:'https://iam.test',redirectUri:'/login'}}
function fixture(initial:unknown=pending(), capabilities:unknown=flowCapabilities, policy:unknown=flowPolicy) {
  let view=initial
  const calls:{path:string;body:unknown;headers:Headers}[]=[]
  vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit)=>{
    const path=new URL(input).pathname, body=init.body?JSON.parse(String(init.body)):null
    const headers=new Headers(init.headers);calls.push({path,body,headers})
    expect(init.credentials).toBe('same-origin');expect(headers.has('Authorization')).toBe(false)
    if(init.method!=='GET')expect(headers.get('X-CSRF-Token')).toBe(ref)
    const send=(v:unknown)=>new Response(JSON.stringify(v))
    if(path==='/console/auth-methods')return send(capabilities)
    if(path==='/console/auth-policy')return send(policy)
    if(path==='/console/session/bootstrap'||path==='/console/session')return send(view)
    if(path.startsWith('/console/invitation-journeys/'))return send(invitationView(path.endsWith('/confirm')?'COMMITTED':undefined))
    if(path.endsWith('/login')){view=pending('AUTHENTICATING');return send(view)}
    if(path.endsWith('/authenticate')){view=pending('MFA_REQUIRED');return send(view)}
    if(path.endsWith('/mfa')){view=pending('AUTHENTICATED');return send(view)}
    if(path.endsWith('/complete')){view=authenticated();return send(view)}
    if(path.endsWith('/cancel')){view=pending();return send({state:'CANCELLED'})}
    if(path.endsWith('/logout'))return new Response(null,{status:204})
    if(path.endsWith('/self/identifiers'))return send(managedIdentifiers([], 1))
    if(path.endsWith('/self/login-methods'))return send({loginMethodVersion:1,methods:[]})
    if(path.endsWith('/self/linkable-identity-providers'))return send([])
    if(path.endsWith('/self/profile'))return send({userId:'user-1',applicationId:'app-test',globalIdentityId:null,email:'test@example.com',emailVerified:true,username:null,displayName:'BFF user',avatarUrl:null,status:'ACTIVE',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',currentOrganization:null})
    if (path.endsWith('/mfa/capabilities')) return send({ loginMethodVersion: 4, totpEnroll: { allowed: true, proofRequirement: 'SESSION', proofOptions: [], reasonCode: null }, totpDisable: { allowed: false, proofRequirement: 'SESSION', proofOptions: [], reasonCode: 'METHOD_UNAVAILABLE' }, recoveryCodesGenerate: { allowed: true, proofRequirement: 'SESSION', proofOptions: [], reasonCode: null } })
    if (path.endsWith('/mfa/recovery-codes/remaining')) return send({ remaining: 0 })
    if(path.endsWith('/self/security'))return send({emailVerified:true,passwordCredentialPresent:true,mfaEnrolled:false,totpEnrolled:false,webAuthnEnrolled:false,activeSessionCount:1})
    throw new Error('Unexpected '+path)
  }))
  return {calls,setView:(v:unknown)=>{view=v}}
}
it.each(['Embedded','Dialog'])('renders %s login and original MFA with only Cookie session',async entry=>{
  const f=fixture(),success=vi.fn()
  render(createElement(IamProvider,config(),entry==='Dialog'?createElement(AuthDialog,{open:true,signInProps:{onSuccess:success}}):createElement(SignIn,{mode:'embedded',onSuccess:success})))
  const identifier=await screen.findByPlaceholderText('you@example.com')
  fireEvent.change(identifier,{target:{value:'u@example.invalid'}})
  const password=await screen.findByPlaceholderText('Enter your password')
  fireEvent.change(password,{target:{value:'fixture-password'}});fireEvent.submit(password.closest('form')!)
  const code=await screen.findByLabelText('Authenticator code')
  expect(success).not.toHaveBeenCalled()
  fireEvent.change(code,{target:{value:'123456'}});fireEvent.submit(code.closest('form')!)
  await waitFor(()=>expect(success).toHaveBeenCalledOnce())
  expect(f.calls.filter(c=>c.path.endsWith('/complete'))).toHaveLength(1)
  expect(sessionStorage.length).toBe(0)
  expect(document.body.innerHTML).not.toMatch(/fixture-password|controlSecret|access_token/)
})
it('uses the finite invitation allowlist through the real Cookie transport without unsupported token-only methods', async () => {
  const f = fixture(authenticated())
  const client = new ServerSessionClient(config())
  await client.restoreSession()
  expect((await client.invitations.exchange(invitationProof)).ref).toBe(invitationRef)
  expect((await client.invitations.get(invitationRef)).state).toBe('CONFIRM_REQUIRED')
  expect((await client.invitations.confirm(invitationRef, { expectedInvitationVersion: 5, expectedRole: 'MEMBER' }, 'one-explicit-confirm')).state).toBe('COMMITTED')
  await client.invitations.cancel(invitationRef)
  const calls = f.calls.filter(c => c.path.includes('/invitation-journeys/'))
  expect(calls.map(c => c.path)).toEqual([
    '/console/invitation-journeys/continuations/exchange',
    '/console/invitation-journeys/' + invitationRef,
    '/console/invitation-journeys/' + invitationRef + '/confirm',
    '/console/invitation-journeys/' + invitationRef + '/cancel',
  ])
  expect(calls[2].headers.get('Idempotency-Key')).toBe('one-explicit-confirm')
  expect(calls[2].body).toEqual({ expectedInvitationVersion: 5, expectedRole: 'MEMBER' })
  expect(sessionStorage.length + localStorage.length).toBe(0)
  client.dispose()
})
it('restores BFF Provider MFA after HTML return without browser control/state/verifier',async()=>{
  fixture(pending('MFA_REQUIRED'))
  render(createElement(IamProvider,config(),createElement(SignIn,{mode:'embedded'})))
  expect(await screen.findByLabelText('Authenticator code')).toBeTruthy()
  expect(sessionStorage.length).toBe(0)
})
it('mounts real account profile and connected account controls without requiring Access Token',async()=>{
  fixture(authenticated())
  render(createElement(IamProvider,config(),createElement('div',null,createElement(AccountProfilePanel),createElement(ConnectedAccounts))))
  expect(await screen.findByDisplayValue('BFF user')).toBeTruthy()
  expect(await screen.findByRole('heading',{name:'Login methods',exact:true})).toBeTruthy()
  expect(screen.queryByText('user-1',{exact:false})).toBeNull()
  expect(screen.queryByText('Authentication is required')).toBeNull()
})
it('public hooks expose server actions and explicitly reject token-only actions',async()=>{
  fixture(authenticated())
  let auth!:ReturnType<typeof useAuth>,session!:ReturnType<typeof useServerSession>
  function Probe(){auth=useAuth();session=useServerSession();return null}
  render(createElement(IamProvider,config(),createElement(Probe)))
  await waitFor(()=>expect(auth.isAuthenticated).toBe(true))
  expect(()=>auth.getAccessToken()).toThrow(UnsupportedOperationError)
  await expect(auth.refreshToken()).rejects.toMatchObject({code:'UNSUPPORTED_OPERATION'})
  expect(session.view).toMatchObject({state:'AUTHENTICATED'})
  await act(()=>auth.logout({redirect:false}))
  expect(auth.isAuthenticated).toBe(false)
  expect(sessionStorage.length).toBe(0)
})
it('cancel invalidates pending login and a replaced owner rejects late account actions',async()=>{
  const f=fixture()
  const client=new ServerSessionClient(config())
  const flow=await client.beginAuthentication();await flow.cancel()
  await expect(flow.authenticate({method:'PASSWORD',identifier:{kind:'EMAIL',value:'u@example.invalid'},password:'fixture'})).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
  f.setView(authenticated());await client.restoreSession()
  let finish!:(v:unknown)=>void
  const original=client.session.transport.request.bind(client.session.transport)
  vi.spyOn(client.session.transport,'request').mockImplementation(input=>input.action==='profile'?new Promise(resolve=>finish=resolve):original(input))
  const promise=client.getAccountProfile(),rejected=expect(promise).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
  f.setView(authenticated('CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk'));await client.restoreSession()
  finish({});await rejected;client.dispose()
})
it('binds single-use purpose refs to the authenticated owner generation', async () => {
  const f = fixture(authenticated())
  const client = new ServerSessionClient(config())
  await client.restoreSession()
  client.rememberIdentityPurpose(ref)
  expect(client.consumePurpose('LOGIN_METHOD_CHANGE')).toBe(ref)
  expect(() => client.consumePurpose('LOGIN_METHOD_CHANGE')).toThrow('STEP_UP_REQUIRED')
  client.rememberIdentityPurpose(ref)
  f.setView(authenticated('CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk'))
  await client.restoreSession()
  expect(() => client.consumePurpose('LOGIN_METHOD_CHANGE')).toThrow('STEP_UP_REQUIRED')
  client.rememberIdentityPurpose(ref)
  f.setView(pending())
  await client.restoreSession()
  expect(() => client.consumePurpose('LOGIN_METHOD_CHANGE')).toThrow('STEP_UP_REQUIRED')
  client.dispose()
})

it.each(['EMAIL', 'USERNAME'] as const)('sends the delivered typed %s registration and grant without preview or email alias', async kind => {
  const f = fixture()
  const client = new ServerSessionClient(config())
  const request = vi.spyOn(client.session.transport, 'request')
  request.mockImplementation(async input => {
    if (input.action === 'registrationStart') return { ref, status: kind === 'USERNAME' ? 'COMPLETED' : 'PENDING_VERIFICATION', expiresAt: expiry(), nextAction: kind === 'USERNAME' ? 'LOGIN' : 'VERIFY_EMAIL' }
    return { ...pending() }
  })
  await client.restoreSession()
  await client.identity.startRegistration({ identifier: { kind, value: kind === 'EMAIL' ? 'member@example.invalid' : 'member' }, password: '{{SECRET_vw9kk7bz}}', registrationAccessCode: '12345678' }, 'fixture-key')
  const action = request.mock.calls.find(([input]) => input.action === 'registrationStart')![0]
  expect(action).toMatchObject({ action: 'registrationStart', body: { identifier: { kind }, registrationAccessCode: '12345678' }, idempotencyKey: 'fixture-key' })
  expect(action).not.toHaveProperty('body.email')
  expect(f.calls.some(c => /preview/.test(c.path))).toBe(false)
  await expect(client.identity.startRegistration({ identifier: { kind: 'PHONE', value: '+8613800138000' }, password: 'fixture' }, 'key')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  client.dispose()
})

it('consumes a single PHONE password capability without inventing SMS or an identifier selector', async () => {
  fixture(pending(), { ...flowCapabilities, allowedPasswordIdentifierKinds: ['PHONE'],
    identifierMethods: [{ kind: 'PHONE', methods: ['PASSWORD'] }], defaultIdentifierKind: 'PHONE',
    defaultLogin: { identifierKind: 'PHONE', method: 'PASSWORD' }, allowedSignupIdentifierKinds: [],
    methods: flowCapabilities.methods.filter(method => method.type === 'PASSWORD') },
    { ...flowPolicy, allowedPasswordIdentifierKinds: ['PHONE'], defaultLogin: { identifierKind: 'PHONE', method: 'PASSWORD' } })
  render(createElement(IamProvider, { ...config(), children: createElement(SignIn, { mode: 'embedded' }) }))
  expect(await screen.findByPlaceholderText('Enter your password')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Email$/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^SMS code$/ })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Identifier type' })).toBeNull()
})
it('rejects missing password metadata before any Cookie login command', async () => {
  const malformed = { ...flowCapabilities } as Record<string, unknown>
  delete malformed.allowedPasswordIdentifierKinds
  const f = fixture(pending(), malformed)
  render(createElement(IamProvider, { ...config(), children: createElement(SignIn, { mode: 'embedded' }) }))
  expect(await screen.findByRole('button', { name: /^Retry$/ })).toBeTruthy()
  expect(screen.queryByPlaceholderText('Enter your password')).toBeNull()
  expect(f.calls.some(call => call.path.endsWith('/login'))).toBe(false)
})
