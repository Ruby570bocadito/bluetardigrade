// Portable functional checks of the real client provider and dashboard.
// Optional tooling lives outside the application dependency graph.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const tooling = resolve(process.env.CONSOLE_TEST_TOOLS || join(repo, 'tools/console-tests'))
const requireTools = createRequire(join(tooling, 'package.json'))
let build, jsdom
try {
  build = requireTools('esbuild').build
  jsdom = requireTools.resolve('jsdom')
} catch {
  console.error('Install optional test tools first: npm install --prefix tools/console-tests --no-audit --no-fund esbuild@0.25.11 jsdom@26.1.0')
  process.exit(1)
}
const temp = mkdtempSync(join(tmpdir(), 'sf-console-dom-'))
try {
  const outfile = join(temp, 'fixture.cjs')
  await build({
    entryPoints: [join(here, 'console_dom_fixture.tsx')],
    outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    nodePaths: [join(repo, 'web/console/node_modules')],
    alias: { jsdom }, external: [jsdom],
    tsconfig: join(repo, 'web/console/tsconfig.json'),
    logLevel: 'error',
  })
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit', timeout: 30000 })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
} finally {
  rmSync(temp, { recursive: true, force: true })
}
