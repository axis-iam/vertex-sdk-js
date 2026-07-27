import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseOptions(process.argv.slice(2))
if (options.baseline === null) {
  process.stdout.write(`${JSON.stringify({
    status: 'FAIL',
    failures: [
      '--baseline is required for change-budget validation. Build main, measure packages/react/dist/index.js gzip bytes, then rerun with --baseline <main-gzip-bytes>. Do not use the feature bundle as its own baseline.',
    ],
  }, null, 2)}\n`)
  process.exit(1)
}
const fullEntryPath = resolve(repoRoot, 'packages/react/dist/index.js')
const fullEntry = await readFile(fullEntryPath)
const fullEntryGzip = gzipSync(fullEntry).length
const buildOptions = {
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react-dom', '@axis-iam/vertex'],
  treeShaking: true,
}

const sourceComposition = await build({
  ...buildOptions,
  entryPoints: [resolve(repoRoot, 'packages/react/src/index.ts')],
})

const minimalFixture = options.testForceMinimalAuthUi
  ? "import { AccountCenter } from './src/index.ts'; console.log(AccountCenter)"
  : "import { PermissionGate } from './src/index.ts'; console.log(PermissionGate)"
const minimal = await build({
  ...buildOptions,
  stdin: {
    contents: minimalFixture,
    resolveDir: resolve(repoRoot, 'packages/react'),
    sourcefile: 'minimal-consumer.ts',
    loader: 'ts',
  },
})

const sourceOutput = sourceComposition.outputFiles[0]
if (!sourceOutput) throw new Error('Source composition bundle did not produce JavaScript output')
const minimalOutput = minimal.outputFiles[0]
if (!minimalOutput) throw new Error('Minimal consumer bundle did not produce JavaScript output')

const sourceOutputMetadata = Object.values(sourceComposition.metafile.outputs)[0]
if (!sourceOutputMetadata) throw new Error('Source composition bundle did not produce metadata')
const outputMetadata = Object.values(minimal.metafile.outputs)[0]
if (!outputMetadata) throw new Error('Minimal consumer bundle did not produce composition metadata')

const accountCenterPattern = /components\/(AccountCenterSurface|AccountProfilePanel|PasswordChangeForm|AccountSessionsPanel|AccountPermissionsPanel)\.tsx$/
const authUiPattern = /(?:components\/(?:AccountCenter|AccountCenterSurface|AccountProfilePanel|PasswordChangeForm|AccountSessionsPanel|AccountPermissionsPanel|AuthDialog|ConnectedAccounts|ForgotPassword|ResetPassword|SignIn|SignUp|UserButton|UserProfile|OrgSwitcher|OrganizationInvitationAccept)\.tsx|components\/sign-in\/|localization\.ts$|provider\/IamUiProvider\.tsx$)/
const accountCenterComposition = Object.entries(sourceOutputMetadata.inputs)
  .filter(([path]) => accountCenterPattern.test(path))
  .map(([path, contribution]) => ({ path, bytes: contribution.bytesInOutput }))
  .sort((left, right) => right.bytes - left.bytes)
const authUiComposition = Object.entries(sourceOutputMetadata.inputs)
  .filter(([path]) => authUiPattern.test(path))
  .map(([path, contribution]) => ({ path, bytes: contribution.bytesInOutput }))
  .sort((left, right) => right.bytes - left.bytes)
const authUiContributions = Object.entries(outputMetadata.inputs)
  .filter(([path, contribution]) => authUiPattern.test(path) && contribution.bytesInOutput > 0)
  .map(([path, contribution]) => ({ path, bytes: contribution.bytesInOutput }))
const visualSmokeInputs = Object.keys(sourceComposition.metafile.inputs).filter((path) => path.includes('visual-smoke'))
const visualSmokeInProduction = visualSmokeInputs.length > 0
  || fullEntry.includes('visual-smoke-refresh-value')
  || fullEntry.includes('Personal settings')
const increase = fullEntryGzip - options.baseline
const embeddedCss = await measureEmbeddedCss(accountCenterComposition.map(({ path }) => resolve(repoRoot, path)))

const failures = []
if (increase > options.maxIncrease) {
  failures.push(`increment ${increase} bytes exceeds ${options.maxIncrease} bytes`)
}
if (options.maxIncrease > 3000 && !options.reason) {
  failures.push('component/visual allowance above 3000 bytes requires --reason')
}
if (options.maxIncrease > 5000 && !/\btask\s+\d{4}-\d{2}-\d{2}-[\w-]+/i.test(options.reason ?? '')) {
  failures.push('shared UI allowance above 5000 bytes requires a task reference in --reason')
}
if (options.maxIncrease > 10000) {
  failures.push('increment allowance cannot exceed 10000 bytes')
}
if (authUiContributions.length > 0) {
  failures.push('minimal consumer retained Auth UI or localization catalog production code')
}
if (visualSmokeInProduction) {
  failures.push('visual-smoke content was found in the production browser entry')
}

const evidence = {
  fullEntry: {
    path: fullEntryPath,
    rawBytes: fullEntry.length,
    gzipBytes: fullEntryGzip,
  },
  increment: {
    baselineGzipBytes: options.baseline,
    bytes: increase,
    limitBytes: options.maxIncrease,
    reason: options.reason,
  },
  sourceComposition: {
    rawBytes: sourceOutput.contents.length,
    gzipBytes: gzipSync(sourceOutput.contents).length,
    accountCenterInputs: accountCenterComposition,
    authUiInputs: authUiComposition,
    embeddedCss,
    visualSmokeInputs,
  },
  minimalConsumer: {
    fixture: options.testForceMinimalAuthUi ? 'synthetic Auth UI retention fixture' : 'PermissionGate imported from the React root entry',
    rawBytes: minimalOutput.contents.length,
    gzipBytes: gzipSync(minimalOutput.contents).length,
    authUiContributions,
  },
  visualSmokeInProduction,
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  failures,
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
if (failures.length > 0) process.exitCode = 1

function parseOptions(args) {
  let baseline = null
  let maxIncrease = 3000
  let reason = null
  let testForceMinimalAuthUi = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--') {
      continue
    } else if (argument === '--baseline') {
      baseline = parseBytes(argument, value)
      index += 1
    } else if (argument === '--max-increase') {
      maxIncrease = parseBytes(argument, value)
      index += 1
    } else if (argument === '--reason') {
      if (!value) throw new Error('--reason requires a non-empty value')
      reason = value
      index += 1
    } else if (argument === '--test-force-minimal-auth-ui') {
      testForceMinimalAuthUi = true
    } else {
      throw new Error(`Unknown bundle-check argument: ${argument}`)
    }
  }

  return { baseline, maxIncrease, reason, testForceMinimalAuthUi }
}

function parseBytes(name, value) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} requires a non-negative integer byte count`)
  return parsed
}

async function measureEmbeddedCss(paths) {
  let css = ''
  for (const path of paths) {
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(/const\s+\w+Css\s*=\s*`([\s\S]*?)`/g)) {
      css += `${match[1]}\n`
    }
  }
  return { rawBytes: Buffer.byteLength(css), gzipBytes: gzipSync(css).length }
}
