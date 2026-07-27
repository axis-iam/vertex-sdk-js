import 'reflect-metadata'
import { Controller, Get, Module, Post, Body } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { permKey, type IamJwtPayload } from '@axis-iam/vertex'
import { IamModule, RequirePerm, Public, CurrentUser } from '@axis-iam/vertex-nestjs'

// ---------------------------------------------------------------------------
// 1. Define type-safe permission keys using `permKey()`
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
// 2. PostsController — demonstrates @RequirePerm and @CurrentUser
// ---------------------------------------------------------------------------
@Controller('posts')
class PostsController {
  @Get()
  @RequirePerm(MyPermissions.POSTS_READ)
  list(@CurrentUser() user: IamJwtPayload & { permissions: string[] }) {
    return {
      posts: [
        { id: '1', title: 'Hello World', authorId: user.sub },
      ],
    }
  }

  @Post()
  @RequirePerm(MyPermissions.POSTS_CREATE)
  create(
    @CurrentUser() user: IamJwtPayload & { permissions: string[] },
    @Body() body: { title: string; content: string },
  ) {
    return {
      id: crypto.randomUUID(),
      title: body.title,
      content: body.content,
      authorId: user.sub,
    }
  }

  @Get('health')
  @Public()
  health() {
    return { status: 'ok' }
  }
}

// ---------------------------------------------------------------------------
// 3. AppModule — register IamModule.forRoot with env-based config
// ---------------------------------------------------------------------------
@Module({
  imports: [
    IamModule.forRoot({
      endpoint: process.env.IAM_ENDPOINT ?? 'http://localhost:9000',
      // WEB/M2M confidential ApplicationClient for this NestJS server.
      clientId: requiredEnv('IAM_CLIENT_ID'),
      clientSecret: requiredEnv('IAM_CLIENT_SECRET'),
      // Application.resourceAudience. Access-token aud must match this value.
      resourceAudience: requiredEnv('IAM_RESOURCE_AUDIENCE'),
      permissions: [
        { ...MyPermissions.POSTS_READ, displayName: 'Read posts' },
        { ...MyPermissions.POSTS_CREATE, displayName: 'Create posts' },
        { ...MyPermissions.POSTS_DELETE, displayName: 'Delete posts' },
      ],
    }),
  ],
  controllers: [PostsController],
})
class AppModule {}

// ---------------------------------------------------------------------------
// 4. Bootstrap
// ---------------------------------------------------------------------------
async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
  console.log(`NestJS demo listening on http://localhost:${port}`)
}

bootstrap()
