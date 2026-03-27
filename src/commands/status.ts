import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { loadConfig, getTemplatesDir, getClipLibraryDir, getProjectsDir } from '../config.js'
import { loadAccounts } from '../accounts.js'

export function cmdStatus(args: string[]): void {
  const jsonMode = args.includes('--json')

  const config = loadConfig()
  const activeId = config.activeAccountId ?? ''
  const accounts = loadAccounts()
  const activeAccount = accounts.find(a => a.id === activeId)

  // ── Templates ──────────────────────────────────────────────────────────────
  const templatesDir = getTemplatesDir()
  const templates: any[] = []
  if (existsSync(templatesDir)) {
    for (const f of readdirSync(templatesDir).filter(f => f.endsWith('.json'))) {
      try {
        const t = JSON.parse(readFileSync(join(templatesDir, f), 'utf-8'))
        templates.push(t)
      } catch { /* skip */ }
    }
  }

  // ── Clip library ───────────────────────────────────────────────────────────
  const clipsByCategory: Record<string, any[]> = {}
  let totalClips = 0
  if (activeId) {
    const clipLibDir = getClipLibraryDir(activeId)
    if (existsSync(clipLibDir)) {
      for (const clipId of readdirSync(clipLibDir)) {
        const clipDir = join(clipLibDir, clipId)
        try {
          if (!statSync(clipDir).isDirectory()) continue
          const metaPath = join(clipDir, 'metadata.json')
          if (!existsSync(metaPath)) continue
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
          const files = readdirSync(clipDir).filter(f => /\.(mp4|mov|m4v)$/i.test(f))
          if (!files.length) continue
          const cat = meta.category || 'uncategorized'
          if (!clipsByCategory[cat]) clipsByCategory[cat] = []
          clipsByCategory[cat].push({
            id: meta.id ?? clipId,
            name: meta.name || files[0],
            duration: meta.duration || 0,
            width: meta.width || 0,
            height: meta.height || 0,
            analyzed: !!(meta.description && meta.description !== '(pending analysis)'),
            path: join(clipDir, files[0]),
          })
          totalClips++
        } catch { /* skip */ }
      }
    }
  }

  // ── Recent projects ────────────────────────────────────────────────────────
  const recentProjects: any[] = []
  if (activeId) {
    const projDir = getProjectsDir(activeId)
    if (existsSync(projDir)) {
      try {
        const files = readdirSync(projDir)
          .filter(f => f.endsWith('.json'))
          .map(f => ({ name: f, path: join(projDir, f), mtime: statSync(join(projDir, f)).mtime }))
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
          .slice(0, 10)
        for (const f of files) {
          recentProjects.push({
            name: f.name.replace(/\.json$/, ''),
            path: f.path,
            modifiedAt: f.mtime.toISOString(),
          })
        }
      } catch { /* skip */ }
    }
  }

  if (jsonMode) {
    const out = {
      activeAccount: { id: activeId, name: activeAccount?.name ?? activeId },
      accounts: accounts.map(a => ({ id: a.id, name: a.name, active: a.id === activeId })),
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        total_duration_sec: t.total_duration_sec,
        slots: (t.slots ?? []).map((s: any) => ({
          slot_id: s.slot_id,
          clip_category: s.clip_category,
          start_sec: s.start_sec,
          duration_sec: s.duration_sec,
          text_example: s.text?.example ?? '',
          text_y: s.text?.y,
          text_font_size: s.text?.fontSize,
        })),
      })),
      clipLibrary: {
        accountId: activeId,
        totalClips,
        categories: clipsByCategory,
      },
      recentProjects,
      config: {
        dataDir: config.dataDir,
        fontPath: config.fontPath,
        telegramConfigured: !!(config.telegramBotToken && config.telegramChatId),
      },
    }
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // ── Human-readable output ──────────────────────────────────────────────────
  console.log('=== STATONIC WORKSPACE STATUS ===\n')

  // Active account
  console.log('ACTIVE ACCOUNT')
  console.log(`  ID:   ${activeId || '(none)'}`)
  console.log(`  Name: ${activeAccount?.name ?? (activeId ? activeId : '(none set)')}`)
  console.log()

  // All accounts
  if (accounts.length > 0) {
    console.log('ALL ACCOUNTS')
    for (const a of accounts) {
      const marker = a.id === activeId ? ' (active)' : ''
      console.log(`  ${a.id} — ${a.name}${marker}`)
    }
    if (activeId && !activeAccount) {
      console.log(`  ${activeId} — (custom/unlisted, active)`)
    }
    console.log()
  }

  // Templates
  console.log(`TEMPLATES  (${templates.length} template${templates.length !== 1 ? 's' : ''})`)
  if (templates.length === 0) {
    console.log('  (none)')
  } else {
    for (const t of templates) {
      console.log(`  ${t.id} — "${t.name}"  ${t.total_duration_sec}s`)
      if (t.description) console.log(`    ${t.description}`)
      if (t.slots?.length) {
        console.log('    Slots:')
        for (const s of t.slots) {
          const timeRange = `${s.start_sec.toFixed(1)}s → ${s.duration_sec.toFixed(1)}s`
          const textHint = s.text?.example
            ? `  text: "${s.text.example.replace(/\n/g, ' / ').slice(0, 50)}"`
            : ''
          console.log(`      ${s.slot_id.padEnd(14)} [clip: ${s.clip_category}]  ${timeRange}${textHint}`)
        }
      }
      console.log()
    }
  }

  // Clip library
  const catNames = Object.keys(clipsByCategory)
  console.log(`CLIP LIBRARY (account: ${activeId})  ${totalClips} clips in ${catNames.length} categories\n`)
  if (totalClips === 0) {
    console.log('  (none)')
  } else {
    for (const cat of catNames) {
      const clips = clipsByCategory[cat]
      console.log(`  ${cat} (${clips.length} clip${clips.length !== 1 ? 's' : ''})`)
      for (const c of clips) {
        const analyzed = c.analyzed ? 'analyzed' : 'pending'
        console.log(`    ${c.id}  ${c.name.padEnd(30)}  ${c.duration.toFixed(1)}s  ${c.width}×${c.height}  ${analyzed}`)
      }
      console.log()
    }
  }

  // Recent projects
  console.log(`RECENT PROJECTS (account: ${activeId})  ${recentProjects.length > 0 ? `${recentProjects.length} most recent` : 'none'}`)
  if (recentProjects.length === 0) {
    console.log('  (none)')
  } else {
    for (const p of recentProjects) {
      console.log(`  ${p.name.padEnd(40)}  ${p.modifiedAt}`)
      console.log(`    ${p.path}`)
    }
  }
  console.log()

  // Config
  console.log('CONFIG')
  console.log(`  dataDir:  ${config.dataDir}`)
  console.log(`  fontPath: ${config.fontPath}`)
  console.log(`  telegram: ${(config.telegramBotToken && config.telegramChatId) ? 'configured' : 'not configured'}`)
}
