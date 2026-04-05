// Shared types from statonic-core
export {
  ScaleKeyframe, VideoSegment, TextSegment, AudioSegment, Segment,
  Track, Project, TemplateSlot, TemplateMeta, Account,
} from 'statonic-core'

// CLI-only types below

export interface ClipMetadata {
  id: string
  path: string
  name: string
  category: string
  duration: number
  width: number
  height: number
  description: string
  tags: string[]
  mood: string
  subject_visible: boolean
  subject_position: string
  setting: string
  keyframe_timestamps: number[]
  added: string
  analyzed_by: string
}

export interface ClipIndex {
  clips: ClipMetadata[]
  categories: string[]
  last_updated: string
}

// ── Reel analysis types ──────────────────────────────────────────────────────

export interface ReelMetadata {
  id: string
  url: string
  views: number
  date: string
  company: string
  duration: number
  width: number
  height: number
}

export interface SceneInfo {
  start: number
  end: number
  duration: number
}

export interface SceneData {
  scenes: SceneInfo[]
  raw_cuts: SceneInfo[]
  total_scenes: number
  total_cuts: number
  total_duration: number
  avg_scene_duration: number
  hook_duration: number
  body_avg_duration: number
  cuts_per_second: number
}

export interface ReelAnalysis {
  logical_scenes: LogicalScene[]
  hook_type: string
  hook_duration: number
  persistent_text: string[]
  total_logical_scenes: number
  structure_summary: string
  notes: string
}

export interface LogicalScene {
  start: number
  end: number
  duration: number
  cuts: number
  text_overlay: string[]
  persistent_text: boolean
  visual_description: string
}

export interface ReelIndexEntry {
  id: string
  url: string
  views: number
  company: string
  detected: boolean
}

export interface LibraryClipMeta {
  id: string
  accountId: string
  name: string
  path: string
  duration: number
  width: number
  height: number
  category: string
  analyzed: boolean
  description?: string
  tags?: string[]
  mood?: string
  subject_visible?: boolean
  subject_position?: string
  setting?: string
}
