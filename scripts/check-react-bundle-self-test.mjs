import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const guardrail = resolve(repoRoot, 'scripts/check-react-bundle.mjs')
const fullEntry = await readFile(resolve(repoRoot, 'packages/react/dist/index.js'))
const currentGzip = gzipSync(fullEntry).length

const cases = [
  {
    name: 'missing baseline',
    args: [],
    expected: '--baseline is required for change-budget validation',
  },
  {
    name: 'ordinary increment above 3000 bytes',
    args: ['--baseline', String(currentGzip - 3001)],
    expected: 'increment 3001 bytes exceeds 3000 bytes',
  },
  {
    name: 'extension allowance without reason',
    args: ['--baseline', String(currentGzip - 4000), '--max-increase', '5000'],
    expected: 'component/visual allowance above 3000 bytes requires --reason',
  },
  {
    name: 'shared UI allowance without a task reference',
    args: ['--baseline', String(currentGzip), '--max-increase', '5001', '--reason', 'synthetic self-test'],
    expected: 'shared UI allowance above 5000 bytes requires a task reference in --reason',
  },
  {
    name: 'increment allowance above 10000 bytes',
    args: ['--baseline', String(currentGzip), '--max-increase', '10001', '--reason', 'task 2026-07-14-synthetic-bundle-guardrail'],
    expected: 'increment allowance cannot exceed 10000 bytes',
  },
  {
    name: 'minimal consumer accidentally retains auth UI',
    args: ['--baseline', String(currentGzip), '--test-force-minimal-auth-ui'],
    expected: 'minimal consumer retained Auth UI or localization catalog production code',
  },
]

const results = cases.map((testCase) => {
  const run = spawnSync(process.execPath, [guardrail, ...testCase.args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const output = `${run.stdout}${run.stderr}`
  const passed = run.status !== 0 && output.includes(testCase.expected)
  return {
    name: testCase.name,
    expectedFailureObserved: passed,
    exitCode: run.status,
    expected: testCase.expected,
  }
})

const failed = results.filter((result) => !result.expectedFailureObserved)
process.stdout.write(`${JSON.stringify({
  fixture: 'Synthetic baselines derived only to exercise negative guardrail branches',
  currentGzipBytes: currentGzip,
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  cases: results,
}, null, 2)}\n`)
if (failed.length > 0) process.exitCode = 1
