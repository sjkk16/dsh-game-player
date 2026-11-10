import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { checkSource, projectRoot } from './validation.mjs'

try {
  const result = checkSource()
  for (const name of result.js) {
    const checked = spawnSync(process.execPath, ['--check', join(projectRoot, name)], { encoding: 'utf8', windowsHide: true })
    if (checked.error) throw checked.error
    if (checked.status !== 0) throw Error('Syntax error in ' + name + '\n' + checked.stderr)
  }
  console.log('Static validation passed: ' + result.js.length + ' JS/MJS files; local literal references, JSON and ' + result.secretChecked + ' text files checked.')
  console.log('No desktop process, screenshots, real input, visual acceptance or historical functional test suites were run.')
} catch (error) {
  console.error('Static validation failed: ' + error.message)
  process.exitCode = 1
}
