import * as fs from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'

const localPath = path => {
  // Windows readlink may return an extended-length path. UNC is never repaired.
  if (/^[a-z]+:\/\//i.test(path)) return false
  if (path.startsWith('\\\\?\\')) return /^\\\\\?\\[a-z]:[\\\/]/i.test(path)
  return !/^(?:\\\\|\/\/)/.test(path)
}
const plainPath = path => path.startsWith('\\\\?\\') ? path.slice(4) : path
const failure = (code, message, path) => Object.assign(new Error(message + ': ' + path), { code, path })

/** Create storage directories, including missing targets of local directory links.
 * Existing links and files are never replaced; callers keep their original paths.
 */
export async function ensureStorageDirectory(path, { io = fs } = {}) {
  if (typeof path !== 'string' || !path || !localPath(path)) {
    throw failure('unsafe_storage_path', 'Storage must use a local directory', String(path))
  }
  const links = new Set()
  let hops = 0
  const walk = async input => {
    const full = resolve(plainPath(input)), root = parse(full).root
    let current = root
    for (const segment of full.slice(root.length).split(sep).filter(Boolean)) {
      current = join(current, segment)
      let stat
      try { stat = await io.lstat(current) }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        try { await io.mkdir(current) }
        catch (cause) { if (cause.code !== 'EEXIST') throw cause }
        stat = await io.lstat(current)
      }
      if (stat.isSymbolicLink()) {
        const key = process.platform === 'win32' ? current.toLowerCase() : current
        if (links.has(key) || ++hops > 32) throw failure('storage_link_cycle', 'Circular or excessive storage directory links', current)
        links.add(key)
        try {
          const raw = await io.readlink(current)
          if (!localPath(raw)) throw failure('unsafe_storage_path', 'Storage link target must be local', current)
          const target = plainPath(raw)
          current = await walk(isAbsolute(target) ? target : resolve(dirname(current), target))
        } finally { links.delete(key) }
      } else if (!stat.isDirectory()) {
        throw failure('ENOTDIR', 'Storage path is not a directory', current)
      }
    }
    return current
  }
  try { return await walk(path) }
  catch (cause) {
    if (['unsafe_storage_path', 'storage_link_cycle', 'ENOTDIR'].includes(cause.code)) throw cause
    throw Object.assign(new Error('Storage directory unavailable (' + (cause.code ?? 'I/O error') + '): ' + path + '; ' + cause.message, { cause }), { code: cause.code, path: cause.path ?? path })
  }
}
