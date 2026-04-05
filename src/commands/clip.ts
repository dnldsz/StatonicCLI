import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import { getClipLibraryDir, getActiveAccountId } from '../config.js'
import { getVideoInfo } from '../ffmpeg.js'
import { uid } from '../project.js'
import type { ClipMetadata } from '../types.js'

export function cmdClipAnalyze(args: string[]): void {
  const videoPath = args[0]
  if (!videoPath) {
    console.error('Usage: statonic clip analyze <video-path> --metadata \'<json>\'')
    process.exit(1)
  }

  let metadataJson = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--metadata' && args[i + 1]) metadataJson = args[++i]
  }

  if (!metadataJson) {
    console.error('Required: --metadata \'<json>\'')
    console.error('Example: statonic clip analyze clip.mov --metadata \'{"category":"hook","description":"...","tags":["tag1"]}\'')
    process.exit(1)
  }

  const info = getVideoInfo(videoPath)
  const metadata = JSON.parse(metadataJson)

  const full: ClipMetadata = {
    id: uid(),
    path: videoPath,
    name: metadata.name ?? basename(videoPath, extname(videoPath)),
    category: metadata.category ?? 'uncategorized',
    duration: info.durationSec,
    width: info.width,
    height: info.height,
    description: metadata.description ?? '',
    tags: metadata.tags ?? [],
    mood: metadata.mood ?? 'neutral',
    subject_visible: metadata.subject_visible ?? false,
    subject_position: metadata.subject_position ?? 'unknown',
    setting: metadata.setting ?? 'unknown',
    keyframe_timestamps: metadata.keyframe_timestamps ?? [],
    added: new Date().toISOString(),
    analyzed_by: 'claude-code',
  }

  const metadataPath = videoPath.replace(extname(videoPath), '.json')
  writeFileSync(metadataPath, JSON.stringify(full, null, 2))
  console.log(`Saved metadata: ${metadataPath}`)
}

export function cmdClipUpdate(args: string[]): void {
  const clipId = args[0]
  if (!clipId) {
    console.error('Usage: statonic clip update <clip-id> --metadata \'<json>\' [--account <id>]')
    process.exit(1)
  }

  let metadataJson = ''
  let accountId = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--metadata' && args[i + 1]) metadataJson = args[++i]
    if (args[i] === '--account' && args[i + 1]) accountId = args[++i]
  }

  if (!metadataJson) { console.error('Required: --metadata \'<json>\''); process.exit(1) }
  if (!accountId) accountId = getActiveAccountId()

  const clipDir = join(getClipLibraryDir(accountId), clipId)
  const metaPath = join(clipDir, 'metadata.json')
  if (!existsSync(metaPath)) { console.error(`Clip not found: ${clipId}`); process.exit(1) }

  const existing = JSON.parse(readFileSync(metaPath, 'utf-8'))
  const patch = JSON.parse(metadataJson)
  const updated = { ...existing, ...patch }

  writeFileSync(metaPath, JSON.stringify(updated, null, 2))

  const changed = Object.keys(patch).map(k => `${k}: ${JSON.stringify(existing[k])} → ${JSON.stringify(patch[k])}`).join('\n  ')
  console.log(`Updated ${clipId}:\n  ${changed}`)
}

export function cmdClipList(args: string[]): void {
  let category = ''
  let accountId = ''
  let jsonMode = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) category = args[++i]
    if (args[i] === '--account' && args[i + 1]) accountId = args[++i]
    if (args[i] === '--json') jsonMode = true
  }

  if (!accountId) accountId = getActiveAccountId()

  const clipsPath = getClipLibraryDir(accountId)
  if (!existsSync(clipsPath)) { console.log(jsonMode ? '[]' : 'No clips found.'); return }

  const clipDirs = readdirSync(clipsPath)
  const results: any[] = []

  for (const clipId of clipDirs) {
    const clipDir = join(clipsPath, clipId)
    try {
      if (!statSync(clipDir).isDirectory()) continue
      const metaPath = join(clipDir, 'metadata.json')
      if (!existsSync(metaPath)) continue
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))

      // Hierarchical category filter: "showcase" matches "showcase/scribble" etc.
      if (category && meta.category !== category && !meta.category.startsWith(category + '/')) continue

      // Fix stale path — construct from filesystem
      const files = readdirSync(clipDir).filter((f: string) => /\.(mp4|mov|m4v)$/i.test(f))
      if (files.length) meta.path = join(clipDir, files[0])

      results.push(meta)
    } catch { /* skip */ }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  for (const meta of results) {
    console.log(`${meta.name} [${meta.category}] ${meta.analyzed ? '✓' : '○'}`)
    console.log(`  ID: ${meta.id}`)
    console.log(`  Duration: ${meta.duration?.toFixed(1)}s | ${meta.width}×${meta.height}`)
    console.log(`  Path: ${meta.path}`)
    if (meta.description && meta.description !== '(pending analysis)') {
      console.log(`  Description: ${meta.description}`)
    }
    console.log()
  }
  console.log(`Total: ${results.length} clip(s)`)
}
