import { basename } from 'path'
import type { DraftInfo, CCTrack, CCSegment, CCMaterial } from './types.js'
import type { Project, Track, VideoSegment, TextSegment, AudioSegment, TemplateSlot } from 'statonic-core'
import { uid } from '../project.js'
import { flattenMaterials } from './parser.js'

export function convertCapCutToTemplate(draft: DraftInfo, templateId: string): Project {
  const materials = flattenMaterials(draft)
  const canvas = { width: draft.canvas_config.width, height: draft.canvas_config.height }

  const videoTracks = draft.tracks.filter(t => t.type === 'video')
  const textTracks = draft.tracks.filter(t => t.type === 'text')
  const audioTracks = draft.tracks.filter(t => t.type === 'audio')

  const isABC = videoTracks.length > 1

  const stVideoTracks = convertVideoTracks(videoTracks, materials, isABC)
  const stTextTracks = convertTextTracks(textTracks, materials, canvas.width)
  const stAudioTracks = convertAudioTracks(audioTracks, materials)

  const allVideoSegs = stVideoTracks.flatMap(t => t.segments.filter((s): s is VideoSegment => s.type === 'video'))
  const allTextSegs = stTextTracks.flatMap(t => t.segments.filter((s): s is TextSegment => s.type === 'text'))
  const slots = generateSlots(allVideoSegs, allTextSegs)

  return {
    name: templateId.replace(/-/g, ' '),
    canvas,
    tracks: [...stAudioTracks, ...stVideoTracks, ...stTextTracks],
    templateMeta: {
      id: templateId,
      description: '',
      slots,
      audioSwappable: true,
    },
  }
}

// ── Video conversion ─────────────────────────────────────────────────────────

function convertVideoTracks(tracks: CCTrack[], materials: Map<string, CCMaterial>, isABC: boolean): Track[] {
  if (!isABC) {
    // Sequential: single video track
    const segs = tracks[0]?.segments ?? []
    return [{
      id: uid(),
      type: 'video',
      label: 'VIDEO',
      muted: true,
      segments: segs.map(s => convertVideoSegment(s, materials)),
    }]
  }

  // ABC: multiple tracks — segments within a track can have varying Y positions,
  // so label tracks numerically and let clipY on each segment define position
  return tracks.map((track, i) => ({
    id: uid(),
    type: 'video' as const,
    label: `VIDEO ${i + 1}`,
    muted: true,
    segments: track.segments.map(s => convertVideoSegment(s, materials)),
  }))
}

function convertVideoSegment(seg: CCSegment, materials: Map<string, CCMaterial>): VideoSegment {
  const mat = materials.get(seg.material_id)
  const srcPath = mat?.path ?? ''
  const name = srcPath ? basename(srcPath).replace(/\.[^.]+$/, '') : 'unknown'

  return {
    id: uid(),
    type: 'video',
    src: srcPath,
    name,
    startUs: seg.target_timerange?.start ?? 0,
    durationUs: seg.target_timerange?.duration ?? 0,
    sourceStartUs: seg.source_timerange?.start ?? 0,
    sourceDurationUs: seg.source_timerange?.duration ?? 0,
    fileDurationUs: mat?.duration ?? seg.source_timerange?.duration ?? 0,
    sourceWidth: mat?.width ?? 1080,
    sourceHeight: mat?.height ?? 1920,
    clipX: seg.clip?.transform.x ?? 0,
    clipY: seg.clip?.transform.y ?? 0,
    clipScale: seg.clip?.scale.x ?? 1,
    cropLeft: 0,
    cropRight: 0,
    cropTop: 0,
    cropBottom: 0,
  }
}

// ── Text conversion ──────────────────────────────────────────────────────────

function convertTextTracks(tracks: CCTrack[], materials: Map<string, CCMaterial>, canvasWidth: number): Track[] {
  return tracks
    .map((track, i) => ({
      id: uid(),
      type: 'text' as const,
      label: i === 0 ? 'TEXT' : `TEXT ${i + 1}`,
      segments: track.segments
        .map(s => convertTextSegment(s, materials, canvasWidth))
        .filter((s): s is TextSegment => s !== null),
    }))
    .filter(t => t.segments.length > 0)
}

