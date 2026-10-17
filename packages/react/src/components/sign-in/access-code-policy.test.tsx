import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthFlowForm } from './AuthFlowForm'
import { resolveAppearance } from '../styles'
import { IamUiProvider } from '../../provider/IamUiProvider'
import { flowCapabilities, flowPolicy } from '../../core/auth-flow-fixtures.test-support'
import type { AuthFlowState, UseAuthFlowResult } from '../../core/auth-flow-types'
import type { RegistrationGrantInput } from '../../core/types'
const state = (): AuthFlowState => ({ intent: 'sign-up', step: 'sign-up', capabilities: flowCapabilities, policy: flowPolicy, providers: [], pending: null, error: null, retryAfterSeconds: 0, verificationResendDeadline: null, verificationEmail: null })
function fixture(initial = state(), grant?: RegistrationGrantInput) {
  const signUp = vi.fn().mockResolvedValue(undefined)
  const actions = { signUp, setIntent: vi.fn() } as unknown as UseAuthFlowResult['actions']
  const tree = (s: AuthFlowState) => <IamUiProvider><AuthFlowForm flow={{ state: s, actions }} appearance={resolveAppearance()} registrationGrant={grant} /></IamUiProvider>
  const view = render(tree(initial))
  const submit = async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fixture@example.invalid' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'StrongPassword123!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongPassword123!' } })
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)
    await waitFor(() => expect(signUp).toHaveBeenCalled())
  }
  return { signUp, submit, change: (s: AuthFlowState) => view.rerender(tree(s)) }
}
afterEach(cleanup)
it('AC-01 OPEN shows optional access code and submits both no-proof and typed proof', async () => {
  const f = fixture();const input = screen.getByLabelText('Registration access code (optional)') as HTMLInputElement
  expect(input.required).toBe(false)
  await f.submit();expect(f.signUp.mock.calls[0][0]).not.toHaveProperty('registrationGrant')
  fireEvent.change(input,{target:{value:'test-proof'}});await f.submit()
  expect(f.signUp.mock.calls[1][0].registrationGrant).toEqual({type:'ACCESS_CODE',registrationAccessCode:'test-proof'})
})
it('AC-01 INVITE_REQUIRED marks access proof required; supplied other proof is not replaced by an access field', () => {
  const s = state();s.policy = {...flowPolicy,signupMode:'INVITE_REQUIRED'}
  fixture(s);expect((screen.getByLabelText('Registration access code (required)') as HTMLInputElement).required).toBe(true)
  cleanup();fixture(s,{type:'EMAIL_LINK',registrationGrantToken:'supplied-proof'})
  expect(screen.queryByPlaceholderText('Enter access code')).toBeNull()
})
it.each(['DISABLED','no-access','loading','error','sign-in'] as const)('AC-01 removes stale code across %s and cannot resurrect it', async kind => {
  const f=fixture();fireEvent.change(screen.getByLabelText('Registration access code (optional)'),{target:{value:'old-proof'}})
  const next=state()
  if(kind==='DISABLED') next.policy={...flowPolicy,signupMode:'DISABLED'}
  if(kind==='no-access') next.policy={...flowPolicy,allowedRegistrationGrantTypes:['EMAIL_LINK']}
  if(kind==='loading'||kind==='error') {next.step=kind==='loading'?'loading':'unavailable';next.policy=null;next.capabilities=null}
  if(kind==='sign-in'){next.intent='sign-in';next.step='identifier'}
  f.change(next);expect(screen.queryByPlaceholderText('Enter access code')).toBeNull()
  if(kind!=='no-access') expect(screen.queryByLabelText('Email')).toBeNull()
  if(kind==='no-access') {await f.submit();expect(f.signUp.mock.lastCall?.[0]).not.toHaveProperty('registrationGrant');f.signUp.mockClear()}
  f.change(state());expect((screen.getByLabelText('Registration access code (optional)') as HTMLInputElement).value).toBe('')
  await f.submit();expect(f.signUp.mock.lastCall?.[0]).not.toHaveProperty('registrationGrant')
})
it('AC-01 preserves editable access code after a typed failure', async () => {
  const f=fixture();f.signUp.mockRejectedValueOnce(new Error('typed invalid proof'))
  const input=screen.getByLabelText('Registration access code (optional)') as HTMLInputElement
  fireEvent.change(input,{target:{value:'invalid-proof'}});await f.submit();expect(input.value).toBe('invalid-proof')
  fireEvent.change(input,{target:{value:'corrected-proof'}});await f.submit()
  expect(f.signUp.mock.lastCall?.[0].registrationGrant.registrationAccessCode).toBe('corrected-proof')
})
