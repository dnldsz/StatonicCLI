import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { uid } from './project.js'
import { loadConfig } from './config.js'
import type { TextSegment } from './types.js'

// Matches emoji, including multi-codepoint sequences (flags, ZWJ combos, skin tones)
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2B50}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2190}-\u{21FF}\u{2702}-\u{27B0}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u

let fontRegistered = false
let emojiFontFamily = ''

// macOS and common Linux paths for colour emoji fonts
const EMOJI_FONT_CANDIDATES = [
  '/System/Library/Fonts/Apple Color Emoji.ttc',          // macOS
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',    // Ubuntu/Debian
  '/usr/share/fonts/noto-emoji/NotoColorEmoji.ttf',       // Fedora
]

function ensureFont(): string {
  const config = loadConfig()
  const fontPath = config.fontPath
  if (!fontRegistered) {
    if (fontPath && existsSync(fontPath)) {
      GlobalFonts.registerFromPath(fontPath, 'StatonicFont')
    }
    // Register a colour emoji font so @napi-rs/canvas (Skia) can render emoji —
    // system fonts are NOT automatically available; they must be registered explicitly.
    for (const candidate of EMOJI_FONT_CANDIDATES) {
      if (existsSync(candidate)) {
        const family = candidate.includes('Apple') ? 'AppleColorEmoji' : 'NotoColorEmoji'
        try {
          GlobalFonts.registerFromPath(candidate, family)
          emojiFontFamily = family
        } catch { /* ignore */ }
        break
      }
    }
    fontRegistered = true
  }
  return fontPath && existsSync(fontPath) ? 'StatonicFont' : 'Arial'
}

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text)
}

/**
 * Render a text segment to a full-canvas transparent PNG.
 * Each line is rendered as a single fillText call — Skia's font fallback
 * handles emoji inline with text without any manual Y adjustment.
 * Previous per-run Y shifting caused inconsistent emoji height between
 * all-caps and mixed-case lines because their measured ascents differ.
 */
export function renderTextToPng(
  seg: TextSegment,
  canvasW: number,
  canvasH: number,
): string {
  const fontFamily = ensureFont()
  const canvas = createCanvas(canvasW, canvasH)
  const ctx = canvas.getContext('2d')

  const effectiveSize = seg.fontSize * (seg.textScale ?? 1)
  const weight = seg.bold ? 'bold' : 'normal'
  const style = seg.italic ? 'italic' : 'normal'
  const emojiFallback = emojiFontFamily ? `, ${emojiFontFamily}` : ', Apple Color Emoji, Noto Color Emoji'
  ctx.font = `${style} ${weight} ${effectiveSize}px ${fontFamily}${emojiFallback}, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = seg.textAlign || 'center'

  const xPx = ((seg.x + 1) / 2) * canvasW
  const yPx = ((1 - seg.y) / 2) * canvasH
  const lines = seg.text.split('\n')
  const lineHeight = effectiveSize
  const totalH = lines.length * lineHeight

  // Y centre of each line, matching the drawtext filter path
  const lineYs = lines.map((_, i) => yPx - totalH / 2 + lineHeight * (i + 0.5))

  if (seg.strokeEnabled) {
    ctx.strokeStyle = seg.strokeColor ?? '#000000'
    ctx.lineWidth = Math.max(1, effectiveSize * 0.12)
    ctx.lineJoin = 'round'
    lines.forEach((line, i) => {
      if (line) ctx.strokeText(line, xPx, lineYs[i])
    })
  }

  ctx.fillStyle = seg.color
  lines.forEach((line, i) => {
    if (line) ctx.fillText(line, xPx, lineYs[i])
  })

  const pngPath = join(tmpdir(), `text_${uid()}.png`)
  writeFileSync(pngPath, canvas.toBuffer('image/png'))
  return pngPath
}
