/**
 * PKCE (Proof Key for Code Exchange) helper for OAuth2 Authorization Code flow.
 * Generates code_verifier and code_challenge per RFC 7636.
 */

function generateRandomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return array
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateCodeVerifier(): string {
  // 32 bytes → 43 chars base64url (within 43-128 range per RFC 7636)
  return base64UrlEncode(generateRandomBytes(32).buffer as ArrayBuffer)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

export interface PKCEPair {
  codeVerifier: string
  codeChallenge: string
}

export async function generatePKCEPair(): Promise<PKCEPair> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  return { codeVerifier, codeChallenge }
}
