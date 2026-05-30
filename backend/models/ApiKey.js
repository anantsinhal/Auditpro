const { getSupabaseAdmin, createSupabaseUserClient } = require('../config/db');
const crypto = require('crypto');

function getClient(accessToken) {
  void accessToken;
  return getSupabaseAdmin();
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateKey() {
  return 'ap_' + crypto.randomBytes(32).toString('hex');
}

class ApiKey {
  static async create({ user, name = 'Default' }, { accessToken } = {}) {
    const rawKey = generateKey();
    const keyHash = hashKey(rawKey);

    const supabase = getClient(accessToken);
    const { data, error } = await supabase.from('api_keys').insert([{ user_id: user, key_hash: keyHash, name }]).select().single();
    if (error) throw error;
    return { ...data, rawKey };
  }

  static async findByKey(rawKey, { accessToken } = {}) {
    const keyHash = hashKey(rawKey);
    const supabase = getClient(accessToken);
    const { data, error } = await supabase.from('api_keys').select('*').eq('key_hash', keyHash).eq('is_active', true).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
  }

  static async findByUser(userId, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { data, error } = await supabase.from('api_keys').select('id, user_id, name, last_used, is_active, created_at').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  static async updateLastUsed(id, { accessToken } = {}) {
    const now = new Date().toISOString();
    const supabase = getClient(accessToken);
    await supabase.from('api_keys').update({ last_used: now }).eq('id', id);
  }

  static async revoke(id, userId, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { error } = await supabase.from('api_keys').update({ is_active: false }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return true;
  }

  static async delete(id, userId, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { error } = await supabase.from('api_keys').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return true;
  }
}

module.exports = ApiKey;
