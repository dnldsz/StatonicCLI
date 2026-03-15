import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { uid } from './project.js'
import { loadConfig } from './config.js'
import type { TextSegment } from './types.js'

const LINE_HEIGHT = 1.0

// Matches emoji, including multi-codepoint sequences (flags, ZWJ combos, skin tones)
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2B50}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2190}-\u{21FF}\u{2702}-\u{27B0}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u

let fontRegistered = false

function ensureFont(): string {
  const config = loadConfig()
  const fontPath = config.fontPath
  if (!fontRegistered && fontPath && existsSync(fontPath)) {
    GlobalFonts.registerFromPath(fontPath, 'StatonicFont')
    fontRegistered = true
  }
  return fontPath && existsSync(fontPath) ? 'StatonicFont' : 'Arial'
}

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text)
}

/**
 * Render a text segment to a full-canvas transparent PNG.
 * Ported from iterate-editor's renderTextToPng (App.tsx) which handles
 * emoji inline with text using textBaseline 'middle'.
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
  ctx.font = `${style} ${weight} ${effectiveSize}px ${fontFamily}, Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = seg.textAlign || 'center'

  const xPx = ((seg.x + 1) / 2) * canvasW
  const yPx = ((1 - seg.y) / 2) * canvasH
  const lines = seg.text.split('\n')
  const lineHeight = effectiveSize
  const totalH = lines.length * lineHeight

  if (seg.strokeEnabled) {
    ctx.strokeStyle = seg.strokeColor ?? '#000000'
    const bw = Math.max(1, Math.round(Math.sqrt(effectiveSize) * 0.55))
    ctx.lineWidth = bw * 2.5
    ctx.lineJoin = 'round'
    lines.forEach((line, i) => {
      if (!line) return
      ctx.strokeText(line, xPx, yPx - totalH / 2 + lineHeight * (i + 0.5))
    })
  }

  ctx.fillStyle = seg.color
  lines.forEach((line, i) => {
    if (!line) return
    ctx.fillText(line, xPx, yPx - totalH / 2 + lineHeight * (i + 0.5))
  })

  const pngPath = join(tmpdir(), `text_${uid()}.png`)
  writeFileSync(pngPath, canvas.toBuffer('image/png'))
  return pngPath
}
