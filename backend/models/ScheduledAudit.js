const { getSupabaseAdmin, createSupabaseUserClient } = require('../config/db');

function getClient(accessToken) {
  void accessToken;
  return getSupabaseAdmin();
}

function getTableName() {
  const fromEnv = (process.env.SCHEDULED_AUDITS_TABLE || '').trim();
  return fromEnv || 'scheduled_audits';
}

function isMissingRelationError(error) {
  const msg = (error && error.message) ? String(error.message) : '';
  const code = (error && error.code) ? String(error.code) : '';
  // Postgres undefined_table is 42P01, but PostgREST/Supabase can surface different shapes.
  return code === '42P01' || /does not exist/i.test(msg) || /undefined table/i.test(msg) || /relation .* does not exist/i.test(msg);
}

async function withTableFallback(run) {
  const primary = getTableName();
  const alternate = primary === 'scheduled_audits' ? 'schedules_audits' : 'scheduled_audits';
  try {
    return await run(primary);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    return run(alternate);
  }
}

function computeNextRun(frequency) {
  const now = new Date();
  if (frequency === 'daily') return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  if (frequency === 'weekly') return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (frequency === 'monthly') { const d = new Date(now); d.setMonth(d.getMonth() + 1); return d.toISOString(); }
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

class ScheduledAudit {
  static async create({ user, url, frequency = 'weekly' }, { accessToken } = {}) {
    const nextRun = computeNextRun(frequency);
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .insert([{ user_id: user, url, frequency, next_run: nextRun }])
        .select()
        .single();
      if (error) throw error;
      return data;
    });
  }

  static async findByUser(userId, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    });
  }

  static async findOne({ id, user }, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .eq('user_id', user)
        .single();
      if (error) { if (error.code === 'PGRST116') return null; throw error; }
      return data;
    });
  }

  static async update(id, updates, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    });
  }

  static async delete(id, userId, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
      return true;
    });
  }

  static async findDue({ accessToken } = {}) {
    const now = new Date().toISOString();
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('is_active', true)
        .lte('next_run', now);
      if (error) throw error;
      return data || [];
    });
  }

  static async countByUser(userId, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    return withTableFallback(async (table) => {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw error;
      return count || 0;
    });
  }
}

module.exports = ScheduledAudit;
