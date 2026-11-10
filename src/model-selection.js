import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { preferenceError } from './overlay-preferences.js'

export const DEFAULT_MODEL_ENTRY = 'img/standard/cat_model/deepseek.model3.json'
export function defaultModelAvailable(path, exists = existsSync) {
  return typeof path === 'string' && path.length > 0 && exists(join(path, DEFAULT_MODEL_ENTRY))
}
export function requireModelSelection(selected, fallback, exists = existsSync) {
  if (typeof selected === 'string' && selected.length > 0) {
    if (!exists(selected)) throw preferenceError('model_missing', 'The selected model is unavailable. Select a model from the library or import its current location.')
    return selected
  }
  if (defaultModelAvailable(fallback, exists)) return fallback
  throw preferenceError('model_not_selected', 'No model is selected and no bundled model is installed. Select a model from the library or import a model first.')
}
