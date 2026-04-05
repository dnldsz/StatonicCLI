import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { getTemplatesDir } from '../config.js'

export function cmdTemplateList(args: string[] = []): void {
  const jsonMode = args.includes('--json')
  const dir = getTemplatesDir()
  if (!existsSync(dir)) { console.log(jsonMode ? '[]' : 'No templates directory found.'); return }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) { console.log(jsonMode ? '[]' : 'No templates found.'); return }

  if (jsonMode) {
    const templates: any[] = []
    for (const f of files) {
      try { templates.push(JSON.parse(readFileSync(join(dir, f), 'utf-8'))) } catch { /* skip */ }
    }
    console.log(JSON.stringify(templates, null, 2))
    return
  }

  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      const meta = t.templateMeta
      if (meta) {
        console.log(`${meta.id} — ${t.name}`)
        if (meta.description) console.log(`  ${meta.description}`)
        console.log(`  ${meta.slots?.length ?? 0} slots`)
      } else {
        console.log(`${t.id ?? f.replace('.json', '')} — ${t.name} (legacy)`)
        console.log(`  ${t.slots?.length ?? 0} slots, ${t.total_duration_sec}s total`)
      }
      console.log()
    } catch {
      console.log(`${f} (parse error)`)
    }
  }
}

export function cmdTemplateUse(_args: string[]): void {
  console.log('Use "statonic video build <template-id>" instead.')
  process.exit(0)
}
