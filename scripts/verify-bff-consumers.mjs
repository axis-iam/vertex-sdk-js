import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const wrongProofOnly = process.argv.includes('--wrong-proof-retry')
const businessCsrf = process.argv.includes('--business-csrf')
// Default canonical check now closes only the independent review's open delta.
// Prior full matrices remain reproducible with --full.
const acceptanceRepair = !businessCsrf && !wrongProofOnly && !process.argv.includes('--full')
const scoped = businessCsrf || wrongProofOnly || acceptanceRepair
const output = join(repo, '.auth-entries-smoke/bff')
await mkdir(output, { recursive: true })
const consumer = await mkdtemp(join(output, 'consumer-'))
const artifacts = join(output, 'artifacts')
await mkdir(consumer, { recursive: true })
await mkdir(artifacts, { recursive: true })
const env = { ...process.env, HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897',
  http_proxy: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897' }
async function run(cmd, args, cwd = repo) {
  await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    for (const stream of [p.stdout, p.stderr]) stream.on('data', b => { tail = (tail + b).slice(-6000) })
    p.once('error', reject)
    p.once('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')}: ${code}\n${tail}`)))
  })
}
const packages = ['core', 'react', 'express', 'nestjs']
const previous = scoped ? JSON.parse(await readFile(join(output, businessCsrf ? 'acceptance-repair-final-verification.json' : 'final-verification.json'), 'utf8')) : null
const hashes = []
const contents = new Map()
for (const name of packages) {
  const reuse = businessCsrf ? ['core', 'react'].includes(name) : scoped && ['express', 'nestjs'].includes(name)
  if (!reuse && name !== 'core') await run('pnpm', ['--filter', '@axis-iam/vertex-' + name, 'build'])
  if (!reuse) await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages', name))
  const manifest = JSON.parse(await readFile(join(repo, 'packages', name, 'package.json'), 'utf8'))
  const prior = reuse ? previous.packages.find(p => p.name === manifest.name) : null
  if (reuse && !prior) throw new Error('Missing frozen adapter artifact')
  const file = reuse ? prior.file : join(artifacts, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`)
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex')
  if (reuse && sha256 !== prior.sha256) throw new Error('Reused adapter artifact changed')
  const immutable = join(output, 'checkpoints', sha256)
  await mkdir(immutable, { recursive: true })
  const frozen = join(immutable, file.split('/').at(-1))
  if (file !== frozen) await copyFile(file, frozen)
  hashes.push({ name: manifest.name, version: manifest.version, file: frozen, sha256 })
  const fileHashes = new Map()
  const { stdout: archive } = await promisify(execFile)('tar', ['-tzf', file])
  if (/node_modules|docs\/tasks|\.env|\.git\//.test(archive)) throw new Error('Unexpected packed file')
  for (const entry of archive.split('\n').filter(line => line && !line.endsWith('/'))) {
    const { stdout: content } = await promisify(execFile)('tar', ['-xOf', file, entry], { maxBuffer: 20 * 1024 * 1024 })
    if (/\/home\/chaos|["']workspace:(?:\*|~|\^|\d)|fixture-confidential|fixture-private-control|TASK-2026/.test(content))
      throw new Error('Private source, fixture credential or workspace reference in ' + manifest.name)
    fileHashes.set(entry.replace(/^package\//, ''), createHash('sha256').update(content).digest('hex'))
  }
  contents.set(manifest.name, fileHashes)
}
if (!scoped) await run('pnpm', ['--filter', '@axis-iam/vertex-express', 'exec', 'vitest', 'run', 'src/web-auth.middleware.test.ts', '--maxWorkers=2'])
await writeFile(join(output, businessCsrf ? 'F-BFF-001-artifacts.json' : acceptanceRepair ? 'acceptance-repair-artifacts.json' : 'artifacts.json'), JSON.stringify({ source: 'working tree; no commit authority', packages: hashes }, null, 2))
console.log('PACKED', JSON.stringify(hashes))
console.log('CONSUMER', consumer)
const dependencies = Object.fromEntries(hashes.map(p => [p.name, 'file:' + p.file]))
Object.assign(dependencies, { react: '^19.0.0', 'react-dom': '^19.0.0', express: '^5.1.0',
  'express-session': '^1.18.2', '@nestjs/core': '^11.0.0', '@nestjs/common': '^11.0.0', '@nestjs/platform-express': '^11.0.0',
  'reflect-metadata': '^0.2.0', rxjs: '^7.8.0', jose: '^5.9.6' })
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies,
  pnpm: { overrides: Object.fromEntries(hashes.map(p => [p.name, 'file:' + p.file])) },
  devDependencies: { esbuild: '^0.25.0', typescript: '^5.7.0', '@types/express': '^5.0.0', '@types/node': '^25.0.0',
    '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' } }, null, 2))
await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile', '--ignore-scripts'], consumer)
for (const p of hashes) {
  const path = await realpath(join(consumer, 'node_modules', p.name))
  if (!path.startsWith(join(consumer, 'node_modules/.pnpm/'))) throw new Error('Workspace fallback: ' + p.name)
  for (const [entry, expected] of contents.get(p.name)) {
    if (createHash('sha256').update(await readFile(join(path, entry))).digest('hex') !== expected)
      throw new Error('Installed package does not match the actual archive: ' + p.name + '/' + entry)
  }
}
for (const file of ['consumer.mjs', 'fixture.mjs', 'browser.jsx', 'consumer.ts', 'ConnectedApp.tsx']) {
  await copyFile(join(repo, 'examples/bff', file), join(consumer, file))
}
await copyFile(join(repo, 'docs/connected-app-bff/c0/c0-v1.json'), join(consumer, 'c0-v1.json'))
// Test metadata is a fixture input, copied once; installed SDK never imports workspace sources.
await run('pnpm', ['exec', 'esbuild', join(repo, 'packages/react/src/core/auth-flow-fixtures.test-support.ts'),
  '--bundle', '--platform=node', '--format=esm', '--outfile=' + join(consumer, 'capabilities.mjs')])
await run('pnpm', ['exec', 'tsc', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--skipLibCheck', '--jsx', 'react-jsx', 'consumer.ts', 'ConnectedApp.tsx'], consumer)
await run('pnpm', ['exec', 'esbuild', 'browser.jsx', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js'], consumer)
const browser = await readFile(join(consumer, 'browser.js'), 'utf8')
if (/node:crypto|BffSessionClient|MemorySessionProvider|fixture-confidential|fixture-private-control/.test(browser))
  throw new Error('Server material leaked into browser bundle')
await run('node', ['consumer.mjs', ...(businessCsrf ? ['--business-csrf'] : wrongProofOnly ? ['--wrong-proof-retry'] : acceptanceRepair ? ['--acceptance-repair'] : [])], consumer)
console.log(businessCsrf ? 'F-BFF-001 PACKED PASS: standalone/native/Nest unsafe business methods and Chrome cross-Origin form refusal' : acceptanceRepair ? 'A-JS-001/002 PACKED PASS: public React registration/UI and actual HTTP error envelopes; frozen adapters reused' : wrongProofOnly
  ? 'F-JS-001 PACKED PASS: fresh core/React; frozen adapters; Node and Python/Django-compatible 401 envelopes; browser error/retry/established invalidation'
  : 'BFF-JS-PACKED PASS: installed ESM/CJS/types; Express/Nest; standalone/native Session; browser Hosted/CUSTOM; controlled IAM only')
