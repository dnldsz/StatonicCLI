import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getTemplatesDir } from '../config.js'
import { findProjectByName, loadDraft } from '../capcut/parser.js'
import { convertCapCutToTemplate } from '../capcut/converter.js'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function cmdTemplateImport(args: string[]): void {
  const dryRun = args.includes('--dry-run')

  // Extract flags and collect remaining args as project name
  const nameArgs: string[] = []
  let templateId = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') continue
    if (args[i] === '--id') { templateId = args[++i] ?? ''; continue }
    nameArgs.push(args[i])
  }

  const projectName = nameArgs.join(' ')
  if (!projectName) {
    console.error('Usage: statonic template import <capcut-project-name> [--id <template-id>] [--dry-run]')
    process.exit(1)
  }

  if (!templateId) templateId = slugify(projectName)

  const project = findProjectByName(projectName)
  if (!project) {
    console.error(`CapCut project not found: "${projectName}"`)
    process.exit(1)
  }

  console.log(`Loading CapCut project: ${project.draft_name}`)
  const draft = loadDraft(project)

  const template = convertCapCutToTemplate(draft, templateId)

  const videoTracks = template.tracks.filter(t => t.type === 'video')
  const textTracks = template.tracks.filter(t => t.type === 'text')
  const totalTextSegs = textTracks.reduce((n, t) => n + t.segments.length, 0)
  const format = videoTracks.length > 1 ? 'ABC/split' : 'sequential'

  console.log(`Format: ${format}`)
  console.log(`Canvas: ${template.canvas.width}x${template.canvas.height}`)
  console.log(`Video tracks: ${videoTracks.length} (${videoTracks.map(t => `${t.label}: ${t.segments.length} segs`).join(', ')})`)
  console.log(`Text segments: ${totalTextSegs} across ${textTracks.length} tracks`)
  console.log(`Slots: ${template.templateMeta!.slots.length} (clipCategory empty — assign via build-video skill)`)

  if (dryRun) {
    console.log('\n--- DRY RUN ---')
    console.log(JSON.stringify(template, null, 2))
    return
  }

  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const outPath = join(dir, `${templateId}.json`)
  writeFileSync(outPath, JSON.stringify(template, null, 2))
  console.log(`\nSaved: ${outPath}`)
}
