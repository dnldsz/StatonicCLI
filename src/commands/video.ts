import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import {
  getTemplatesDir, getActiveAccountId, getClipLibraryDir,
  getProjectsDir, getAudioLibraryDir,
} from '../config.js'
import { uid, saveProject, readProject, snapToFrame, findSegment } from '../project.js'
import type { Project, TemplateMeta, Track, VideoSegment } from '../types.js'
import { renderPreview } from '../ffmpeg.js'
import { telegramSendDocument } from './telegram.js'

// ─── Build status (signals to StatonicEditor) ────────────────────────────

function getBuildStatusPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Statonic', 'build-status.json')
}

function writeBuildStatus(status: {
  status: 'building' | 'previewing' | 'done' | 'error'
  templateId?: string
  projectName?: string
  projectPath?: string
  startedAt?: string
  progress?: number
  currentStep?: string
  error?: string
}): void {
  try {
    const dir = join(homedir(), 'Library', 'Application Support', 'Statonic')
    mkdirSync(dir, { recursive: true })
    writeFileSync(getBuildStatusPath(), JSON.stringify(status, null, 2))
  } catch { /* editor may not be running */ }
}

// ─── Clip library loader ───────────────────────────────────────────────────

interface ClipEntry {
  id: string
  path: string
  name: string
  durationUs: number
  width: number
  height: number
}

function loadClipsByCategory(accountId: string): Record<string, ClipEntry[]> {
  const clipLibDir = getClipLibraryDir(accountId)
  const byCategory: Record<string, ClipEntry[]> = {}
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

function pickClip(
  byCategory: Record<string, ClipEntry[]>,
  category: string,
  opts?: { preferId?: string; usedIds?: Set<string>; minDurationUs?: number }
): ClipEntry | null {
  if (opts?.preferId) {
    for (const clips of Object.values(byCategory)) {
      const found = clips.find(c => c.id === opts.preferId)
      if (found) {
        if (opts.minDurationUs && found.durationUs < opts.minDurationUs) {
          console.warn(`  ⚠ clip "${found.name}" is ${(found.durationUs / 1e6).toFixed(1)}s but slot needs ${(opts.minDurationUs / 1e6).toFixed(1)}s`)
        }
        return found
      }
    }
  }

  // Always include subcategory clips (e.g. "showcase" includes "showcase/feynman")
  let pool: ClipEntry[] = [...(byCategory[category] || [])]
  const prefix = category + '/'
  for (const [cat, clips] of Object.entries(byCategory)) {
    if (cat.startsWith(prefix)) pool.push(...clips)
  }

  if (opts?.usedIds?.size) {
    const filtered = pool.filter(c => !opts.usedIds!.has(c.id))
    if (filtered.length) pool = filtered
  }

  // Prefer clips that are long enough for the slot
  if (opts?.minDurationUs && pool.length > 1) {
    const longEnough = pool.filter(c => c.durationUs >= opts.minDurationUs!)
    if (longEnough.length) pool = longEnough
  }

  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

// ─── Build preview frames and telegram them ───────────────────────────────

function previewAndTelegram(projectPath: string, doTelegram: boolean): void {
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
      telegramSendDocument(path, caption)
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
    console.error('Usage: statonic video build <template-id> [--name "..."] [--account <id>] [--clips \'{"slot_0":"clipId",...}\'] [--no-telegram]')
    console.error('\nAvailable templates:')
    const dir = getTemplatesDir()
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((f: string) => f.endsWith('.json'))) {
        try {
          const t = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
          const meta = t.templateMeta
          if (meta) console.error(`  ${meta.id} — ${t.name} (${meta.slots?.length ?? 0} slots)`)
        } catch {}
      }
    }
    process.exit(1)
  }

  let projectName = ''
  let noTelegram = false
  let accountOverride = ''
  let clipOverrides: Record<string, string> = {}
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) projectName = args[++i]
    if (args[i] === '--account' && args[i + 1]) accountOverride = args[++i]
    if (args[i] === '--clips' && args[i + 1]) {
      try { clipOverrides = JSON.parse(args[++i]) } catch {}
    }
    if (args[i] === '--no-telegram') noTelegram = true
  }

  const templatePath = join(getTemplatesDir(), `${templateId}.json`)
  if (!existsSync(templatePath)) { console.error(`Template "${templateId}" not found`); process.exit(1) }
  const template = JSON.parse(readFileSync(templatePath, 'utf-8'))

  if (!template.templateMeta) {
    console.error('Template missing templateMeta — legacy format no longer supported.')
    process.exit(1)
  }
  try {
    buildFromTemplateMeta(template, { projectName, accountOverride, noTelegram, clipOverrides })
  } catch (err: any) {
    writeBuildStatus({ status: 'error', templateId, error: err?.message ?? String(err) })
    throw err
  }
}

