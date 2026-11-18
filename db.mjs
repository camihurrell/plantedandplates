import { neon } from '@neondatabase/serverless';
let connection, ready;
export function sql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) { const e = new Error('Your kitchen database is not connected yet.'); e.status = 503; throw e; }
  return connection ||= neon(url);
}
export function ensureSchema() {
  return ready ||= initialize().catch(error => { ready = undefined; throw error; });
}
async function initialize() {
  const db = sql();
  await db.transaction([
    db`CREATE TABLE IF NOT EXISTS pp_profiles (user_id text PRIMARY KEY, email text NOT NULL, name text NOT NULL DEFAULT '', is_demo boolean NOT NULL DEFAULT false, paid boolean NOT NULL DEFAULT false, pantry jsonb NOT NULL DEFAULT '[]', preferences jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`,
    db`CREATE TABLE IF NOT EXISTS pp_recipes (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES pp_profiles(user_id), recipe jsonb NOT NULL, saved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`,
    db`CREATE INDEX IF NOT EXISTS pp_recipes_owner ON pp_recipes(user_id, created_at DESC)`,
    db`CREATE TABLE IF NOT EXISTS pp_usage (user_id text NOT NULL, bucket text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY(user_id,bucket))`,
    db`CREATE TABLE IF NOT EXISTS pp_payments (session_id text PRIMARY KEY, user_id text NOT NULL REFERENCES pp_profiles(user_id), payment_intent text, created_at timestamptz NOT NULL DEFAULT now())`,
    db`CREATE TABLE IF NOT EXISTS pp_refunds (payment_intent text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`,
    db`CREATE TABLE IF NOT EXISTS pp_cache (key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz NOT NULL)`,
    db`CREATE TABLE IF NOT EXISTS pp_service_limits (key text PRIMARY KEY, next_at timestamptz NOT NULL)`
  ]);
}
export async function ensureProfile(user) {
  await ensureSchema(); const db = sql();
  const rows = await db`INSERT INTO pp_profiles (user_id,email,name) VALUES (${user.id},${user.email},${user.name || ''}) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name RETURNING *`;
  return rows[0];
}
