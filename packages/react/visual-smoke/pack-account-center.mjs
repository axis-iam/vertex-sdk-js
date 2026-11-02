import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const argument = name => {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`)
  return resolve(process.argv[index + 1])
}
const core = argument('--core-artifact'), output = argument('--output')
const repo = resolve(import.meta.dirname, '../../..'), artifacts = join(output, 'artifacts')
const expectedCore = core.match(/-([a-f0-9]{64})\.tgz$/)?.[1]
const digest = data => createHash('sha256').update(data).digest('hex')
if (!expectedCore || digest(await readFile(core)) !== expectedCore) throw new Error('Core archive identity mismatch')
const commands = []
const run = (command, args, cwd = repo) => new Promise((resolveCommand, reject) => {
  commands.push([command, ...args])
  const process = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = [], stderr = []
  process.stdout.on('data', chunk => stdout.push(chunk)); process.stderr.on('data', chunk => stderr.push(chunk))
  process.on('error', reject)
  process.on('close', code => code === 0 ? resolveCommand(Buffer.concat(stdout)) : reject(new Error(`${command} failed (${code}): ${Buffer.concat(stderr).toString().slice(-5000)}`)))
})
async function bindSources(archive, pkg) {
  const map = JSON.parse((await run('tar', ['-xOf', archive, 'package/dist/index.js.map'])).toString())
  const files = []
  for (const [index, source] of map.sources.entries()) {
    if (!source.startsWith('../src/')) throw new Error(`Unexpected bundled source: ${source}`)
    const file = resolve(repo, 'packages', pkg, 'dist', source)
    const content = await readFile(file)
    if (content.toString() !== map.sourcesContent[index]) throw new Error(`Source differs from artifact: ${source}`)
    files.push({ path: `packages/${pkg}/${source.slice(3)}`, sha256: digest(content) })
  }
  return files
}
const coreSources = await bindSources(core, 'core')
await mkdir(artifacts, { recursive: true })
await cp(core, join(artifacts, 'axis-iam-vertex-0.1.0.tgz'))
await run('pnpm', ['--filter', '@axis-iam/vertex-react', 'build'])
await run('pnpm', ['pack', '--pack-destination', artifacts], join(repo, 'packages/react'))
const react = join(artifacts, 'axis-iam-vertex-react-0.1.0.tgz')
const reactSources = await bindSources(react, 'react')
const binding = {
  status: 'PASS', scope: 'Account-center React-only package; unchanged core reused', commands,
  packages: [
    { package: 'core', archive: join(artifacts, 'axis-iam-vertex-0.1.0.tgz'), sha256: expectedCore, sources: coreSources },
    { package: 'react', archive: react, sha256: digest(await readFile(react)), sources: reactSources },
  ],
}
await writeFile(join(output, 'package-binding.json'), JSON.stringify(binding, null, 2) + '\n')
console.log(JSON.stringify({ status: binding.status, packages: binding.packages.map(({ package: name, sha256, sources }) => ({ package: name, sha256, sources: sources.length })), coreBuilt: false, reactBuiltAndPacked: true }))
