import { Command } from 'commander'
import { uploadCommand } from './commands/upload.js'
import { generateCommand } from './commands/generate.js'

export { constantName, generatePermissionsTs, generatePermissionsTsFromManifest } from './generators/typescript.js'
export { loadManifest } from './commands/upload.js'

export function run(): void {
  const program = new Command()
    .name('vertex-codegen')
    .description('IAM permission codegen CLI')
    .version('0.1.0')

  program
    .command('generate')
    .description('Generate browser-safe typed constants from a local structured manifest')
    .requiredOption('--manifest <path>', 'Structured permission manifest JSON file')
    .option('--output <path>', 'Output TypeScript file', 'src/generated/permissions.gen.ts')
    .option('--const-name <name>', 'Generated constant object name', 'AppPermissions')
    .action(async (opts) => {
      await generateCommand({ manifest: opts.manifest, output: opts.output, constName: opts.constName })
    })

  program
    .command('upload')
    .description('Upload local permission definitions to IAM server')
    .requiredOption('--issuer-endpoint <url>', 'IAM OAuth issuer endpoint')
    .requiredOption('--portal-api-endpoint <url>', 'IAM Portal API endpoint')
    .requiredOption('--client-id <id>', 'ApplicationClient.clientId from a WEB/M2M confidential client')
    .requiredOption('--client-secret <secret>', 'WEB/M2M confidential ApplicationClient secret')
    .requiredOption('--manifest <path>', 'Structured permission manifest JSON file')
    .option('--mode <mode>', 'validate or upsert', 'validate')
    .option('--idempotency-key <key>', 'Required for upsert')
    .action(async (opts) => {
      await uploadCommand({
        issuerEndpoint: opts.issuerEndpoint,
        portalApiEndpoint: opts.portalApiEndpoint,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        manifest: opts.manifest,
        mode: opts.mode,
        idempotencyKey: opts.idempotencyKey,
      })
    })

  program.parse()
}
