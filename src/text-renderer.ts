import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { uid } from './project.js'
import { loadConfig } from './config.js'
import type { TextSegment } from './types.js'

// Matches emoji, including multi-codepoint sequences (flags, ZWJ combos, skin tones)
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2B50}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2190}-\u{21FF}\u{2702}-\u{27B0}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u

// Capture-split on emoji sequences so we can split a line into text/emoji runs
const EMOJI_SPLIT_RE = /([\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2B50}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2190}-\u{21FF}\u{2702}-\u{27B0}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]+)/u

type Run = { type: 'text' | 'emoji'; content: string }

function splitRuns(line: string): Run[] {
  const runs: Run[] = []
  const parts = line.split(EMOJI_SPLIT_RE)
  for (const part of parts) {
    if (!part) continue
    runs.push({ type: EMOJI_RE.test(part) ? 'emoji' : 'text', content: part })
  }
  return runs
}

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

  // Compute per-line base Y offsets (no whole-line emoji shift needed here —
  // emoji alignment is handled run-by-run in drawLine below).
  const lineYs = lines.map((_, i) => yPx - totalH / 2 + lineHeight * (i + 0.5))

  // Compute emoji vertical offset so emoji glyphs align with text glyphs.
  // Skia renders emoji higher than text at the same Y.  We split mixed lines
  // into separate text/emoji runs and push emoji runs down by the difference
  // between their visual centers (measured via actualBoundingBox metrics).
  function emojiYOffset(line: string): number {
    const textOnly = line.replace(EMOJI_RE, '').trim()
    const emojiOnly = line.replace(/[^\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2300}-\u{23FF}\u{2B50}\u{1F900}-\u{1FAFF}]/gu, '').trim()
    if (!textOnly || !emojiOnly) return 0
    const tm = ctx.measureText(textOnly)
    const em = ctx.measureText(emojiOnly)
    // Shift emoji down so it sits inline with the text.
    // Full top-alignment (emojiAscent - textAscent) overshoots; 0.72x gives
    // the perceptually correct inline position for mixed caps + emoji.
    return (em.actualBoundingBoxAscent - tm.actualBoundingBoxAscent) * 0.55
  }

  // Draw a line, splitting mixed text+emoji content into separate runs so
  // the emoji Y can be independently adjusted without moving the text.
  function drawLine(line: string, y: number, drawFn: (text: string, x: number, y: number) => void) {
    const isMixed = EMOJI_RE.test(line) && line.replace(EMOJI_RE, '').trim()
    if (!isMixed) {
      drawFn(line, xPx, y)
      return
    }

    const runs = splitRuns(line)
    const yShift = emojiYOffset(line)
    const savedAlign = ctx.textAlign
    ctx.textAlign = 'left'

    // Measure total width to compute start X for the original alignment
    const widths = runs.map(r => ctx.measureText(r.content).width)
    const totalWidth = widths.reduce((s, w) => s + w, 0)
    let curX = xPx
    if (savedAlign === 'center') curX = xPx - totalWidth / 2
    else if (savedAlign === 'right') curX = xPx - totalWidth

    for (let i = 0; i < runs.length; i++) {
      const runY = runs[i].type === 'emoji' ? y + yShift : y
      drawFn(runs[i].content, curX, runY)
      curX += widths[i]
    }
    ctx.textAlign = savedAlign
  }

  if (seg.strokeEnabled) {
    ctx.strokeStyle = seg.strokeColor ?? '#000000'
    const bw = Math.max(1, Math.round(Math.sqrt(effectiveSize) * 0.55))
    ctx.lineWidth = bw * 2.5
    ctx.lineJoin = 'round'
    lines.forEach((line, i) => {
      if (!line) return
      drawLine(line, lineYs[i], (t, x, y) => ctx.strokeText(t, x, y))
    })
  }

  ctx.fillStyle = seg.color
  lines.forEach((line, i) => {
    if (!line) return
    drawLine(line, lineYs[i], (t, x, y) => ctx.fillText(t, x, y))
  })

  const pngPath = join(tmpdir(), `text_${uid()}.png`)
  writeFileSync(pngPath, canvas.toBuffer('image/png'))
  return pngPath
}
