import { afterEach, expect, it, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import { makeTestUser } from '../test-utils'
import { flowCapabilities } from './auth-flow-fixtures.test-support'
const issuer='https://iam.test'
afterEach(()=>{sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('revokes the OAuth session without Direct RT body and rejects late logout ownership',async()=>{
  const client=new OAuthClient({issuerUri:issuer,clientId:'flow-test',redirectUri:'https://app.test/callback'})
  client.tokenManager.store({access_token:'opaque-shaped',refresh_token:'fixture-rt',token_type:'Bearer',expires_in:600},'OAUTH_AUTHORIZATION_CODE','OAUTH_TOKEN_ENDPOINT')
  let finish!:(value:Response)=>void
  const fetch=vi.fn((url:string,init:RequestInit)=>{
    expect(url).toBe(issuer+'/api/v1/auth/logout');expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer opaque-shaped')
    return new Promise<Response>(resolve=>finish=resolve)
  });vi.stubGlobal('fetch',fetch)
  const pending=client.logout({redirect:false}),rejected=expect(pending).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
  expect(client.getAccessToken()).toBeNull()
  client.tokenManager.store({access_token:'new-owner',token_type:'Bearer',expires_in:600},'OAUTH_AUTHORIZATION_CODE',null)
  finish(new Response(null,{status:204}));await rejected
  expect(client.getAccessToken()).toBe('new-owner');expect(fetch).toHaveBeenCalledOnce();client.dispose()
})
it('does not read legacy Direct storage or accept Direct token provenance',()=>{
  sessionStorage.setItem('axis_iam_session',JSON.stringify({version:5,tokens:{access_token:'old'},authenticationProvenance:'DIRECT_AUTH'}))
  expect(()=>new OAuthClient({issuerUri:issuer,clientId:'flow-test',redirectUri:'/callback',tokenStorage:'sessionStorage'})).toThrow('Stored token session is invalid')
  expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
})
it.each(['EMAIL_LINK','ACCESS_CODE'] as const)('public Provider %s preserves exact grant DTO without login proof shortcut',async type=>{
  const client=new OAuthClient({issuerUri:issuer,clientId:'flow-test',redirectUri:'https://app.test/callback'})
  const discovery={issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',userinfo_endpoint:issuer+'/userinfo',jwks_uri:issuer+'/jwks'}
  vi.spyOn(client,'discover').mockResolvedValue(discovery)
  const fetch=vi.fn(async(url:string,init:RequestInit)=>{
    if(url.endsWith('/transactions'))return new Response(JSON.stringify({transactionId:'tx',controlSecret:'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',expiresAt:new Date(Date.now()+600000).toISOString(),nextAction:'authenticate'}))
    expect(url).toBe(issuer+'/api/v1/auth/transactions/tx/authorize')
    expect(JSON.parse(String(init.body))).toEqual({providerId:'provider',...(type==='EMAIL_LINK'?{registrationGrantToken:'gate'}:{registrationAccessCode:'gate'})})
    return new Response(JSON.stringify({authorizationUrl:'https://provider.test/login',expiresAt:new Date(Date.now()+100000).toISOString()}))
  });vi.stubGlobal('fetch',fetch)
  await client.startProviderAuthorizationFlow(flowCapabilities.idpProviders[0],{registrationGrant:type==='EMAIL_LINK'?{type,registrationGrantToken:'gate'}:{type,registrationAccessCode:'gate'}})
  expect(client.getAccessToken()).toBeNull();expect(client.isAuthenticated()).toBe(false)
  expect(sessionStorage.getItem('axis_iam_pending_authorization')).not.toContain('gate')
  client.dispose()
})
