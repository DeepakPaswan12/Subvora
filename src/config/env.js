import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// ── Schema ─────────────────────────────────────────────
const envSchema = z.object({
  PORT:                     z.coerce.number().default(3000),
  NODE_ENV:                 z.enum(['development', 'production', 'test']).default('development'),

  SUPABASE_URL:             z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),

  WHOP_API_KEY:             z.string().min(1),
  WHOP_WEBHOOK_SECRET:      z.string().min(1),

  SHOPPEX_WEBHOOK_SECRET:         z.string().default(''),
  SHOPPEX_DYNAMIC_WEBHOOK_SECRET: z.string().default(''),

  CORS_ORIGIN:                    z.string().default('http://localhost:5173'),
});

// ── Parse & freeze ─────────────────────────────────────
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Safe to log variable names — never log values
  console.error('❌  Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
