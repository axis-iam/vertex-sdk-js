import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import { TokenManager } from './token-manager'
import { IdentityOperationStore } from './identity-operation-store'
const issuer = 'https://view.test'
const fixture = () => JSON.parse(readFileSync('../../testdata/current-user.json', 'utf8'))
const summary = () => ({ applicationId: fixture().authenticationContext.applicationId, organizationId: null, roles: [], permissions: [] })
const tokens = (access_token = 'client-contract-fixture', expires_in = 600) => ({ access_token, expires_in, token_type: 'Bearer' })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function deferred<T>() { let resolve!: (v:T)=>void; const promise = new Promise<T>(yes=> {resolve=yes}); return {promise, resolve} }
let client: OAuthClient
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  client = new OAuthClient({ issuerUri: issuer, clientId: 'test-client', redirectUri: '/callback' })
  vi.spyOn(client, 'discover').mockResolvedValue({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks` })
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => {
    if (String(url).endsWith('/me')) return response(fixture())
    if (String(url).endsWith('/me/permissions')) return response(summary())
    throw new Error('Unexpected fixture route')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { client.dispose(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function store() { client.tokenManager.store(tokens(), 'OAUTH_AUTHORIZATION_CODE', null) }
describe('API session views and response deadlines', () => {
  it('rejects a missing session instead of returning empty permissions', async () => {
    await expect(client.fetchPermissions()).rejects.toMatchObject({status:401})
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fails explicitly when refresh has no required view loader', async () => {
    const manager = new TokenManager()
    manager.store({...tokens(),refresh_token:'r'},'OAUTH_AUTHORIZATION_CODE','OAUTH_TOKEN_ENDPOINT')
    manager.setRefreshHandler(async()=>({...tokens('rotated'),refresh_token:'r2'}))
    await expect(manager.refresh()).rejects.toThrow('view refresh handler is required')
    expect(manager.getViewState().status).toBe('error')
    expect(manager.isAuthenticated()).toBe(false)
    manager.dispose()
  })
  it('rejects legacy stored views and malformed persisted owner bindings', () => {
    for (const owner of [{id:' ',applicationId:'app',clientId:'test-client',sessionId:'s'}, {id:'user',applicationId:'app',clientId:'test-client'}]) {
      sessionStorage.setItem('axis_iam_session',JSON.stringify({version:5,tokens:tokens(),owner,expiresAt:Date.now()+600000,authenticationProvenance:'OAUTH_AUTHORIZATION_CODE',refreshProvenance:null}))
      expect(()=>new TokenManager({storage:'sessionStorage'})).toThrow('Stored token session is invalid')
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    }
    sessionStorage.setItem('axis_iam_session',JSON.stringify({version:4,tokens:tokens(),roles:['admin'],permissions:['*:*']}))
    expect(()=>new TokenManager({storage:'sessionStorage'})).toThrow('Stored token session is invalid')
  })

  it('accepts token bytes independently of shape but reports success only after both bound views', async () => {
    store()
    const pending = deferred<Response>()
    fetchMock.mockImplementation(async url => String(url).endsWith('/me') ? pending.promise : response(summary()))
    const load = client.fetchPermissions()
    expect(client.isAuthenticated()).toBe(false)
    expect(client.tokenManager.getViewState().status).toBe('loading')
    pending.resolve(response(fixture()))
    expect(await load).toEqual([])
    expect(client.isAuthenticated()).toBe(true)
    expect(client.tokenManager.getUser()).toMatchObject({ id: fixture().id, email: null, roles: [], permissions: [], authenticationContext: { workspaceSelectionRequired: true } })
    expect(client.tokenManager.getUser()).not.toHaveProperty('raw')
  })
  it.each([401,403,503])('handles view HTTP %s explicitly without anonymous success or old permissions', async status => {
    store(); await client.fetchPermissions()
    fetchMock.mockImplementation(async () => response({ error: 'FAILURE' }, status))
    await expect(client.fetchPermissions()).rejects.toMatchObject({ status })
    expect(client.isAuthenticated()).toBe(false)
    expect(client.tokenManager.getUser()).toBeNull()
    expect(client.tokenManager.getPermissions()).toEqual([])
    expect(client.tokenManager.getViewState().status).toBe(status === 401 ? 'anonymous' : 'error')
    expect(client.getAccessToken()).toBe(status === 401 ? null : tokens().access_token)
    if (status !== 401) {
      fetchMock.mockImplementation(async url => response(String(url).endsWith('/me') ? fixture() : summary()))
      await client.fetchPermissions()
      expect(client.isAuthenticated()).toBe(true)
    }
  })
  it.each(['clientId','applicationId','organizationId'])('rejects cross-view %s binding', async field => {
    store()
    const view = fixture(); view.authenticationContext[field] = 'another-context'
    fetchMock.mockImplementation(async url => response(String(url).endsWith('/me') ? view : summary()))
    await expect(client.fetchPermissions()).rejects.toThrow('context mismatch')
    expect(client.tokenManager.getViewState().status).toBe('error')
  })
  it('does not apply a late previous-token view to another login', async () => {
    store()
    const old = deferred<Response>()
    fetchMock.mockImplementation(async url => String(url).endsWith('/me') ? old.promise : response(summary()))
    const load = client.fetchPermissions()
    const rejected = expect(load).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    client.tokenManager.clear(); client.tokenManager.store(tokens('new-account'), 'OAUTH_AUTHORIZATION_CODE', null)
    old.resolve(response(fixture())); await rejected
    expect(client.getAccessToken()).toBe('new-account')
    expect(client.tokenManager.getUser()).toBeNull()
    expect(client.tokenManager.getViewState().status).toBe('loading')
  })
  it('uses expires_in only, and refuses views that arrive after the original deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T00:00:00Z'))
    client.tokenManager.store(tokens('not-a-jwt', 1), 'OAUTH_AUTHORIZATION_CODE', null)
    const old = deferred<Response>()
    fetchMock.mockImplementation(async url => String(url).endsWith('/me') ? old.promise : response(summary()))
    const load = client.fetchPermissions()
    await vi.advanceTimersByTimeAsync(1100)
    old.resolve(response(fixture()))
    await expect(load).rejects.toMatchObject({ status: 401 })
    expect(client.isAuthenticated()).toBe(false)
  })
  it('restores the original persisted deadline and owner, but reloads required views', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T00:00:00Z'))
    const first = new TokenManager({storage:'sessionStorage', startPaused:true})
    first.store(tokens('contract-only-fixture',60), 'OAUTH_AUTHORIZATION_CODE', null)
    first.applyViews({user:fixture(),roles:[],permissions:[]})
    const deadline=first.getViewState().expiresAt
    vi.advanceTimersByTime(30000)
    const restored = new TokenManager({storage:'sessionStorage',startPaused:true})
    expect(restored.getViewState()).toMatchObject({status:'loading',expiresAt:deadline})
    expect(restored.isAuthenticated()).toBe(false)
    restored.applyViews({user:fixture(),roles:[],permissions:[]})
    expect(restored.isAuthenticated()).toBe(true)
    vi.advanceTimersByTime(31000)
    expect(restored.getUser()).toBeNull()
    expect(restored.getViewState()).toMatchObject({status:'expired',expiresAt:deadline})
    first.dispose();restored.dispose()
  })
  it.each(['id','sessionId','applicationId'])('rejects refresh owner drift in %s', async field => {
    store(); await client.fetchPermissions()
    const v = fixture()
    if(field==='id')v.id='other-user';else v.authenticationContext[field]='other-context'
    client.tokenManager.beginViewLoad()
    expect(()=>client.tokenManager.applyViews({user:v,roles:[],permissions:[]})).toThrow('owner changed')
    expect(client.isAuthenticated()).toBe(false)
  })
  it('reloads views after refresh, failing closed when dependent views fail', async () => {
    client.tokenManager.store({...tokens(),refresh_token:'old-refresh'}, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
    await client.fetchPermissions()
    const tokenResponse = {...tokens('rotated'),refresh_token:'new-refresh'}
    fetchMock.mockImplementation(async url => String(url).endsWith('/token') ? response(tokenResponse) : response({},503))
    await expect(client.refreshToken()).rejects.toMatchObject({status:503})
    expect(client.tokenManager.getViewState().status).toBe('error')
    expect(client.isAuthenticated()).toBe(false)
    expect(client.getAccessToken()).toBe('rotated')
  })
  it('keeps the old refresh owner isolated from a new login while HTTP is pending', async () => {
    client.tokenManager.store({...tokens(),refresh_token:'old'}, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
    await client.fetchPermissions()
    const held = deferred<Response>()
    fetchMock.mockImplementation(async url => String(url).endsWith('/token') ? held.promise : response(fixture()))
    const refreshing = client.refreshToken()
    const rejected = expect(refreshing).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
    await vi.waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/token'))).toBe(true))
    client.tokenManager.clear();client.tokenManager.store(tokens('another-owner'),'OAUTH_AUTHORIZATION_CODE',null)
    held.resolve(response({...tokens('old-late'),refresh_token:'rotated'}));await rejected
    expect(client.getAccessToken()).toBe('another-owner')
  })
  it('uses explicit App/User/session facts for opted-in identity-operation restoration', async () => {
    client.dispose()
    client = new OAuthClient({ issuerUri: issuer, clientId:'test-client',redirectUri:'/callback',tokenStorage:'sessionStorage' })
    vi.spyOn(client,'discover').mockResolvedValue({issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,userinfo_endpoint:`${issuer}/userinfo`,jwks_uri:`${issuer}/jwks`})
    store();await client.fetchPermissions()
    fetchMock.mockResolvedValue(response({id:'operation',type:'ADD',state:'AWAITING_REAUTH',expiresAt:'2026-10-21T00:00:00Z',requiredProofs:[]}))
    await new IdentityOperationStore(client).reopen('operation')
    expect(sessionStorage.getItem(`axis_identity_operation:${issuer}:test-client:${fixture().authenticationContext.applicationId}:${fixture().id}:session-1`)).toBe('operation')
  })
})
