import { existsSync, readdirSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'fs'
import { join, basename, dirname } from 'path'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { readProject, saveProject, summariseProject } from '../project.js'
import { getProjectsDir, getActiveAccountId, loadConfig } from '../config.js'
import { exportVideo } from '../ffmpeg.js'

export function cmdProjectRead(args: string[]): void {
  const path = args[0]
  if (!path) { console.error('Usage: statonic project read <path> [--json]'); process.exit(1) }
  const project = readProject(path)
  if (args.includes('--json')) {
    console.log(JSON.stringify(project, null, 2))
  } else {
    console.log(summariseProject(project))
  }
}

export function cmdProjectList(args: string[]): void {
  let accountId = ''
  const accIdx = args.indexOf('--account')
  if (accIdx >= 0 && args[accIdx + 1]) accountId = args[accIdx + 1]

  const config = loadConfig()
  const dataDir = config.dataDir
  const projectsBase = join(dataDir, 'projects', 'accounts')

  if (!existsSync(projectsBase)) {
    console.log('No projects found.')
    return
  }

  let accountDirs = readdirSync(projectsBase).filter(f =>
    statSync(join(projectsBase, f)).isDirectory()
  )
  if (accountId) {
    accountDirs = accountDirs.filter(a => a.toLowerCase().includes(accountId.toLowerCase()))
  }

  const results: Array<{ account: string; name: string; path: string }> = []
  for (const acct of accountDirs) {
    const dir = join(projectsBase, acct)
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      results.push({ account: acct, name: basename(f, '.json'), path: join(dir, f) })
    }
    // Check subdirectories (variation folders)
    const subdirs = readdirSync(dir).filter(f => {
      try { return statSync(join(dir, f)).isDirectory() } catch { return false }
    })
    for (const sub of subdirs) {
      const subFiles = readdirSync(join(dir, sub)).filter(f => f.endsWith('.json'))
      for (const f of subFiles) {
        results.push({ account: acct, name: `${sub}/${basename(f, '.json')}`, path: join(dir, sub, f) })
      }
    }
  }

  if (results.length === 0) {
    console.log('No projects found.')
    return
  }

  for (const r of results) {
    console.log(`[${r.account}] ${r.name}`)
    console.log(`  ${r.path}`)
  }
}

export function cmdProjectWrite(args: string[]): void {
  const jsonStr = args[0]
  const filename = args[1]
  if (!jsonStr || !filename) {
    console.error('Usage: statonic project write <json> <filename>')
    process.exit(1)
  }

  const accountId = getActiveAccountId()
  const project = JSON.parse(jsonStr)
  if (!project.accountId) project.accountId = accountId

  const dir = getProjectsDir(accountId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const projectPath = join(dir, filename.endsWith('.json') ? filename : `${filename}.json`)
  saveProject(projectPath, project)
  console.log(`Saved: ${projectPath}`)
}

export async function cmdProjectExport(args: string[]): Promise<void> {
  const projectPath = args[0]
  if (!projectPath) { console.error('Usage: statonic project export <path> [--output <path>] [--telegram]'); process.exit(1) }

  let outputPath = ''
  let sendTelegram = false
  const outIdx = args.indexOf('--output')
  if (outIdx >= 0 && args[outIdx + 1]) outputPath = args[outIdx + 1]
  if (args.includes('--telegram')) sendTelegram = true

  const project = readProject(projectPath)
  if (!outputPath) {
    outputPath = join(dirname(projectPath), `${project.name ?? 'export'}.mp4`)
  }

  console.log(`Exporting to: ${outputPath}`)
  const result = await exportVideo(project, outputPath, (line) => {
    if (line.includes('frame=') || line.includes('time=')) {
      process.stderr.write(line)
    }
  })

  if (result.ok) {
    console.log(`Export complete: ${result.filePath}`)
    if (sendTelegram) {
      console.log('Sending to Telegram...')
      telegramSendVideo(result.filePath!, project.name ?? basename(outputPath))
    }
  } else {
    console.error(`Export failed: ${result.error}`)
    process.exit(1)
  }
}

function telegramSendVideo(filePath: string, caption: string): void {
  const config = loadConfig()
  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken
  const chatId = process.env.TELEGRAM_CHAT_ID || config.telegramChatId
  if (!token || !chatId) { console.warn('  [telegram] No credentials — skipping.'); return }

  const fileData = readFileSync(filePath)
  const fileName = basename(filePath)
  const boundary = `----FormBoundary${randomBytes(8).toString('hex')}`
  const CRLF = '\r\n'
  const parts: Buffer[] = []

  const addField = (name: string, value: string) =>
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`))

  addField('chat_id', chatId)
  addField('caption', caption)
  addField('supports_streaming', 'true')
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="video"; filename="${fileName}"${CRLF}Content-Type: video/mp4${CRLF}${CRLF}`))
  parts.push(fileData)
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`))

  const body = Buffer.concat(parts)
  const tmpBody = join(tmpdir(), `tg_${randomBytes(4).toString('hex')}.bin`)
  writeFileSync(tmpBody, body)

  const r = spawnSync('curl', [
    '-s', '-X', 'POST',
    `https://api.telegram.org/bot${token}/sendVideo`,
    '-H', `Content-Type: multipart/form-data; boundary=${boundary}`,
    '--data-binary', `@${tmpBody}`,
  ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  spawnSync('rm', ['-f', tmpBody])

  try {
    const resp = JSON.parse(r.stdout)
    if (resp.ok) console.log('  Sent to Telegram.')
    else console.warn(`  [telegram] Error: ${resp.description}`)
  } catch {
    console.warn(`  [telegram] Bad response: ${r.stdout?.slice(0, 100)}`)
  }
}
