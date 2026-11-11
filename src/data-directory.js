import { mkdirSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const PLUGIN_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)))
export const DEFAULT_DATA_DIRECTORY = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'dsh-game-player')
export const DEFAULT_MACRO_STORAGE = join(DEFAULT_DATA_DIRECTORY, 'macros.json')
const failure = (code, message, cause) => Object.assign(new Error(message, { cause }), { code })

/** Relative overrides are package-relative, never relative to the Host's cwd. */
export function resolveDataDirectory(value) {
  if (value === undefined) return DEFAULT_DATA_DIRECTORY
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')
      || /^(?:\\\\|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(value) || /^[a-z]:[^\\\/]/i.test(value)) {
    throw failure('invalid_data_directory', 'dataDirectory must be a non-empty local directory path.')
  }
  return resolve(PLUGIN_DIRECTORY, value)
}

/** An explicit override fails closed, before any plugin stores or helpers exist. */
export function prepareDataDirectory(directory, io = { mkdirSync, openSync, writeSync, closeSync, unlinkSync }) {
  const probe = join(directory, '.storage-probe-' + randomUUID())
  let descriptor, created = false
  try {
    io.mkdirSync(directory, { recursive: true })
    descriptor = io.openSync(probe, 'wx'); created = true
    io.writeSync(descriptor, 'isolated-storage-probe')
    io.closeSync(descriptor); descriptor = undefined
    io.unlinkSync(probe); created = false
  } catch (cause) {
    throw failure('data_directory_unavailable', 'Configured dataDirectory is unavailable; no fallback was used.', cause)
  } finally {
    if (descriptor !== undefined) try { closeSync(descriptor) } catch {}
    if (created) try { unlinkSync(probe) } catch {}
  }
}

/** Schema-generated old defaults follow the data override; custom absolute paths win. */
export function resolveMacroStorage(value, directory) {
  const sameDefault = typeof value === 'string' && isAbsolute(value)
    && resolve(value).toLowerCase() === resolve(DEFAULT_MACRO_STORAGE).toLowerCase()
  return value === undefined || sameDefault ? join(directory, 'macros.json') : value
}