function convertTextSegment(seg: CCSegment, materials: Map<string, CCMaterial>, canvasWidth: number): TextSegment | null {
  const mat = materials.get(seg.material_id)
  if (!mat?.content) return null

  let parsed: any
  try { parsed = JSON.parse(mat.content) } catch { return null }

  const text: string = parsed.text ?? ''
  if (!text) return null

  const style = parsed.styles?.[0]
  const scaleX = seg.clip?.scale.x ?? 1

  // CapCut base size 15 at scale 1.0 ≈ 93px on 1080w canvas.
  // Scale proportionally to canvas width so text looks the same size.
  const basePx = 93 * (canvasWidth / 1080)
  const fontSize = Math.round(basePx * scaleX)

  const fillColor = style?.fill?.content?.solid?.color
  const color = fillColor ? rgbArrayToHex(fillColor) : '#ffffff'

  const strokes = style?.strokes
  const hasStroke = Array.isArray(strokes) && strokes.length > 0 && (strokes[0]?.width ?? 0) > 0
  const strokeColor = hasStroke
    ? rgbArrayToHex(strokes[0].content?.solid?.color ?? [0, 0, 0])
    : '#000000'

  return {
    id: uid(),
    type: 'text',
    text,
    startUs: seg.target_timerange?.start ?? 0,
    durationUs: seg.target_timerange?.duration ?? 0,
    x: seg.clip?.transform.x ?? 0,
    y: seg.clip?.transform.y ?? 0,
    fontSize,
    color,
    bold: style?.bold ?? false,
    italic: style?.italic ?? false,
    strokeEnabled: hasStroke,
    strokeColor,
    textAlign: 'center',
    textScale: 1,
  }
}

// ── Audio conversion ─────────────────────────────────────────────────────────

function convertAudioTracks(tracks: CCTrack[], materials: Map<string, CCMaterial>): Track[] {
  if (tracks.length === 0) return []

  const segments: AudioSegment[] = []
  for (const track of tracks) {
    for (const seg of track.segments) {
      const mat = materials.get(seg.material_id)
      const srcPath = mat?.path ?? ''
      segments.push({
        id: uid(),
        type: 'audio',
        src: srcPath,
        name: srcPath ? basename(srcPath).replace(/\.[^.]+$/, '') : 'audio',
        startUs: seg.target_timerange?.start ?? 0,
        durationUs: seg.target_timerange?.duration ?? 0,
        sourceStartUs: seg.source_timerange?.start ?? 0,
        sourceDurationUs: seg.source_timerange?.duration ?? 0,
        fileDurationUs: mat?.duration ?? seg.source_timerange?.duration ?? 0,
        volume: seg.volume ?? 1,
      })
    }
  }

  return [{
    id: uid(),
    type: 'audio',
    label: 'AUDIO',
    segments,
  }]
}

// ── Slot generation ──────────────────────────────────────────────────────────

function generateSlots(videoSegs: VideoSegment[], textSegs: TextSegment[]): TemplateSlot[] {
  return videoSegs.map((vs, i) => {
    const matched = findMatchingText(vs, textSegs)
    return {
      slotId: `slot_${i}`,
      segmentId: vs.id,
      clipCategory: '',
      textSegmentId: matched?.id,
      textVariants: matched ? [matched.text] : undefined,
    }
  })
}

/** Match a video segment to the best text segment by temporal overlap + Y-proximity. */
function findMatchingText(video: VideoSegment, texts: TextSegment[]): TextSegment | null {
  const vStart = video.startUs
  const vEnd = vStart + video.durationUs

  let best: TextSegment | null = null
  let bestScore = -Infinity

  for (const t of texts) {
    const tStart = t.startUs
    const tEnd = tStart + t.durationUs

    // Temporal overlap
    const overlapStart = Math.max(vStart, tStart)
    const overlapEnd = Math.min(vEnd, tEnd)
    const overlap = Math.max(0, overlapEnd - overlapStart)
    if (overlap === 0) continue

    // Y-proximity score (closer = better, range 0-1)
    const yDist = Math.abs(video.clipY - t.y)
    const yScore = Math.max(0, 1 - yDist)

    // Combine: weight temporal overlap heavily, Y as tiebreaker
    const score = overlap / 1_000_000 + yScore * 0.5

    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }

  return best
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rgbArrayToHex(rgb: number[]): string {
  const [r, g, b] = rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0'))
  return `#${r}${g}${b}`
}
