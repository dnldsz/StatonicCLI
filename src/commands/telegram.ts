import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { loadConfig } from '../config.js'

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

export function cmdTelegram(args: string[]): void {
  const filePath = args[0]
  if (!filePath) { console.error('Usage: statonic telegram <file-path> [--caption "..."]'); process.exit(1) }

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
