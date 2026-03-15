import { existsSync, readdirSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { writeFileSync } from 'fs'
import {
  getTemplatesDir, getActiveAccountId, getClipLibraryDir,
  getProjectsDir, loadConfig,
} from '../config.js'
import { uid, saveProject, readProject } from '../project.js'
import { renderPreview } from '../ffmpeg.js'

// ─── Telegram helper (same logic as telegram.ts but callable internally) ───

function telegramSend(filePath: string, caption: string): void {
  const config = loadConfig()
  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken
  const chatId = process.env.TELEGRAM_CHAT_ID || config.telegramChatId
  if (!token || !chatId) {
    console.warn('  [telegram] No credentials — skipping send.')
    return
  }
  if (!existsSync(filePath)) {
    console.warn(`  [telegram] File not found: ${filePath}`)
    return
  }

  const fileData = readFileSync(filePath)
  const fileName = filePath.split('/').pop()!
  const boundary = `----FormBoundary${randomBytes(8).toString('hex')}`
  const CRLF = '\r\n'
  const parts: Buffer[] = []

  const addField = (name: string, value: string) =>
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`))

  addField('chat_id', chatId)
  if (caption) addField('caption', caption)
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="document"; filename="${fileName}"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`))
  parts.push(fileData)
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`))

  const body = Buffer.concat(parts)
  const tmpBody = join(tmpdir(), `tg_${randomBytes(4).toString('hex')}.bin`)
  writeFileSync(tmpBody, body)

  const r = spawnSync('curl', [
    '-s', '-X', 'POST',
    `https://api.telegram.org/bot${token}/sendDocument`,
    '-H', `Content-Type: multipart/form-data; boundary=${boundary}`,
    '--data-binary', `@${tmpBody}`,
  ], { encoding: 'utf-8' })
  spawnSync('rm', ['-f', tmpBody])

  try {
    const resp = JSON.parse(r.stdout)
    if (!resp.ok) console.warn(`  [telegram] Error: ${resp.description}`)
  } catch {
    console.warn(`  [telegram] Bad response: ${r.stdout?.slice(0, 100)}`)
  }
}

// ─── Clip library loader ───────────────────────────────────────────────────

function loadClipsByCategory(accountId: string): Record<string, any[]> {
  const clipLibDir = getClipLibraryDir(accountId)
  const byCategory: Record<string, any[]> = {}
  if (!existsSync(clipLibDir)) return byCategory

  for (const clipId of readdirSync(clipLibDir)) {
    const clipDir = join(clipLibDir, clipId)
    const metaPath = join(clipDir, 'metadata.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      const files = readdirSync(clipDir).filter((f: string) => /\.(mp4|mov|m4v)$/i.test(f))
      if (!files.length) continue
      const cat = meta.category || 'unknown'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push({
        id: meta.id ?? clipId,
        path: join(clipDir, files[0]),
        name: meta.name || files[0],
        durationUs: Math.round((meta.duration || 5) * 1e6),
        width: meta.width || 1080,
        height: meta.height || 1920,
      })
    } catch { /* skip corrupt metadata */ }
  }
  return byCategory
}

function pickClip(byCategory: Record<string, any[]>, category: string, preferId?: string): any | null {
  if (preferId) {
    // Search all categories for this specific clip ID
    for (const clips of Object.values(byCategory)) {
      const found = clips.find(c => c.id === preferId)
      if (found) return found
    }
  }
  const pool = byCategory[category] || []
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}

// ─── Build preview frames and telegram them ───────────────────────────────

