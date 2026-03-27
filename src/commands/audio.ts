import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { getAudioLibraryDir, getReelsDir } from '../config.js'
import { uid } from '../project.js'

export function cmdAudioExtractReel(args: string[]): void {
  const reelId = args[0]
  if (!reelId) {
    console.error('Usage: statonic audio extract-reel <reel-id> [--drop-time <sec>] [--name "..."]')
    process.exit(1)
  }

  let manualDropTime: number | null = null
  let customName = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--drop-time' && args[i + 1]) manualDropTime = parseFloat(args[++i])
    if (args[i] === '--name' && args[i + 1]) customName = args[++i]
  }

  const reelDir = join(getReelsDir(), reelId)
  const videoPath = join(reelDir, 'video.mp4')
  if (!existsSync(videoPath)) {
    console.error(`Reel video not found: ${videoPath}`)
    console.error('Download it first: statonic reel download <url>')
    process.exit(1)
  }

  // Determine drop time: use manual override, else scenes.json hook_duration
  let dropTimeSec = manualDropTime
  const scenesPath = join(reelDir, 'scenes.json')
  if (dropTimeSec === null) {
    if (existsSync(scenesPath)) {
      const scenes = JSON.parse(readFileSync(scenesPath, 'utf-8'))
      dropTimeSec = scenes.hook_duration ?? scenes.scenes?.[0]?.end ?? null
    }
    if (dropTimeSec === null) {
      console.error('Cannot auto-detect drop time: no scenes.json found.')
      console.error('Either run "statonic reel detect ' + reelId + '" first, or pass --drop-time <sec>')
      process.exit(1)
    }
    console.log(`Auto-detected drop time from scene cut: ${dropTimeSec.toFixed(3)}s`)
  }

  // Get audio duration via ffprobe
  const probeResult = spawnSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'a', videoPath,
  ], { encoding: 'utf-8' })
  let durationSec = 0
  try {
    const info = JSON.parse(probeResult.stdout)
    const aStream = info.streams?.[0]
    durationSec = parseFloat(aStream?.duration ?? '0')
    // Fallback to video duration
    if (!durationSec) {
      const vProbe = spawnSync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v', videoPath,
      ], { encoding: 'utf-8' })
      const vInfo = JSON.parse(vProbe.stdout)
      durationSec = parseFloat(vInfo.streams?.[0]?.duration ?? '0')
    }
  } catch { /* use 0 */ }

  // Extract audio to mp3
  const audioId = uid()
  const audioDir = join(getAudioLibraryDir(), audioId)
  mkdirSync(audioDir, { recursive: true })
  const audioPath = join(audioDir, 'audio.mp3')

  console.log(`Extracting audio from reel ${reelId}...`)
  const r = spawnSync('ffmpeg', [
    '-y', '-i', videoPath,
    '-vn', '-acodec', 'libmp3lame', '-q:a', '2',
    audioPath,
  ], { stdio: 'pipe' })

  if (r.status !== 0) {
    console.error(`FFmpeg failed: ${r.stderr?.toString().slice(-300)}`)
    process.exit(1)
  }

  const name = customName || `reel-${reelId.slice(0, 8)}`
  const meta = {
    id: audioId,
    name,
    path: audioPath,
    originalPath: videoPath,
    sourceReelId: reelId,
    duration: durationSec,
    dropTimeMs: Math.round(dropTimeSec * 1000),
    imported: new Date().toISOString(),
    waveformData: [],
  }
  writeFileSync(join(audioDir, 'metadata.json'), JSON.stringify(meta, null, 2))

  console.log(`Extracted: ${name}`)
  console.log(`  Duration: ${durationSec.toFixed(2)}s`)
  console.log(`  Drop time: ${dropTimeSec.toFixed(3)}s (${meta.dropTimeMs}ms)`)
  console.log(`  Audio ID: ${audioId}`)
  console.log(`  Path: ${audioPath}`)
}

