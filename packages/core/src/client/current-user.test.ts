import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCurrentUser } from './current-user'
const fixture = () => JSON.parse(readFileSync('../../testdata/current-user.json', 'utf8'))
describe('safe current-user contract', () => {
  it('preserves null email, unselected workspace and ISO context without using metadata roles', () => {
    const user = parseCurrentUser(fixture())
    expect(user.email).toBeNull()
    expect(user.authenticationContext.workspaceSelectionRequired).toBe(true)
    expect(user.authenticationContext.authTime).toBe('2026-10-20T01:02:03Z')
    expect('roles' in user).toBe(false)
  })
  it.each(['applicationId','clientId','sessionId','subjectType','workspaceId','authTime','impersonation','authenticationMethods'])(
    'rejects missing %s rather than making a default', key => {
      const v = fixture(); delete v.authenticationContext[key]
      expect(() => parseCurrentUser(v)).toThrow()
    })
  it('rejects invalid ISO dates, incomplete impersonation and contradictory context', () => {
    for (const patch of [{ authTime: 'yesterday' }, { impersonation: { actorId: 'actor' } },
      { workspaceId: 'workspace' }, { organizationSlug: 'unbound' }, { subjectType: 'MACHINE' }]) {
      const v = fixture(); Object.assign(v.authenticationContext, patch)
      expect(() => parseCurrentUser(v)).toThrow()
    }
  })
})
