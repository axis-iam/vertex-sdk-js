import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseIdentifierRestrictions, AuthCapabilitiesError } from '@axis-iam/vertex'
import { IamProvider } from '../../provider/IamProvider'
import { IamUiProvider } from '../../provider/IamUiProvider'
import { testProviderProps } from '../../test-utils'
import { flowCapabilities, flowPolicy } from '../../core/auth-flow-fixtures.test-support'
import { SignIn } from '../SignIn'
import { AuthDialog } from '../AuthDialog'
import { phoneCountries, normalizePhoneIdentifier } from './phone-identifier'

afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear()})
const snapshot=flowCapabilities.identifierRestrictions
describe('IR09 identity range purpose contract',()=>{
  it('rejects missing, unknown, leaked-domain, empty and invalid country snapshots',()=>{
    for(const value of [undefined,{}, {...snapshot,extra:true}, {...snapshot,login:{email:{restricted:true,allowedDomains:['internal.test']},phone:{restricted:false,allowedRegions:null}}}, ...[[],['XX'],['CA','CA'],['+1'],null].map(allowedRegions=>({...snapshot,login:{email:{restricted:false},phone:{restricted:true,allowedRegions}}}))])
      expect(()=>parseIdentifierRestrictions(value)).toThrow(AuthCapabilitiesError)
    expect(parseIdentifierRestrictions(snapshot)).toEqual(snapshot)
  })
  it('keeps shared calling codes distinct and rejects a disallowed international paste',()=>{
    expect(phoneCountries('en',['US','CA']).map(item=>item.callingCode)).toEqual(['+1','+1'])
    expect(()=>normalizePhoneIdentifier('+12025550123',undefined,['CA'])).toThrow()
    expect(normalizePhoneIdentifier('+14165550123',undefined,['CA']).e164).toBe('+14165550123')
    expect(phoneCountries('en',[])).toEqual([])
    expect(()=>phoneCountries('en',['XX'])).toThrow()
  })
  for(const presentation of ['embedded','dialog'] as const) for(const expanded of [false,true]) {
    it(`${presentation} filters login by its own scope (${expanded?'expanded':'signup-only'}) without inventing SMS`,async()=>{
      const restrictions={signup:{email:{restricted:true},phone:{restricted:true,allowedRegions:['CA']}},login:{email:{restricted:expanded},phone:{restricted:expanded,allowedRegions:expanded?['CA']:null}}}
      const capabilities={...flowCapabilities,identifierRestrictions:restrictions,identifierMethods:[{kind:'PHONE',methods:['PASSWORD']}],defaultIdentifierKind:'PHONE',defaultLogin:{identifierKind:'PHONE',method:'PASSWORD'},smsOtpEnabled:false,idpProviders:[]}
      vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
        const url=String(input)
        if(url.includes('/auth-methods'))return new Response(JSON.stringify(capabilities))
        if(url.includes('/auth-policy'))return new Response(JSON.stringify({...flowPolicy,identifierRestrictions:restrictions}))
        if(url.includes('openid-configuration'))return new Response(JSON.stringify({issuer:'https://auth.test.com',authorization_endpoint:'https://auth.test.com/authorize',token_endpoint:'https://auth.test.com/token',userinfo_endpoint:'https://auth.test.com/userinfo',jwks_uri:'https://auth.test.com/jwks'}))
        return new Response('{}',{status:404})
      }))
      render(<IamProvider {...testProviderProps()}><IamUiProvider locale="en">{presentation==='dialog'?<AuthDialog open onOpenChange={()=>undefined}/>:<SignIn mode="embedded"/>}</IamUiProvider></IamProvider>)
      const region=await screen.findByRole('combobox',{name:'Country / region'})
      expect(within(region).getByRole('option',{name:/^Canada /}).textContent).toContain('+1')
      if(expanded) {
        expect(within(region).getAllByRole('option')).toHaveLength(2)
        fireEvent.change(screen.getByLabelText('Phone number'),{target:{value:'+12025550123'}})
        expect((region as HTMLSelectElement).value).toBe('')
        expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('+12025550123')
      } else expect(within(region).getByRole('option',{name:/^China /})).toBeTruthy()
      expect(screen.queryByRole('button',{name:'Send code'})).toBeNull()
      if(presentation==='dialog')expect(screen.getByRole('dialog').contains(region)).toBe(true)
      vi.unstubAllGlobals()
    })
  }
})
