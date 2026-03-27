import { loadConfig, saveConfig } from '../config.js'
import { uid } from '../project.js'
import { loadAccounts, saveAccounts } from '../accounts.js'
import type { Account } from '../types.js'

export function cmdAccountList(): void {
  const accounts = loadAccounts()
  const config = loadConfig()

  if (accounts.length === 0) { console.log('No accounts. Create one: statonic account create <name>'); return }

  for (const acc of accounts) {
    const active = acc.id === config.activeAccountId ? ' (active)' : ''
    console.log(`${acc.id} — ${acc.name}${active}`)
  }
}

export function cmdAccountSet(args: string[]): void {
  const id = args[0]
  if (!id) { console.error('Usage: statonic account set <id>'); process.exit(1) }

  const accounts = loadAccounts()
  const match = accounts.find(a => a.id === id || a.name.toLowerCase() === id.toLowerCase())
  if (!match) { console.error(`Account "${id}" not found`); process.exit(1) }

  saveConfig({ activeAccountId: match.id })
  console.log(`Active account: ${match.name} (${match.id})`)
}

export function cmdAccountCreate(args: string[]): void {
  const name = args[0]
  if (!name) { console.error('Usage: statonic account create <name>'); process.exit(1) }

  const accounts = loadAccounts()
  const newAcc: Account = {
    id: uid(),
    name,
    created: new Date().toISOString(),
  }
  accounts.push(newAcc)
  saveAccounts(accounts)

  // Set as active if first account
  if (accounts.length === 1) {
    saveConfig({ activeAccountId: newAcc.id })
    console.log(`Created and set as active: ${name} (${newAcc.id})`)
  } else {
    console.log(`Created: ${name} (${newAcc.id})`)
  }
}