function saveAndPreview(project: Project, accountId: string, noTelegram: boolean): void {
  const projectsDir = getProjectsDir(accountId)
  mkdirSync(projectsDir, { recursive: true })
  const safeFilename = project.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase()
  const projectPath = join(projectsDir, `${safeFilename}.json`)
  saveProject(projectPath, project)
  console.log(`\nSaved: ${projectPath}`)

  writeBuildStatus({ status: 'previewing', projectName: project.name, progress: 0, currentStep: 'Rendering preview frames...' })
  console.log('\nRendering preview frames...')
  previewAndTelegram(projectPath, !noTelegram)

  writeBuildStatus({ status: 'done', projectName: project.name, projectPath })

  // Also write load-project.json so editor auto-opens the result
  try {
    const stateDir = join(homedir(), 'Library', 'Application Support', 'Statonic')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, 'load-project.json'), JSON.stringify({ projectPath, project }))
  } catch { /* editor may not be running */ }
}

function buildFromTemplateMeta(
  template: Project & { templateMeta: TemplateMeta },
  opts: { projectName: string; accountOverride: string; noTelegram: boolean; clipOverrides?: Record<string, string> }
): void {
  const meta = template.templateMeta
  const accountId = opts.accountOverride || getActiveAccountId()
  const byCategory = loadClipsByCategory(accountId)

  const project: Project = structuredClone(template)
  project.builtFromTemplate = meta.id
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
  const buildStart = new Date().toISOString()
  writeBuildStatus({ status: 'building', templateId: meta.id, projectName: project.name, startedAt: buildStart, progress: 0, currentStep: 'Assembling clips...' })

  const usedClipIds = new Set<string>()

  for (let si = 0; si < meta.slots.length; si++) {
    const slot = meta.slots[si]
    writeBuildStatus({ status: 'building', templateId: meta.id, projectName: project.name, startedAt: buildStart, progress: si / meta.slots.length, currentStep: `Picking ${slot.clipCategory} clip for slot ${si + 1}/${meta.slots.length}...` })
    const newSegId = idMap.get(slot.segmentId)
    if (!newSegId) { console.warn(`  [${slot.slotId}] segment not found`); continue }

    const found = findSegment(project, newSegId)
    if (!found || found.seg.type !== 'video') {
      console.warn(`  [${slot.slotId}] not a video segment`); continue
    }

    const overrideClipId = opts.clipOverrides?.[slot.slotId]
    const clip = pickClip(byCategory, slot.clipCategory, {
      preferId: overrideClipId,
      usedIds: usedClipIds,
      minDurationUs: found.seg.durationUs,
    })
    if (!clip) {
      console.warn(`  [${slot.slotId}] no clip for "${slot.clipCategory}"`); continue
    }
    usedClipIds.add(clip.id)

    // Swap clip source — position, crop, scale, zoom keyframes are preserved
    const videoSeg = found.seg as VideoSegment
    videoSeg.src = clip.path
    videoSeg.name = clip.name
    videoSeg.sourceWidth = clip.width
    videoSeg.sourceHeight = clip.height
    videoSeg.fileDurationUs = clip.durationUs
    videoSeg.sourceDurationUs = Math.min(videoSeg.durationUs, clip.durationUs)
    videoSeg.sourceStartUs = 0

    writeBuildStatus({ status: 'building', templateId: meta.id, projectName: project.name, startedAt: buildStart, progress: (si + 1) / meta.slots.length, currentStep: `${slot.clipCategory} → ${clip.name}` })
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
          telegramSendDocument(result, `🎬 @ ${t.toFixed(1)}s — ${project.name}`)
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
