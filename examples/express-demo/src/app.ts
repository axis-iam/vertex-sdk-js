import express from 'express'
import { permKey, type IamJwtPayload } from '@axis-iam/vertex'
import { iamAuth, requirePerm, type IamRequest } from '@axis-iam/vertex-express'

// ---------------------------------------------------------------------------
// 1. Define type-safe permission keys
// ---------------------------------------------------------------------------
const MyPermissions = {
  POSTS_READ: permKey('posts', 'read'),
  POSTS_CREATE: permKey('posts', 'create'),
  POSTS_DELETE: permKey('posts', 'delete'),
} as const

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

// ---------------------------------------------------------------------------
// 2. Create Express app
// ---------------------------------------------------------------------------
const app = express()
app.use(express.json())

// Apply IAM auth middleware globally — verifies JWT, resolves permissions
app.use(
  iamAuth({
    endpoint: process.env.IAM_ENDPOINT ?? 'http://localhost:9000',
    // WEB/M2M confidential ApplicationClient for this Express server.
    clientId: requiredEnv('IAM_CLIENT_ID'),
    clientSecret: requiredEnv('IAM_CLIENT_SECRET'),
    // Application.resourceAudience. Access-token aud must match this value.
    resourceAudience: requiredEnv('IAM_RESOURCE_AUDIENCE'),
  }),
)

// ---------------------------------------------------------------------------
// 3. Routes with permission checks
// ---------------------------------------------------------------------------

// GET /posts — requires posts:read
app.get('/posts', requirePerm(MyPermissions.POSTS_READ), (req, res) => {
  const user = (req as unknown as IamRequest).user!
  res.json({
    posts: [
      { id: '1', title: 'Hello World', authorId: user.sub },
    ],
  })
})

// POST /posts — requires posts:create
app.post('/posts', requirePerm(MyPermissions.POSTS_CREATE), (req, res) => {
  const user = (req as unknown as IamRequest).user!
  res.json({
    id: crypto.randomUUID(),
    title: req.body.title,
    content: req.body.content,
    authorId: user.sub,
  })
})

// DELETE /posts/:id — requires posts:delete
app.delete('/posts/:id', requirePerm(MyPermissions.POSTS_DELETE), (req, res) => {
  res.json({ deleted: req.params.id })
})

// ---------------------------------------------------------------------------
// 4. Start server
// ---------------------------------------------------------------------------
const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`Express demo listening on http://localhost:${port}`)
})
