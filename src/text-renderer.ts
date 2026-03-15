import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { uid } from './project.js'
import { loadConfig } from './config.js'
import type { TextSegment } from './types.js'

// Match the line height used in drawtext path
const LINE_HEIGHT = 1.0

// Regex to detect emoji / symbols that drawtext can't render
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
 * Render a text segment to a transparent PNG at full canvas resolution.
 * Text is positioned exactly where it would appear in the video.
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

  // Position: same math as buildDrawtextFilters
  const px = Math.round((seg.x + 1) / 2 * canvasW)
  const py = Math.round((1 - seg.y) / 2 * canvasH)

  const weight = seg.bold ? 'bold' : 'normal'
  const style = seg.italic ? 'italic' : 'normal'
  // Use the custom font, fall back to system fonts that support emoji
  ctx.font = `${style} ${weight} ${fs}px "${fontFamily}", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`

  ctx.textBaseline = 'top'
  ctx.textAlign = seg.textAlign || 'center'

  for (let li = 0; li < lines.length; li++) {
    if (!lines[li]) continue
    const lineY = py - Math.round(totalH / 2) + Math.round(lineH * li)
    const x = px

    // Draw stroke first (behind fill) — matches drawtext borderw logic
    if (seg.strokeEnabled) {
      const bw = Math.max(1, Math.round(Math.sqrt(fs) * 0.55))
      ctx.strokeStyle = seg.strokeColor
      // Canvas lineWidth is total width; drawtext borderw is per-side.
      // Use bw*2.5 to visually match FFmpeg's borderw rendering.
      ctx.lineWidth = bw * 2.5
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(lines[li], x, lineY)
    } else {
      // Subtle border matching text color to mimic browser's heavier font rendering
      // (matches drawtext path which uses bordercolor=textcolor borderw=2)
      ctx.strokeStyle = seg.color
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(lines[li], x, lineY)
    }

    // Fill text
    ctx.fillStyle = seg.color
    ctx.fillText(lines[li], x, lineY)
  }

  const pngPath = join(tmpdir(), `text_${uid()}.png`)
  const buffer = canvas.toBuffer('image/png')
  writeFileSync(pngPath, buffer)
  return pngPath
}
