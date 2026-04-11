import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/** False when env vars were missing at build time (common on Vercel/Netlify if not set). */
export function isSupabaseConfigured() {
  const url = String(supabaseUrl).trim();
  const key = String(supabaseAnonKey).trim();
  if (!url || !key) return false;
  if (url.includes('your-project') || url.includes('placeholder')) return false;
  if (key === 'your-anon-key') return false;
  return true;
}

export const supabase = createClient(
  supabaseUrl || 'https://invalid.local',
  supabaseAnonKey || 'invalid',
  { auth: { persistSession: false } }
);