export function cmdAudioList(args: string[]): void {
  const audioDir = getAudioLibraryDir()
  if (!existsSync(audioDir)) { console.log('No audio library found.'); return }

  const dirs = readdirSync(audioDir)
  let count = 0
  for (const audioId of dirs) {
    const metaPath = join(audioDir, audioId, 'metadata.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      count++
      const drop = meta.dropTimeMs != null ? `drop=${(meta.dropTimeMs / 1000).toFixed(2)}s` : 'no drop'
      console.log(`${meta.id}  ${meta.name}  dur=${meta.duration?.toFixed(2)}s  ${drop}`)
    } catch { /* skip */ }
  }
  if (count === 0) console.log('No audio found.')
}

export function cmdAudioFind(args: string[]): void {
  let hookDuration = 0
  let totalDuration = 0
  let preferClosest = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hook-duration' && args[i + 1]) hookDuration = parseFloat(args[++i])
    if (args[i] === '--total-duration' && args[i + 1]) totalDuration = parseFloat(args[++i])
    if (args[i] === '--prefer-closest') preferClosest = true
  }

  if (!hookDuration || !totalDuration) {
    console.error('Usage: statonic audio find --hook-duration <sec> --total-duration <sec> [--prefer-closest]')
    process.exit(1)
  }

  const audioDir = getAudioLibraryDir()
  if (!existsSync(audioDir)) { console.log('No audio library found.'); return }

  const audios: any[] = []
  const dirs = readdirSync(audioDir)
  for (const audioId of dirs) {
    const dir = join(audioDir, audioId)
    try {
      if (!statSync(dir).isDirectory()) continue
      const metaPath = join(dir, 'metadata.json')
      if (!existsSync(metaPath)) continue
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      audios.push({
        id: meta.id,
        name: meta.name,
        path: meta.path,
        duration: meta.duration,
        dropTimeMs: meta.dropTimeMs ?? null,
      })
    } catch {}
  }

  const suitable = audios.filter(a => {
    if (a.dropTimeMs === null) return false
    const dropSec = a.dropTimeMs / 1000
    if (dropSec < hookDuration - 0.1) return false
    if (a.duration < totalDuration) return false
    return true
  })

  if (suitable.length === 0) {
    console.log(`No suitable audio found.`)
    console.log(`Requirements: drop > ${hookDuration}s, duration >= ${totalDuration}s`)
    console.log(`Available audios:`)
    for (const a of audios) {
      console.log(`  ${a.name}: drop=${a.dropTimeMs ? (a.dropTimeMs / 1000).toFixed(2) + 's' : 'N/A'}, dur=${a.duration.toFixed(2)}s`)
    }
    return
  }

  if (preferClosest) {
    suitable.sort((a: any, b: any) =>
      Math.abs(a.dropTimeMs / 1000 - hookDuration) - Math.abs(b.dropTimeMs / 1000 - hookDuration)
    )
  }

  const selected = suitable[0]
  const dropSec = selected.dropTimeMs / 1000
  const audioStartSec = hookDuration - dropSec
  const audioStartUs = Math.round(audioStartSec * 1e6)
  const sourceStartUs = audioStartUs < 0 ? Math.round(Math.abs(audioStartUs)) : 0

  console.log(`Audio: ${selected.name}`)
  console.log(`Drop: ${dropSec.toFixed(2)}s | Duration: ${selected.duration.toFixed(2)}s`)
  console.log(`Path: ${selected.path}`)
  console.log()
  console.log(`Audio segment JSON:`)
  console.log(JSON.stringify({
    id: 'audio-1',
    type: 'audio',
    src: selected.path,
    name: selected.name,
    startUs: audioStartUs,
    durationUs: Math.round(totalDuration * 1e6),
    sourceStartUs,
    sourceDurationUs: Math.round(totalDuration * 1e6),
    fileDurationUs: Math.round(selected.duration * 1e6),
    volume: 1.0,
    dropTimeUs: selected.dropTimeMs * 1000,
  }, null, 2))
  console.log(`\n(${suitable.length} suitable audio(s) available)`)
}