export function previewAndTelegram(projectPath: string, doTelegram: boolean): void {
  const project = readProject(projectPath)

  // Find total duration from last segment end
  let totalSec = 0
  for (const track of project.tracks) {
    for (const seg of track.segments) {
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (end > totalSec) totalSec = end
    }
  }
  if (totalSec === 0) { console.log('  No segments found.'); return }

  // Sample at midpoint of each video segment — guaranteed to be within clip, avoids keyframe issues
  const videoSegs: Array<{ startSec: number; endSec: number }> = []
  for (const track of project.tracks) {
    if (track.type !== 'video') continue
    for (const seg of track.segments) {
      videoSegs.push({ startSec: seg.startUs / 1e6, endSec: (seg.startUs + seg.durationUs) / 1e6 })
    }
  }
  videoSegs.sort((a, b) => a.startSec - b.startSec)

  const sampleLabels = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6']
  const samplePoints = videoSegs.slice(0, 4).map(s => (s.startSec + s.endSec) / 2)
  const labels = samplePoints.map((_, i) => sampleLabels[i])

  const tmpDir = tmpdir()
  const previews: Array<{ path: string; label: string; timeSec: number }> = []

  console.log(`  Total duration: ${totalSec.toFixed(2)}s`)
  for (let i = 0; i < samplePoints.length; i++) {
    const t = samplePoints[i]
    const outPath = join(tmpDir, `preview_${labels[i]}_${Date.now()}.jpg`)
    try {
      const result = renderPreview(project, t, outPath)
      console.log(`  Preview [${labels[i]}] @ ${t.toFixed(2)}s → ${result}`)
      previews.push({ path: result, label: labels[i], timeSec: t })
    } catch (e: any) {
      console.warn(`  Preview [${labels[i]}] failed: ${e.message}`)
    }
  }

  if (doTelegram && previews.length) {
    console.log(`\n  Sending ${previews.length} preview frames to Telegram...`)
    for (const { path, label, timeSec } of previews) {
      const caption = `🎬 ${label} @ ${timeSec.toFixed(1)}s — ${project.name}`
      telegramSend(path, caption)
      console.log(`  Sent [${label}]`)
    }
  }

  console.log(`\n  Project: ${projectPath}`)
}

// ─── video build ──────────────────────────────────────────────────────────

