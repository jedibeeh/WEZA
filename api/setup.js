// api/setup.js — run once to create/upgrade tables
// Visit https://weza-sigma.vercel.app/api/setup after deploying

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    // Users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'student',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // Safe upgrades for existing tables
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`;

    // User data table (active state + cfg per user)
    await sql`
      CREATE TABLE IF NOT EXISTS user_data (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patterns JSONB NOT NULL DEFAULT '[]',
        active JSONB NOT NULL DEFAULT '[]',
        cfg JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `;

    // Patterns table — separate from user_data so visibility can be controlled
    await sql`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category INTEGER,
        visibility TEXT NOT NULL DEFAULT 'draft',
        assigned_users INTEGER[] DEFAULT '{}',
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    res.status(200).json({ ok: true, message: 'Tables ready' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
