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
 * Uses the same font as drawtext with stroke rendering tuned to match
 * FFmpeg's borderw output. Emoji render inline via system emoji fonts.
 */
export function renderTextToPng(
  seg: TextSegment,
  canvasW: number,
  canvasH: number,
): string {
  const fontFamily = ensureFont()
  const canvas = createCanvas(canvasW, canvasH)
  const ctx = canvas.getContext('2d')

  const fs = Math.round(seg.fontSize * (seg.textScale ?? 1))
  const lines = seg.text.split('\n')
  const lineH = Math.round(fs * LINE_HEIGHT)
  const totalH = lines.length * lineH

  const px = Math.round((seg.x + 1) / 2 * canvasW)
  const py = Math.round((1 - seg.y) / 2 * canvasH)

  const weight = seg.bold ? 'bold' : 'normal'
  const style = seg.italic ? 'italic' : 'normal'
  ctx.font = `${style} ${weight} ${fs}px ${fontFamily}, Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = seg.textAlign || 'center'

  for (let li = 0; li < lines.length; li++) {
    if (!lines[li]) continue
    const lineY = py - Math.round(totalH / 2) + Math.round(lineH * li)
    const x = px

    // Stroke — tuned to match FFmpeg drawtext borderw rendering.
    // borderw = sqrt(fs) * 0.55, canvas lineWidth = borderw * 3 for visual match.
    if (seg.strokeEnabled) {
      const bw = Math.max(1, Math.round(Math.sqrt(fs) * 0.55))
      ctx.strokeStyle = seg.strokeColor
      ctx.lineWidth = bw * 3
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(lines[li], x, lineY)
    } else {
      // Subtle same-color border for font weight (matches drawtext borderw=2)
      ctx.strokeStyle = seg.color
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(lines[li], x, lineY)
    }

    ctx.fillStyle = seg.color
    ctx.fillText(lines[li], x, lineY)
  }

  const pngPath = join(tmpdir(), `text_${uid()}.png`)
  writeFileSync(pngPath, canvas.toBuffer('image/png'))
  return pngPath
}
