import { existsSync, readdirSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { writeFileSync } from 'fs'
import {
  getTemplatesDir, getActiveAccountId, getClipLibraryDir,
  getProjectsDir, getAudioLibraryDir, loadConfig,
} from '../config.js'
import { uid, saveProject, readProject, snapToFrame, findSegment } from '../project.js'
import type { Project, TemplateMeta, Track, VideoSegment, Segment } from '../types.js'
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

// ─── Audio picker ─────────────────────────────────────────────────────────

function pickAudioTrack(hookDurationSec: number, totalDurationSec: number): { track: Track; audioName: string } | null {
  const audioDir = getAudioLibraryDir()
  if (!existsSync(audioDir)) return null

  const candidates: any[] = []
  for (const audioId of readdirSync(audioDir)) {
    const metaPath = join(audioDir, audioId, 'metadata.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      if (meta.dropTimeMs == null) continue
      const dropSec = meta.dropTimeMs / 1000
      if (dropSec < hookDurationSec - 0.1) continue
      if (meta.duration < totalDurationSec) continue
      candidates.push(meta)
    } catch { /* skip */ }
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) =>
    Math.abs(a.dropTimeMs / 1000 - hookDurationSec) - Math.abs(b.dropTimeMs / 1000 - hookDurationSec)
  )
  const selected = candidates[0]
  const dropSec = selected.dropTimeMs / 1000

  const audioStartSec = hookDurationSec - dropSec
  const startUs = Math.round(audioStartSec * 1e6)
  const sourceStartUs = startUs < 0 ? Math.round(Math.abs(startUs)) : 0

  const track: Track = {
    id: uid(),
    type: 'audio',
    label: 'MUSIC',
    segments: [{
      id: uid(),
      type: 'audio' as const,
      src: selected.path,
      name: selected.name,
      startUs: Math.max(0, startUs),
      durationUs: Math.round(totalDurationSec * 1e6),
      sourceStartUs,
      sourceDurationUs: Math.round(totalDurationSec * 1e6),
      fileDurationUs: Math.round(selected.duration * 1e6),
      volume: 1.0,
      dropTimeUs: selected.dropTimeMs * 1000,
    }],
  }

  return { track, audioName: selected.name }
}

// ─── video build ──────────────────────────────────────────────────────────

export function cmdVideoBuild(args: string[]): void {
  const templateId = args[0]
  if (!templateId) {
    console.error('Usage: statonic video build <template-id> [--name "..."] [--account <id>] [--no-telegram]')
    console.error('\nAvailable templates:')
    const dir = getTemplatesDir()
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((f: string) => f.endsWith('.json'))) {
        try {
          const t = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
          const meta = t.templateMeta
          if (meta) {
            console.error(`  ${meta.id} — ${t.name} (${meta.slots?.length ?? 0} slots)`)
          } else {
            console.error(`  ${t.id ?? f.replace('.json', '')} — ${t.name} (legacy format)`)
          }
        } catch {}
      }
    }
    process.exit(1)
  }

  let projectName = ''
  let noTelegram = false
  let accountOverride = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) projectName = args[++i]
    if (args[i] === '--account' && args[i + 1]) accountOverride = args[++i]
    if (args[i] === '--no-telegram') noTelegram = true
  }

  const templatePath = join(getTemplatesDir(), `${templateId}.json`)
  if (!existsSync(templatePath)) { console.error(`Template "${templateId}" not found`); process.exit(1) }
  const template = JSON.parse(readFileSync(templatePath, 'utf-8'))

  // Route to new or legacy build
  if (template.templateMeta) {
    buildFromTemplateMeta(template, { projectName, accountOverride, noTelegram })
  } else {
    buildFromLegacyTemplate(template, args)
  }
}

function saveAndPreview(project: Project, accountId: string, noTelegram: boolean): void {
  const projectsDir = getProjectsDir(accountId)
  mkdirSync(projectsDir, { recursive: true })
  const safeFilename = project.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase()
  const projectPath = join(projectsDir, `${safeFilename}.json`)
  saveProject(projectPath, project)
  console.log(`\nSaved: ${projectPath}`)

  console.log('\nRendering preview frames...')
  previewAndTelegram(projectPath, !noTelegram)
}

