import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { DraftInfo, ProjectMeta, RootMeta, CCMaterial } from './types.js'

const CAPCUT_PROJECTS_PATH =
  '/Users/danieldsouza/Movies/CapCut/User Data/Projects/com.lveditor.draft'

export function loadProjects(): ProjectMeta[] {
  const rootMetaPath = join(CAPCUT_PROJECTS_PATH, 'root_meta_info.json')
  if (!existsSync(rootMetaPath)) throw new Error(`CapCut projects not found at ${CAPCUT_PROJECTS_PATH}`)
  const raw = readFileSync(rootMetaPath, 'utf-8')
  const root: RootMeta = JSON.parse(raw)
  return root.all_draft_store.sort((a, b) => b.tm_draft_modified - a.tm_draft_modified)
}

export function loadDraft(project: ProjectMeta): DraftInfo {
  const raw = readFileSync(project.draft_json_file, 'utf-8')
  return JSON.parse(raw) as DraftInfo
}

export function flattenMaterials(draft: DraftInfo): Map<string, CCMaterial> {
  const map = new Map<string, CCMaterial>()
  for (const items of Object.values(draft.materials)) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item?.id) map.set(item.id, item)
    }
  }
  return map
}

export function findProjectByName(name: string): ProjectMeta | null {
  const projects = loadProjects()
  const lower = name.toLowerCase()
  return projects.find(p => p.draft_name.toLowerCase() === lower) ?? null
}
