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

    // prompt_templates — reusable generation prompts, managed from the Create page.
    // role identifies its place in the pipeline: 'amplify' | 'main_script' | 'domain_plan'.
    // type is a free-text label for organizing multiple templates of the same role
    // (e.g. several 'main_script' templates for different presenting issues).
    await sql`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'main_script',
        template_text TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'gemini',
        model TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'main_script'`;

    // generation_requests — covers both client-submitted requests (created via
    // /api/requests, sitting at status='requested' until a practitioner picks
    // them up) and practitioner-initiated generations. Every generation, of
    // either origin, flows through the same row: amplify stage populates
    // amplified_text and pauses at 'awaiting_review'; the finalize stage then
    // runs the main script + domain plan templates and writes result_pattern_id.
    await sql`
      CREATE TABLE IF NOT EXISTS generation_requests (
        id SERIAL PRIMARY KEY,
        requested_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        target_client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        input_text TEXT NOT NULL,
        amplify_template_id INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
        amplified_text TEXT,
        main_script_template_id INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
        domain_plan_template_id INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'requested',
        result_pattern_id TEXT REFERENCES patterns(id) ON DELETE SET NULL,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS amplify_template_id INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL`;
    await sql`ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS amplified_text TEXT`;
    await sql`ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS main_script_template_id INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL`;
    await sql`ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS domain_plan_template_id INTEGER REFERENCES prompt_templates(id) ON DELETE SET NULL`;
    await sql`ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;

    res.status(200).json({ ok: true, message: 'Tables ready' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
