import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { basename, join } from 'path'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { loadConfig, getDataDir } from '../config.js'

function getCredentials(): { token: string; chatId: string } | null {
  const config = loadConfig()
  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken
  const chatId = process.env.TELEGRAM_CHAT_ID || config.telegramChatId
  if (!token || !chatId) return null
  return { token, chatId }
}

function postMultipart(
  apiMethod: string,
  token: string,
  fields: Record<string, string>,
  file: { fieldName: string; fileName: string; data: Buffer; contentType: string },
): { ok: boolean; description?: string } {
  const boundary = `----FormBoundary${randomBytes(8).toString('hex')}`
  const CRLF = '\r\n'
  const parts: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`))
  }
  parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"${CRLF}Content-Type: ${file.contentType}${CRLF}${CRLF}`))
  parts.push(file.data)
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`))

  const body = Buffer.concat(parts)
  const tmpBody = join(tmpdir(), `tg_${randomBytes(4).toString('hex')}.bin`)
  writeFileSync(tmpBody, body)

  const r = spawnSync('curl', [
    '-s', '-X', 'POST',
    `https://api.telegram.org/bot${token}/${apiMethod}`,
    '-H', `Content-Type: multipart/form-data; boundary=${boundary}`,
    '--data-binary', `@${tmpBody}`,
  ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  spawnSync('rm', ['-f', tmpBody])

  try { return JSON.parse(r.stdout) } catch { return { ok: false, description: r.stdout?.slice(0, 100) } }
}

export function telegramSendDocument(filePath: string, caption?: string): boolean {
  const creds = getCredentials()
  if (!creds) { console.warn('  [telegram] No credentials — skipping.'); return false }
  if (!existsSync(filePath)) { console.warn(`  [telegram] File not found: ${filePath}`); return false }

  const fields: Record<string, string> = { chat_id: creds.chatId }
  if (caption) fields.caption = caption

  const resp = postMultipart('sendDocument', creds.token, fields, {
    fieldName: 'document', fileName: basename(filePath),
    data: readFileSync(filePath), contentType: 'application/octet-stream',
  })
  if (!resp.ok) { console.warn(`  [telegram] Error: ${resp.description}`); return false }
  return true
}

export function telegramSendVideo(filePath: string, caption?: string): boolean {
  const creds = getCredentials()
  if (!creds) { console.warn('  [telegram] No credentials — skipping.'); return false }
  if (!existsSync(filePath)) { console.warn(`  [telegram] File not found: ${filePath}`); return false }

  const fields: Record<string, string> = { chat_id: creds.chatId, supports_streaming: 'true' }
  if (caption) fields.caption = caption

  const resp = postMultipart('sendVideo', creds.token, fields, {
    fieldName: 'video', fileName: basename(filePath),
    data: readFileSync(filePath), contentType: 'video/mp4',
  })
  if (!resp.ok) { console.warn(`  [telegram] Error: ${resp.description}`); return false }
  return true
}

// ---- Receive side: pull videos sent to the bot, reply with text ----

