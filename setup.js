// api/setup.js
// Run once to create tables: visit https://your-app.vercel.app/api/setup
// After tables are created you can ignore this endpoint.

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

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

    res.status(200).json({ ok: true, message: 'Tables created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
