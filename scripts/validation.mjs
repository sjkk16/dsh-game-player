import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
export const sourceRoots = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
const sourcePatterns = [
  /^src\/(?:[^/]+\.(?:js|mjs|ps1|cs|json)|live2d\/[^/]+\.js)$/,
  /^locale\/[^/]+\.json$/,
  /^desktop\/(?:[^/]+\.(?:cs|csproj|manifest|js)|packages\.lock\.json|profiles\/[^/]+\.json|web\/[^/]+\.(?:html|css))$/,
  /^scripts\/(?:[^/]+\.mjs|sdk-files\.json)$/,
]
export const shaderFiles = [
  'fragshadersrcalphablend.frag', 'fragshadersrccolorblend.frag', 'fragshadersrccopy.frag',
  'fragshadersrcmaskinvertedpremultipliedalpha.frag', 'fragshadersrcmaskpremultipliedalpha.frag',
  'fragshadersrcpremultipliedalpha.frag', 'fragshadersrcpremultipliedalphablend.frag',
  'fragshadersrcsetupmask.frag', 'vertshadersrc.vert', 'vertshadersrcblend.vert',
  'vertshadersrccopy.vert', 'vertshadersrcmasked.vert', 'vertshadersrcsetupmask.vert',
]
const secretPatterns = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['hardcoded secret', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{20,}["']/i],
  ['personal Windows path', /[A-Za-z]:[\\/]Users[\\/](?!Public[\\/])[^\\/\s"']+[\\/]/],
]

export function walkFiles(root, relative = '') {
  const files = []
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const name = relative ? relative + '/' + entry.name : entry.name
    if (entry.isSymbolicLink()) throw Error('Unexpected symbolic link: ' + name)
    if (entry.isDirectory()) files.push(...walkFiles(root, name))
    else if (entry.isFile()) files.push(name)
  }
  return files.sort()
}

export function sourceFiles(root = projectRoot) {
  return [...sourceRoots, ...['src', 'desktop', 'locale', 'scripts'].flatMap(directory => walkFiles(root, directory))
    .filter(name => sourcePatterns.some(pattern => pattern.test(name)))].sort()
}

export function assertSafeFile(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
    throw Error('Unsafe package path: ' + name)
  }
  if (/(^|\/)(?:\.git|node_modules|dist|\.qa|bin|obj|models|Deepseek桌宠)(?:\/|$)/i.test(name)
    || /(^|\/)\.env(?:$|\.)/i.test(name)
    || /\.(?:moc3|png|mp3|wav|ogg|pdb|pem|pfx|p12|key|log|tmp|bak|zip|tgz|7z)$/i.test(name)
    || /\.(?:model3|motion3|exp3|physics3|pose3|cdi3|user3)\.json$/i.test(name)
    || /(^|\/)Microsoft\.Web\.WebView2\.[^/]+\.xml$/i.test(name)) {
    throw Error('Private, generated, model or unnecessary file: ' + name)
  }
}

export function assertNoSecrets(root, names) {
  let checked = 0
  for (const name of names) {
    if (!/\.(?:js|mjs|cs|ps1|json|ya?ml|md|html|css|manifest|csproj|txt|xml)$/.test(name) && name !== 'LICENSE') continue
    const text = readFileSync(join(root, name), 'utf8')
    for (const [kind, pattern] of secretPatterns) if (pattern.test(text)) {
      throw Error(kind + ' pattern in ' + name + ' (value redacted)')
    }
    checked++
  }
  return checked
}

export function checkSource(root = projectRoot) {
  const names = sourceFiles(root)
  for (const name of names) {
    assertSafeFile(name)
    if (!existsSync(join(root, name))) throw Error('Missing source file: ' + name)
    if (name.endsWith('.json')) JSON.parse(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, ''))
    if (/\.(?:js|mjs)$/.test(name)) {
      const text = readFileSync(join(root, name), 'utf8')
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g)) {
        if (!existsSync(resolve(dirname(join(root, name)), match[1]))) throw Error('Missing local import: ' + name + ' -> ' + match[1])
      }
      for (const match of text.matchAll(/new URL\(\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        if (!existsSync(resolve(dirname(join(root, name)), match[1]))) throw Error('Missing local URL resource: ' + name + ' -> ' + match[1])
      }
    }
    if (name.endsWith('.ps1')) {
      const text = readFileSync(join(root, name), 'utf8')
      for (const match of text.matchAll(/Join-Path\s+\$PSScriptRoot\s+['"]([^'"]+\.(?:cs|json|ps1))['"]/g)) {
        if (!existsSync(resolve(dirname(join(root, name)), match[1]))) throw Error('Missing PowerShell resource: ' + name + ' -> ' + match[1])
      }
    }
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (DESKTOP_RUNTIME_DIRECTORY !== 'runtime/desktop-' + manifest.version) throw Error('Runtime directory and package version differ')
  const project = readFileSync(join(root, 'desktop/GamePlayer.Desktop.csproj'), 'utf8')
  if (!project.includes('<Version>' + manifest.version + '</Version>')) throw Error('Desktop project version differs from package version')
  for (const [name, command] of Object.entries(manifest.scripts)) {
    for (const match of command.matchAll(/(?:scripts|tests)\/[^\s]+\.(?:mjs|ps1)/g)) {
      if (!existsSync(join(root, match[0]))) throw Error('Missing script entry: ' + name + ' -> ' + match[0])
    }
  }
  return { names, js: names.filter(name => /\.(?:js|mjs)$/.test(name)), secretChecked: assertNoSecrets(root, names) }
}

export function runtimeFiles(root = projectRoot) {
  if (!existsSync(join(root, DESKTOP_RUNTIME_DIRECTORY))) throw Error('Runtime absent. Use source mode for a source checkout; copy or build the runtime before release mode.')
  return walkFiles(root, DESKTOP_RUNTIME_DIRECTORY)
}

export function checkRuntime(root = projectRoot) {
  const base = join(root, DESKTOP_RUNTIME_DIRECTORY), files = runtimeFiles(root)
  for (const name of files) assertSafeFile(name)
  const needed = [
    'GamePlayer.Desktop.exe', 'GamePlayer.Desktop.dll', 'GamePlayer.Desktop.deps.json', 'GamePlayer.Desktop.runtimeconfig.json',
    'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'Microsoft.Web.WebView2.Wpf.dll',
    'Microsoft.Windows.SDK.NET.dll', 'WinRT.Runtime.dll', 'key-map.json', 'overlay-layout.json', 'live2d-build.json',
    'web/index.html', 'web/style.css', 'web/renderer.js', 'web/vendor/live2dcubismcore.min.js', 'profiles/deepseek.json',
    'licenses/Core-RedistributableFiles.txt', 'licenses/Live2D-Core.md', 'licenses/Live2D-Framework.md', 'licenses/Live2D-SDK.md',
    'licenses/Live2D-NOTICE.md', 'licenses/WebView2-LICENSE.txt', 'licenses/WebView2-NOTICE.txt', 'licenses/Windows-SDK-NuGet-notice.xml',
    ...shaderFiles.map(name => 'web/shaders/' + name),
  ]
  const deps = JSON.parse(readFileSync(join(base, 'GamePlayer.Desktop.deps.json'), 'utf8'))
  for (const target of Object.values(deps.targets)) for (const library of Object.values(target)) {
    needed.push(...Object.keys(library.runtime ?? {}), ...Object.keys(library.runtimeTargets ?? {}))
  }
  for (const name of new Set(needed)) {
    assertSafeFile(name)
    if (!existsSync(join(base, name))) throw Error('Missing runtime dependency/resource/license: ' + name)
  }
  for (const name of files.filter(name => name.endsWith('.json'))) JSON.parse(readFileSync(join(root, name), 'utf8'))
  const shaders = files.filter(name => name.startsWith(DESKTOP_RUNTIME_DIRECTORY + '/web/shaders/') && /\.(?:vert|frag)$/.test(name))
  if (shaders.length !== shaderFiles.length) throw Error('Expected exactly 13 official shaders')
  const metadata = JSON.parse(readFileSync(join(base, 'live2d-build.json'), 'utf8'))
  const digest = name => createHash('sha256').update(readFileSync(join(base, name))).digest('hex')
  if (digest('web/renderer.js') !== metadata.rendererSha256) throw Error('Renderer differs from recorded build hash')
  if (digest('web/vendor/live2dcubismcore.min.js') !== metadata.coreSha256) throw Error('Core differs from recorded build hash')
  const build = readFileSync(join(root, 'scripts/build-live2d.mjs'), 'utf8')
  for (const property of ['archiveSha256', 'coreSha256']) {
    const pin = build.match(new RegExp(property + ":'([a-f0-9]{64})'"))?.[1]
    if (!pin || metadata[property] !== pin) throw Error('Build metadata differs from SDK pin: ' + property)
  }
  for (const [source, target] of [
    ['src/key-map.json', 'key-map.json'], ['src/overlay-layout.json', 'overlay-layout.json'],
    ['desktop/web/index.html', 'web/index.html'], ['desktop/web/style.css', 'web/style.css'],
    ['desktop/profiles/deepseek.json', 'profiles/deepseek.json'],
  ]) if (readFileSync(join(root, source), 'utf8').replace(/\r\n/g, '\n') !== readFileSync(join(base, target), 'utf8').replace(/\r\n/g, '\n')) throw Error('Source/runtime resource mismatch: ' + source)
  assertNoSecrets(root, files)
  return files
}
