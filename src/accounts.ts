import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir } from './config.js'
import type { Account } from './types.js'

export function getAccountsPath(): string {
  return join(getDataDir(), 'accounts.json')
}

export function loadAccounts(): Account[] {
  const path = getAccountsPath()
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return [] }
}

export function saveAccounts(accounts: Account[]): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getAccountsPath(), JSON.stringify(accounts, null, 2))
}
