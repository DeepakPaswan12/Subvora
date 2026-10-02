import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Single Supabase admin client (service-role key).
 * This key is NEVER exposed to the frontend.
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
