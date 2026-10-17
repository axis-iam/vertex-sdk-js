import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { IamUiProvider } from '../provider/IamUiProvider'
import { useBranding, BrandingFetchError } from './useBranding'
const context = vi.hoisted(() => ({ client: { clientId: 'one', discover: vi.fn() } }))
vi.mock('../provider/IamProvider', () => ({ useIamContext: () => context }))
const oidc = { issuer: 'https://auth.test' }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const response = (title: string) => ({ ok: true, json: async () => ({ showLogo: false, welcomeTitle: title }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); context.client = { clientId: 'one', discover: vi.fn().mockResolvedValue(oidc) } })
it('requests server locale and intent, clears old copy before changed locale/intent resolves, ignores expired results', async () => {
  context.client.discover.mockResolvedValue(oidc)
  const late = deferred<ReturnType<typeof response>>()
  const fetch = vi.fn().mockResolvedValueOnce(response('Original authored')).mockReturnValueOnce(late.promise).mockResolvedValueOnce(response('中文注册'))
  vi.stubGlobal('fetch', fetch)
  let locale: 'en' | 'zh-CN' = 'en'
  const { result, rerender } = renderHook(({ intent }: { intent: 'login' | 'signup' }) => useBranding(intent), {
    initialProps: { intent: 'login' }, wrapper: ({ children }) => createElement(IamUiProvider, { locale }, children),
  })
  await waitFor(() => expect(result.current.branding?.welcomeTitle).toBe('Original authored'))
  expect(fetch.mock.calls[0][0]).toBe('https://auth.test/api/v1/apps/one/branding?ui_locales=en&intent=login')
  rerender({ intent: 'signup' })
  expect(result.current.branding).toBeNull(); expect(result.current.isLoading).toBe(true)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  locale = 'zh-CN'; rerender({ intent: 'signup' })
  await waitFor(() => expect(result.current.branding?.welcomeTitle).toBe('中文注册'))
  expect(fetch.mock.calls[2][0]).toContain('ui_locales=zh-CN&intent=signup')
  await act(async () => late.resolve(response('Expired English')))
  expect(result.current.branding?.welcomeTitle).toBe('中文注册')
})
it('never leaks old client branding; obsolete failures and discovery cannot overwrite the new client', async () => {
  context.client.discover.mockResolvedValue(oidc)
  const late = deferred<ReturnType<typeof response>>()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('Client one')).mockReturnValueOnce(late.promise).mockResolvedValue(response('Client two')))
  const { result, rerender } = renderHook(({ intent }: { intent: 'login' | 'signup' }) => useBranding(intent), { initialProps: { intent: 'login' }, wrapper: IamUiProvider })
  await waitFor(() => expect(result.current.branding?.welcomeTitle).toBe('Client one'))
  rerender({ intent: 'signup' })
  await act(async () => {})
  context.client = { clientId: 'two', discover: vi.fn().mockResolvedValue(oidc) }
  rerender({ intent: 'login' })
  expect(result.current.branding).toBeNull()
  await waitFor(() => expect(result.current.branding?.welcomeTitle).toBe('Client two'))
  await act(async () => late.reject(new Error('old private failure')))
  expect(result.current.error).toBeNull()
  expect(result.current.branding?.welcomeTitle).toBe('Client two')
})
it.each(['http', 'malformed', 'network', 'discovery'])('reports typed %s failure without pretending success and can retry', async (kind) => {
  context.client.discover.mockResolvedValue(oidc)
  if (kind === 'discovery') context.client.discover.mockRejectedValueOnce(new Error('private'))
  const fetch = vi.fn().mockImplementationOnce(async () => {
    if (kind === 'network') throw new Error('private')
    return kind === 'http' ? { ok: false, status: 404, json: async () => ({ message: 'private' }) } : { ok: true, json: async () => ({ showLogo: 'wrong' }) }
  }).mockResolvedValue(response('retry'))
  if (kind === 'discovery') fetch.mockReset().mockResolvedValue(response('retry'))
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(() => useBranding(), { wrapper: IamUiProvider })
  await waitFor(() => expect(result.current.error).toBeInstanceOf(BrandingFetchError))
  expect(result.current.isLoading).toBe(false); expect(result.current.branding).toBeNull()
  expect(result.current.error?.message).not.toContain('private')
  if (kind === 'http') expect(result.current.error?.status).toBe(404)
  act(() => result.current.retry())
  expect(result.current.isLoading).toBe(true)
  await waitFor(() => expect(result.current.branding?.welcomeTitle).toBe('retry'))
})
it('ignores unmounted discovery without making a branding request', async () => {
  const late = deferred<typeof oidc>(); context.client.discover.mockReturnValue(late.promise)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const { unmount } = renderHook(() => useBranding(), { wrapper: IamUiProvider })
  unmount(); await act(async () => late.resolve(oidc)); expect(fetch).not.toHaveBeenCalled()
})

it('preserves issuer context paths and encodes the client path segment', async () => {
  context.client = { clientId: 'client/with space', discover: vi.fn().mockResolvedValue({ issuer: 'https://auth.test/iam/' }) }
  const fetch = vi.fn().mockResolvedValue(response('context'))
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(() => useBranding('signup'), { wrapper: IamUiProvider })
  await waitFor(() => expect(result.current.branding?.welcomeTitle).toBe('context'))
  expect(fetch.mock.calls[0][0]).toBe('https://auth.test/iam/api/v1/apps/client%2Fwith%20space/branding?ui_locales=en&intent=signup')
})
