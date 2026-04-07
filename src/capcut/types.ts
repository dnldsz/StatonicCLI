export interface TimeRange {
  duration: number
  start: number
}

export interface ClipTransform {
  alpha: number
  rotation: number
  scale: { x: number; y: number }
  transform: { x: number; y: number }
}

export interface CCKeyframe {
  time_offset: number
  values: number[]
  curveType?: string
}

export interface CCKeyframeGroup {
  property_type: string
  keyframe_list: CCKeyframe[]
}

export interface CCSegment {
  id: string
  material_id: string
  target_timerange: TimeRange | null
  source_timerange: TimeRange | null
  clip: ClipTransform | null
  speed: number
  volume: number
  visible: boolean
  extra_material_refs?: string[]
  common_keyframes?: CCKeyframeGroup[]
}

export interface CCTrack {
  id: string
  name: string
  type: 'video' | 'audio' | 'text' | 'sticker' | 'effect'
  segments: CCSegment[]
}

export interface CCMaterial {
  id: string
  type: string
  name?: string
  path?: string
  duration?: number
  width?: number
  height?: number
  content?: string  // JSON string for text materials
}

export interface CanvasConfig {
  width: number
  height: number
  ratio: string
}

export interface DraftInfo {
  id: string
  duration: number
  fps: number
  canvas_config: CanvasConfig
  tracks: CCTrack[]
  materials: Record<string, CCMaterial[]>
}

export interface ProjectMeta {
  draft_id: string
  draft_name: string
  draft_fold_path: string
  draft_json_file: string
  tm_draft_create: number
  tm_draft_modified: number
  tm_duration: number
}

export interface RootMeta {
  all_draft_store: ProjectMeta[]
}
