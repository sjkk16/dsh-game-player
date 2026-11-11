import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { validatePackageListing, checkSource, checkRuntime, projectRoot } from './validation.mjs'

try {
  const args = process.argv.slice(2), runtime = args.includes('--runtime')
  if (args.some(arg => arg.startsWith('--') && arg !== '--runtime')) throw Error('Usage: node scripts/check-package.mjs [--runtime] [npm-pack-listing.json]')
  const listings = args.filter(arg => arg !== '--runtime')
  if (listings.length > 1) throw Error('Expected at most one saved npm-pack listing')
  const source = checkSource(), runtimeNames = runtime ? checkRuntime() : []
  let listing
  if (listings.length) listing = JSON.parse(readFileSync(listings[0], 'utf8').replace(/^\uFEFF/, ''))
  else {
    const envCli = process.env.npm_execpath
    const cli = envCli && /(?:^|[\\/])npm-cli\.js$/.test(envCli) ? envCli : join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    if (!existsSync(cli)) throw Error('npm CLI unavailable. Use Node.js with npm, or pass a saved npm pack --dry-run --json listing.')
    const result = spawnSync(process.execPath, [cli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw Error(result.stderr || 'npm pack dry-run failed')
    listing = JSON.parse(result.stdout)
  }
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const result = validatePackageListing(listing, { manifest, sourceNames: source.names, runtimeNames, requireRuntime: runtime })
  console.log((runtime ? 'Release package validation' : 'Package listing validation') + ' passed: ' + result.fileCount + ' packaged files; identity, required files and exclusions verified.')
  if (!runtime) console.log('Runtime completeness was not checked. Use test:release for full runtime validation.')
  if (runtime) console.log('Managed/native dependencies, 13 shaders, licenses, source resource consistency and recorded renderer/Core hashes verified. No runtime was launched.')
} catch (error) {
  console.error('Package validation failed: ' + error.message)
  process.exitCode = 1
}
