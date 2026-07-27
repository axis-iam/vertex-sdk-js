import { Module, type DynamicModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import {
  type IamSdkConfig,
  IamClient,
  JwtVerifier,
  HttpPermissionResolver,
  PermissionManifestClient,
  runPermissionManifestStartup,
  type PermissionManifest,
  type PermissionManifestStartupOptions,
} from '@axis-iam/vertex/server'
import { IAM_CONFIG } from './constants.js'
import { IamAuthGuard } from './iam-auth.guard.js'
import { RequirePermGuard } from './require-perm.guard.js'

export interface IamModuleConfig extends IamSdkConfig {
  permissionManifest?: {
    portalApiEndpoint: string
    manifest: PermissionManifest
    startup?: PermissionManifestStartupOptions
  }
}

@Module({})
export class IamModule {
  static forRoot(config: IamModuleConfig): DynamicModule {
    return {
      module: IamModule,
      global: true,
      providers: [
        { provide: IAM_CONFIG, useValue: config },
        {
          provide: IamClient,
          useFactory: () => new IamClient(config),
        },
        {
          provide: JwtVerifier,
          useFactory: () => new JwtVerifier(config),
        },
        {
          provide: HttpPermissionResolver,
          useFactory: (client: IamClient) => new HttpPermissionResolver(client, config),
          inject: [IamClient],
        },
        { provide: APP_GUARD, useClass: IamAuthGuard },
        { provide: APP_GUARD, useClass: RequirePermGuard },
        {
          provide: 'IAM_BOOTSTRAP',
          useFactory: async () => {
            const manifest = config.permissionManifest
            if (!manifest || (manifest.startup?.mode ?? 'DISABLED') === 'DISABLED') return
            const client = new PermissionManifestClient({
              issuerEndpoint: config.endpoint,
              portalApiEndpoint: manifest.portalApiEndpoint,
              clientId: config.clientId,
              clientSecret: config.clientSecret,
            })
            const startup = manifest.startup
            await runPermissionManifestStartup(client, manifest.manifest, startup?.mode === 'DEVELOPMENT_STARTUP' && startup.failurePolicy === 'CONTINUE'
              ? { ...startup, onContinueError: startup.onContinueError ?? (event => console.warn('IAM permission manifest startup continued', event)) }
              : startup)
          },
        },
      ],
      exports: [IamClient, JwtVerifier, HttpPermissionResolver],
    }
  }
}
