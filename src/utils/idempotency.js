import { supabase } from '../db/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Check whether a webhook event has already been processed.
 * Returns the existing row if found, null otherwise.
 */
export async function findEvent(provider, eventId) {
  const { data, error } = await supabase
    .from('webhook_events')
    .select('id, processed')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error }, 'idempotency: failed to look up event');
    throw error;
  }
  return data;
}

/**
 * Record a new webhook event (unprocessed).
 * If a duplicate constraint violation occurs, treat as already-seen.
 */
export async function recordEvent(provider, eventId, eventType, payload) {
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      provider,
      event_id: eventId,
      event_type: eventType,
      payload,
      processed: false,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation in PostgreSQL
    if (error.code === '23505') {
      logger.info({ provider, eventId }, 'idempotency: duplicate event insert ignored');
      return null; // signals duplicate
    }
    logger.error({ err: error }, 'idempotency: failed to record event');
    throw error;
  }
  return data;
}

/**
 * Mark an event as successfully processed.
 */
export async function markEventProcessed(eventRowId) {
  const { error } = await supabase
    .from('webhook_events')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('id', eventRowId);

  if (error) {
    logger.error({ err: error, eventRowId }, 'idempotency: failed to mark event processed');
    throw error;
  }
}