export function cmdVideoBuild(args: string[]): void {
  const templateId = args[0]
  if (!templateId) {
    console.error('Usage: statonic video build <template-id> [--name "..."] [--hook <clip-id>] [--gizmo <clip-id>] [--topic "..."] [--no-telegram]')
    console.error('\nAvailable templates:')
    const dir = getTemplatesDir()
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((f: string) => f.endsWith('.json'))) {
        try {
          const t = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
          console.error(`  ${t.id} — ${t.name} (${t.slots?.length ?? 0} slots, ${t.total_duration_sec}s)`)
        } catch {}
      }
    }
    process.exit(1)
  }

  let projectName = ''
  let topic = ''
  let hookClipId = ''
  let gizmoClipId = ''
  let noTelegram = false
  const slotOverrides: Array<{ slot_id: string; clip_id?: string; text?: string }> = []

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name'     && args[i + 1]) projectName = args[++i]
    if (args[i] === '--topic'    && args[i + 1]) topic = args[++i]
    if (args[i] === '--hook'     && args[i + 1]) hookClipId = args[++i]
    if (args[i] === '--gizmo'    && args[i + 1]) gizmoClipId = args[++i]
    if (args[i] === '--no-telegram') noTelegram = true
    if (args[i] === '--slot'     && args[i + 1]) {
      try { slotOverrides.push(JSON.parse(args[++i])) } catch {}
    }
  }

  // Load template
  const templatePath = join(getTemplatesDir(), `${templateId}.json`)
  if (!existsSync(templatePath)) { console.error(`Template "${templateId}" not found`); process.exit(1) }
  const template = JSON.parse(readFileSync(templatePath, 'utf-8'))

  const accountId = getActiveAccountId()
  const byCategory = loadClipsByCategory(accountId)

  // Map category shortcuts to clip IDs
  if (hookClipId)  slotOverrides.push({ slot_id: 'hook', clip_id: hookClipId })
  if (gizmoClipId) slotOverrides.push({ slot_id: 'gizmo', clip_id: gizmoClipId })

  const videoTrack = { id: uid(), type: 'video' as const, label: 'VIDEO', segments: [] as any[] }
  const textTrack  = { id: uid(), type: 'text'  as const, label: 'TEXT',  segments: [] as any[] }

  console.log(`Building "${template.name}" (${template.slots.length} slots)...`)

  for (const slot of template.slots) {
    const override = slotOverrides.find(o => o.slot_id === slot.slot_id)
    const startUs    = Math.round(slot.start_sec * 1e6)
    const durationUs = Math.round(slot.duration_sec * 1e6)

    const clip = pickClip(byCategory, slot.clip_category, override?.clip_id)
    if (clip) {
      // Clamp source duration so we don't exceed file length
      const maxSourceUs = clip.durationUs - 0
      const sourceDurUs = Math.min(durationUs, maxSourceUs)
      videoTrack.segments.push({
        id: uid(), type: 'video',
        src: clip.path, name: clip.name,
        startUs, durationUs,
        sourceStartUs: 0, sourceDurationUs: sourceDurUs, fileDurationUs: clip.durationUs,
        sourceWidth: clip.width, sourceHeight: clip.height,
        clipX: 0, clipY: 0, clipScale: 1,
        cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      })
      console.log(`  [${slot.slot_id}] → ${clip.name} (${(clip.durationUs / 1e6).toFixed(1)}s clip, ${(durationUs / 1e6).toFixed(1)}s used)`)
    } else {
      console.warn(`  [${slot.slot_id}] ⚠ No clip found for category "${slot.clip_category}"`)
    }

    // Text: prefer override text, then topic-derived text, then template example
    let text = override?.text ?? slot.text?.example ?? ''
    if (topic && slot.slot_id === 'hook' && slot.text?.example) {
      // Replace placeholder topic in example text with the actual topic
      text = slot.text.example.replace(/\[TOPIC\]/gi, topic).replace(/\[topic\]/gi, topic)
    }
    if (text) {
      textTrack.segments.push({
        id: uid(), type: 'text', text,
        startUs, durationUs,
        x: 0, y: slot.text?.y ?? 0.28,
        fontSize: slot.text?.fontSize ?? 85,
        color: '#ffffff', bold: false, italic: false,
        strokeEnabled: true, strokeColor: '#000000', strokeWidth: 4,
        textAlign: 'center', textScale: 1,
      })
      console.log(`  [${slot.slot_id}] text: "${text.replace(/\n/g, ' / ')}"`)
    }
  }

  const finalName = projectName || `${template.name} - ${new Date().toLocaleDateString()}`
  const project = {
    name: finalName,
    accountId,
    canvas: { width: 1080, height: 1920 },
    tracks: [videoTrack, textTrack],
  }

  const projectsDir = getProjectsDir(accountId)
  mkdirSync(projectsDir, { recursive: true })
  const safeFilename = finalName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase()
  const projectPath = join(projectsDir, `${safeFilename}.json`)
  saveProject(projectPath, project)
  console.log(`\nSaved: ${projectPath}`)

  // Render previews + telegram
  console.log('\nRendering preview frames...')
  previewAndTelegram(projectPath, !noTelegram)
}

// ─── video preview ────────────────────────────────────────────────────────

export function cmdVideoPreview(args: string[]): void {
  const projectPath = args[0]
  if (!projectPath) {
    console.error('Usage: statonic video preview <project-path> [--telegram] [--times 1,3,5]')
    process.exit(1)
  }

  let doTelegram = args.includes('--telegram')
  let customTimes: number[] = []
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--times' && args[i + 1]) {
      customTimes = args[++i].split(',').map(Number).filter(n => !isNaN(n))
    }
  }

  if (!existsSync(projectPath)) { console.error(`Project not found: ${projectPath}`); process.exit(1) }

  if (customTimes.length > 0) {
    // Render specific times
    const project = readProject(projectPath)
    console.log(`Rendering ${customTimes.length} frames...`)
    for (const t of customTimes) {
      const outPath = join(tmpdir(), `preview_${t.toFixed(1)}s_${Date.now()}.jpg`)
      try {
        const result = renderPreview(project, t, outPath)
        console.log(`  @ ${t.toFixed(2)}s → ${result}`)
        if (doTelegram) {
          telegramSend(result, `🎬 @ ${t.toFixed(1)}s — ${project.name}`)
          console.log(`  Sent to Telegram`)
        }
      } catch (e: any) {
        console.warn(`  @ ${t.toFixed(2)}s failed: ${e.message}`)
      }
    }
    return
  }

  previewAndTelegram(projectPath, doTelegram)
}
