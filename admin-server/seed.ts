#!/usr/bin/env bun
// Seed script: creates an initial admin user
// Usage: bun seed.ts [email] [password] [name]

import { initDb, createUser, getUserByEmail } from './src/db.js'

const email = process.argv[2] || 'admin@localhost'
const password = process.argv[3] || 'admin'
const name = process.argv[4] || 'Admin'

initDb()

const existing = getUserByEmail(email)
if (existing) {
  console.log(`User ${email} already exists (role: ${existing.role})`)
  process.exit(0)
}

const user = await createUser(email, name, password, 'admin')
console.log(`Created admin user: ${user.email} (${user.role})`)
