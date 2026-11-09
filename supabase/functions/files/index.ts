// Supabase Edge Function `files` (Deno). Wires real dependencies into handler.js.
// Secrets are read from the function's environment (Dashboard → Edge Functions → Secrets
// or `supabase secrets set`). NEVER put them in the website or in git.
//
// Required secrets:  B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_ENDPOINT, B2_REGION,
//                    ALLOWED_ORIGINS (comma-separated, e.g. http://127.0.0.1:5173,https://you.github.io)
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Optional overrides (if your project only has the new API keys):
//                    SB_PUBLISHABLE_KEY, SB_SECRET_KEY

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createHandler } from './handler.js';

function need(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? (fallback ? Deno.env.get(fallback) : undefined);
  if (!v) throw new Error(`Missing secret: ${name}`);
  return v;
}

const SUPABASE_URL = need('SUPABASE_URL');
const PUBLIC_KEY = need('SB_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');
const SECRET_KEY = need('SB_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const adminDb = createClient(SUPABASE_URL, SECRET_KEY, noSession);

const handle = createHandler({
  env: {
    bucket: need('B2_BUCKET'),
    endpoint: need('B2_ENDPOINT'), // e.g. https://s3.us-east-005.backblazeb2.com
    allowedOrigins: need('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  },
  aws: new AwsClient({
    accessKeyId: need('B2_KEY_ID'),
    secretAccessKey: need('B2_APPLICATION_KEY'),
    service: 's3',
    region: need('B2_REGION'), // e.g. us-east-005
  }),
  async userIdFromToken(token: string) {
    const { data, error } = await adminDb.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  userDb(authHeader: string | null) {
    return createClient(SUPABASE_URL, PUBLIC_KEY, {
      ...noSession,
      global: { headers: authHeader && !/Bearer\s+sb_/i.test(authHeader) ? { Authorization: authHeader } : {} },
    });
  },
  adminDb,
  uuid: () => crypto.randomUUID(),
});

Deno.serve(handle);
