/**
 * Keyboard overlay appearance tables.
 *
 * The overlay panel is a native window, so its palette cannot come from the
 * Web UI theme. Two JSON files own the data instead of the C# source:
 *
 * - `keyboard-themes.json` maps a theme id plus an accent id to the seven colors
 *   the panel draws with. The simulation color is part of the table because
 *   "simulation" must stay visually unmistakable in every theme.
 * - `overlay-layout.json` owns the key geometry and the key-count presets, so a
 *   layout switch only hides keys that are already positioned.
 *
 * The Host expands a selection into concrete `#RRGGBB` values and sends that to
 * the display process, which keeps the native side free of palette knowledge
 * and lets a new preset ship without rebuilding the desktop executable.
 *
 * @module @local/dsh-game-player/src/keyboard-style
 */
import { readFileSync } from 'node:fs'

/** Parse one JSON file that sits next to this module. */
function read(name) {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
}

const THEME_DATA = read('./keyboard-themes.json')
const LAYOUT_DATA = read('./overlay-layout.json')

/** Selectable theme ids, in the order the settings page offers them. */
export const THEMES = Object.freeze(Object.keys(THEME_DATA.themes))
/** Selectable accent ids. */
export const ACCENTS = Object.freeze(Object.keys(THEME_DATA.accents))
/** Selectable key-count presets, taken from the layout file itself. */
export const LAYOUTS = Object.freeze(Object.keys(LAYOUT_DATA.layouts))
/** Whether the panel draws its own keycaps or a user-supplied keyboard image. */
export const SKINS = Object.freeze(['builtin', 'custom'])
/** Which view the desktop runtime should show; `auto` keeps the tray choice. */
export const VIEWS = Object.freeze(['auto', 'model', 'keyboard'])

/** Schema defaults for the five appearance settings. */
export const STYLE_DEFAULTS = Object.freeze({
  view: 'auto',
  theme: 'dark',
  accent: 'teal',
  layout: 'full',
  skin: 'builtin',
})

const HEX = /^#[0-9a-fA-F]{6}$/

/** Pick a listed value or the fallback. */
function pick(list, value, fallback) {
  return typeof value === 'string' && list.includes(value) ? value : fallback
}

/** A valid color, or the fallback. A broken table entry must not blank the panel. */
function colorOf(value, fallback) {
  return typeof value === 'string' && HEX.test(value) ? value : fallback
}

/**
 * Expand one appearance selection into the payload the overlay understands.
 *
 * Unknown ids fall back to the default instead of throwing: this runs on a
 * settings write, and a typo in a profile patch must not break the panel.
 *
 * @param {{theme?: string, accent?: string, layout?: string, skin?: string}} [input]
 * @returns {{theme: string, accent: string, layout: string, skin: string, colors: Record<string, string>}}
 */
export function styleFor(input = {}) {
  const theme = pick(THEMES, input.theme, STYLE_DEFAULTS.theme)
  const accent = pick(ACCENTS, input.accent, STYLE_DEFAULTS.accent)
  const layout = pick(LAYOUTS, input.layout, STYLE_DEFAULTS.layout)
  const skin = pick(SKINS, input.skin, STYLE_DEFAULTS.skin)
  const base = THEME_DATA.themes[STYLE_DEFAULTS.theme]
  const row = THEME_DATA.themes[theme] ?? base
  const colors = {
    background: colorOf(row.background, base.background),
    text: colorOf(row.text, base.text),
    muted: colorOf(row.muted, base.muted),
    keyFill: colorOf(row.keyFill, base.keyFill),
    keyEdge: colorOf(row.keyEdge, base.keyEdge),
    accent: colorOf(THEME_DATA.accents[accent]?.[theme], THEME_DATA.accents[STYLE_DEFAULTS.accent][theme]),
    accentSim: colorOf(THEME_DATA.simulation?.[theme], THEME_DATA.simulation[STYLE_DEFAULTS.theme]),
  }
  return { theme, accent, layout, skin, colors }
}
