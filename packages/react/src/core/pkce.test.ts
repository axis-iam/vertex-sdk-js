import { describe, it, expect } from 'vitest'
import { generateCodeVerifier, generateCodeChallenge, generatePKCEPair } from './pkce'

describe('generateCodeVerifier', () => {
  it('returns a base64url-encoded string', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('has length within RFC 7636 range (43-128 chars)', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('generates unique verifiers', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })
})

describe('generateCodeChallenge', () => {
  it('returns a base64url-encoded string', async () => {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces consistent output for same input', async () => {
    const verifier = 'test-verifier-string'
    const a = await generateCodeChallenge(verifier)
    const b = await generateCodeChallenge(verifier)
    expect(a).toBe(b)
  })

  it('produces different output for different input', async () => {
    const a = await generateCodeChallenge('verifier-a')
    const b = await generateCodeChallenge('verifier-b')
    expect(a).not.toBe(b)
  })
})

describe('generatePKCEPair', () => {
  it('returns codeVerifier and codeChallenge', async () => {
    const pair = await generatePKCEPair()
    expect(pair).toHaveProperty('codeVerifier')
    expect(pair).toHaveProperty('codeChallenge')
    expect(pair.codeVerifier).toBeTruthy()
    expect(pair.codeChallenge).toBeTruthy()
  })

  it('challenge is derived from verifier', async () => {
    const pair = await generatePKCEPair()
    const expected = await generateCodeChallenge(pair.codeVerifier)
    expect(pair.codeChallenge).toBe(expected)
  })
})