function curlJson(url: string): any {
  const r = spawnSync('curl', ['-s', url], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
  try { return JSON.parse(r.stdout) } catch { return { ok: false, description: r.stdout?.slice(0, 200) } }
}

function inboxDir(): string {
  const dir = join(getDataDir(), 'telegram-inbox')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function readOffset(dir: string): number {
  const f = join(dir, '.offset')
  if (!existsSync(f)) return 0
  const n = parseInt(readFileSync(f, 'utf-8').trim(), 10)
  return Number.isFinite(n) ? n : 0
}
function writeOffset(dir: string, offset: number): void {
  writeFileSync(join(dir, '.offset'), String(offset))
}

export function telegramSendMessage(text: string): boolean {
  const creds = getCredentials()
  if (!creds) { console.warn('  [telegram] No credentials — skipping.'); return false }
  const resp = curlJson(
    `https://api.telegram.org/bot${creds.token}/sendMessage?chat_id=${encodeURIComponent(creds.chatId)}&text=${encodeURIComponent(text)}`,
  )
  if (!resp.ok) { console.warn(`  [telegram] Error: ${resp.description}`); return false }
  return true
}

// Pull new video messages, download to the inbox, advance the offset.
// Prints JSON: { downloaded: [{ path, caption, date }], count }
export function telegramPoll(): void {
  const creds = getCredentials()
  if (!creds?.token) { console.error('No Telegram bot token.'); process.exit(1) }
  const dir = inboxDir()
  const offset = readOffset(dir)

  const updates = curlJson(
    `https://api.telegram.org/bot${creds.token}/getUpdates?timeout=0&allowed_updates=%5B%22message%22%5D${offset ? `&offset=${offset}` : ''}`,
  )
  if (!updates.ok) { console.error(`getUpdates failed: ${updates.description || JSON.stringify(updates)}`); process.exit(1) }

  const downloaded: Array<{ path: string; caption: string; date: number }> = []
  let maxUpdateId = offset - 1

  for (const u of updates.result || []) {
    if (typeof u.update_id === 'number') maxUpdateId = Math.max(maxUpdateId, u.update_id)
    const msg = u.message
    if (!msg) continue
    // Video either as a native video or as a document with a video mime type
    let fileId: string | undefined
    let suffix = '.mp4'
    if (msg.video?.file_id) {
      fileId = msg.video.file_id
    } else if (msg.document?.file_id && (msg.document.mime_type || '').startsWith('video/')) {
      fileId = msg.document.file_id
      const fn = msg.document.file_name || ''
      const dot = fn.lastIndexOf('.')
      if (dot > 0) suffix = fn.slice(dot)
    }
    if (!fileId) continue

    const fileInfo = curlJson(`https://api.telegram.org/bot${creds.token}/getFile?file_id=${encodeURIComponent(fileId)}`)
    const filePath = fileInfo?.result?.file_path
    if (!filePath) continue

    const dest = join(dir, `tg_${msg.date || Date.now()}_${msg.message_id}${suffix}`)
    const dl = spawnSync('curl', ['-s', '-o', dest, `https://api.telegram.org/file/bot${creds.token}/${filePath}`], { encoding: 'utf-8' })
    if (dl.status === 0 && existsSync(dest)) {
      downloaded.push({ path: dest, caption: msg.caption || '', date: msg.date || 0 })
    }
  }

  if (maxUpdateId >= offset) writeOffset(dir, maxUpdateId + 1)
  console.log(JSON.stringify({ downloaded, count: downloaded.length, inbox: dir }, null, 2))
}

export function cmdTelegram(args: string[]): void {
  // Subcommands: poll (receive videos), reply (send text)
  if (args[0] === 'poll') { return telegramPoll() }
  if (args[0] === 'reply') {
    const text = args.slice(1).join(' ').trim()
    if (!text) { console.error('Usage: statonic telegram reply "<text>"'); process.exit(1) }
    const ok = telegramSendMessage(text)
    if (ok) console.log('Replied.')
    else process.exit(1)
    return
  }

  const filePath = args[0]
  if (!filePath) { console.error('Usage: statonic telegram <file-path> [--caption "..."]\n       statonic telegram poll\n       statonic telegram reply "<text>"'); process.exit(1) }

  let caption = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--caption' && args[i + 1]) caption = args[++i]
  }

  const creds = getCredentials()
  if (!creds?.token) { console.error('No Telegram bot token. Set TELEGRAM_BOT_TOKEN env var or run: statonic config set telegramBotToken <token>'); process.exit(1) }
  if (!creds?.chatId) { console.error('No Telegram chat ID. Set TELEGRAM_CHAT_ID env var or run: statonic config set telegramChatId <id>'); process.exit(1) }
  if (!existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1) }

  const ok = telegramSendDocument(filePath, caption)
  if (ok) console.log(`Sent "${basename(filePath)}" to Telegram.`)
  else process.exit(1)
}