function buildFromTemplateMeta(
  template: Project & { templateMeta: TemplateMeta },
  opts: { projectName: string; accountOverride: string; noTelegram: boolean }
): void {
  const meta = template.templateMeta
  const accountId = opts.accountOverride || getActiveAccountId()
  const byCategory = loadClipsByCategory(accountId)

  const project: Project = structuredClone(template)
  delete project.templateMeta

  // Assign new IDs and snap all segment times to 30fps frame boundaries
  const idMap = new Map<string, string>()
  for (const track of project.tracks) {
    track.id = uid()
    for (const seg of track.segments) {
      const oldId = seg.id
      seg.id = uid()
      seg.startUs = snapToFrame(seg.startUs)
      seg.durationUs = snapToFrame(seg.durationUs)
      idMap.set(oldId, seg.id)
    }
  }

  project.accountId = accountId
  project.name = opts.projectName || `${template.name} - ${new Date().toLocaleDateString()}`

  console.log(`Building "${template.name}" (${meta.slots.length} slots)...`)

  for (const slot of meta.slots) {
    const newSegId = idMap.get(slot.segmentId)
    if (!newSegId) { console.warn(`  [${slot.slotId}] segment not found`); continue }

    const found = findSegment(project, newSegId)
    if (!found || found.seg.type !== 'video') {
      console.warn(`  [${slot.slotId}] not a video segment`); continue
    }

    const clip = pickClip(byCategory, slot.clipCategory)
    if (!clip) {
      console.warn(`  [${slot.slotId}] no clip for "${slot.clipCategory}"`); continue
    }

    // Swap clip source — position, crop, scale, zoom keyframes are preserved
    const videoSeg = found.seg as VideoSegment
    videoSeg.src = clip.path
    videoSeg.name = clip.name
    videoSeg.sourceWidth = clip.width
    videoSeg.sourceHeight = clip.height
    videoSeg.fileDurationUs = clip.durationUs
    videoSeg.sourceDurationUs = Math.min(videoSeg.durationUs, clip.durationUs)
    videoSeg.sourceStartUs = 0

    console.log(`  [${slot.slotId}] → ${clip.name} (${slot.clipCategory})`)

    // Swap text variant if available
    if (slot.textSegmentId && slot.textVariants?.length) {
      const newTextId = idMap.get(slot.textSegmentId)
      if (newTextId) {
        const textFound = findSegment(project, newTextId)
        if (textFound && textFound.seg.type === 'text') {
          const variant = slot.textVariants[Math.floor(Math.random() * slot.textVariants.length)]
          ;(textFound.seg as any).text = variant
          console.log(`  [${slot.slotId}] text: "${variant.replace(/\n/g, ' / ')}"`)
        }
      }
    }
  }

  if (meta.audioSwappable) {
    let totalDurationSec = 0
    for (const track of project.tracks) {
      for (const seg of track.segments) {
        const end = (seg.startUs + seg.durationUs) / 1e6
        if (end > totalDurationSec) totalDurationSec = end
      }
    }

    let hookDurationSec = meta.hookDurationSec ?? 4.2
    if (!meta.hookDurationSec && meta.slots.length > 0) {
      const firstSegId = idMap.get(meta.slots[0].segmentId)
      if (firstSegId) {
        const found = findSegment(project, firstSegId)
        if (found) hookDurationSec = found.seg.durationUs / 1e6
      }
    }

    const result = pickAudioTrack(hookDurationSec, totalDurationSec)
    if (result) {
      const audioIdx = project.tracks.findIndex(t => t.type === 'audio')
      if (audioIdx >= 0) project.tracks[audioIdx] = result.track
      else project.tracks.push(result.track)
      console.log(`  [music] ${result.audioName}`)
    }
  }

  saveAndPreview(project, accountId, opts.noTelegram)
}

// Legacy build for old-format templates (slots at top level, no templateMeta)
function buildFromLegacyTemplate(template: any, args: string[]): void {
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

  const accountId = getActiveAccountId()
  const byCategory = loadClipsByCategory(accountId)

  if (hookClipId)  slotOverrides.push({ slot_id: 'hook', clip_id: hookClipId })
  if (gizmoClipId) slotOverrides.push({ slot_id: 'gizmo', clip_id: gizmoClipId })

  const videoTrack = { id: uid(), type: 'video' as const, label: 'VIDEO', segments: [] as any[], muted: true }
  const textTrack  = { id: uid(), type: 'text'  as const, label: 'TEXT',  segments: [] as any[] }

  console.log(`Building "${template.name}" (${template.slots.length} slots, legacy format)...`)

  for (const slot of template.slots) {
    const override = slotOverrides.find(o => o.slot_id === slot.slot_id)
    const startUs    = snapToFrame(Math.round(slot.start_sec * 1e6))
    const durationUs = snapToFrame(Math.round(slot.duration_sec * 1e6))

    const clip = pickClip(byCategory, slot.clip_category, override?.clip_id)
    if (clip) {
      const sourceDurUs = Math.min(durationUs, clip.durationUs)
      videoTrack.segments.push({
        id: uid(), type: 'video',
        src: clip.path, name: clip.name,
        startUs, durationUs,
        sourceStartUs: 0, sourceDurationUs: sourceDurUs, fileDurationUs: clip.durationUs,
        sourceWidth: clip.width, sourceHeight: clip.height,
        clipX: 0, clipY: 0, clipScale: 1,
        cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      })
      console.log(`  [${slot.slot_id}] → ${clip.name}`)
    } else {
      console.warn(`  [${slot.slot_id}] no clip for "${slot.clip_category}"`)
    }

    let text = override?.text ?? slot.text?.example ?? ''
    if (topic && slot.text?.example) {
      text = slot.text.example.replace(/\[TOPIC\]/gi, topic)
    }
    if (text) {
      textTrack.segments.push({
        id: uid(), type: 'text', text,
        startUs, durationUs,
        x: 0, y: slot.text?.y ?? 0.28,
        fontSize: slot.text?.fontSize ?? 72,
        color: '#ffffff', bold: false, italic: false,
        strokeEnabled: true, strokeColor: '#000000',
        textAlign: 'center', textScale: 1,
      })
    }
  }

  const finalName = projectName || `${template.name} - ${new Date().toLocaleDateString()}`
  const totalDurationSec = template.total_duration_sec
  const hookDurationSec: number = template.slots?.[0]?.duration_sec ?? 4.2

  const tracks: Track[] = [videoTrack, textTrack]
  const result = pickAudioTrack(hookDurationSec, totalDurationSec)
  if (result) {
    tracks.push(result.track)
    console.log(`  [music] ${result.audioName}`)
  }

  const project: Project = { name: finalName, accountId, canvas: { width: 1080, height: 1920 }, tracks }
  saveAndPreview(project, accountId, noTelegram)
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
