import express from 'express'
import { MemorySessionProvider } from '@axis-iam/vertex/server'
import { createBff, getBffSession, getBffUser } from '@axis-iam/vertex-express'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error('Missing configuration: ' + name)
  return value
}
const origin = required('APP_ORIGIN')
const provider = new MemorySessionProvider({ replicas: 1, workers: 1 })
const app = express()
const bff = createBff({
  provider, issuer: required('IAM_ISSUER'), audience: required('IAM_RESOURCE_AUDIENCE'),
  clientId: required('IAM_WEB_CLIENT_ID'), clientSecret: required('IAM_WEB_CLIENT_SECRET'),
  applicationOrigin: origin, redirectUri: origin + '/auth/callback',
  successRedirect: '/signed-in', postLogoutRedirect: '/',
  ...(process.env.BFF_LOOPBACK_HTTP === 'true' ? { allowInsecureLoopback: true, cookieName: 'axis-local-session' } : {}),
})
app.use(bff.basePath, bff.router)
app.get('/api/private', bff.requireSession, (req, res) => {
  // Add the application's own resource/permission decision here.
  const session = getBffSession(req)
  res.json({ userId: getBffUser(req).id, permissions: session.permissions.permissions })
})
app.post('/api/private/action', bff.requireSession, (_req, res) => {
  // Perform application authorization and the intended business mutation here.
  res.json({ accepted: true })
})
app.use(express.static('public'))
const server = app.listen(Number(process.env.PORT ?? 3000))
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(async () => { await provider.close() })
})
