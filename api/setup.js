// api/setup.js — safe to run multiple times

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
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
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`;

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

    // patterns table — assigned_users stored as JSONB array of integer ids
    await sql`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category INTEGER,
        visibility TEXT NOT NULL DEFAULT 'draft',
        assigned_users JSONB NOT NULL DEFAULT '[]',
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // If assigned_users column was created as INTEGER[] previously, convert to JSONB
    // This is safe — it will error silently if already JSONB
    try {
      await sql`
        ALTER TABLE patterns
        ALTER COLUMN assigned_users TYPE JSONB
        USING to_jsonb(assigned_users)
      `;
    } catch(e) {
      // Already JSONB or no rows — fine
    }

    res.status(200).json({ ok: true, message: 'Tables ready' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
