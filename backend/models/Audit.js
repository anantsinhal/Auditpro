const { getSupabaseAdmin, createSupabaseUserClient } = require('../config/db');

function getClient(accessToken) {
  void accessToken;
  return getSupabaseAdmin();
}

class Audit {
  static async create({ user, url, seoScore, results }, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { data, error } = await supabase
      .from('audits')
      .insert([{
        user_id: user,
        url,
        seo_score: seoScore,
        results: results
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async findOne(criteria, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    let query = supabase.from('audits').select('*');

    if (criteria._id || criteria.id) {
      query = query.eq('id', criteria._id || criteria.id);
    }
    
    if (criteria.user) {
      query = query.eq('user_id', criteria.user);
    }

    const { data, error } = await query.single();
    
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data;
  }

  static async find(criteria, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    let query = supabase.from('audits').select('*');

    if (criteria.user) {
      query = query.eq('user_id', criteria.user);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  static sort() {
    return {
      limit: (num) => ({
        lean: async () => {
          return [];
        }
      })
    };
  }

  static async count({ accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { count, error } = await supabase.from('audits').select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  }

  static async findPaginated({ user, page = 1, limit = 20, search = '', scoreFilter = '' }, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = supabase
      .from('audits')
      .select('*', { count: 'exact' })
      .eq('user_id', user);
    if (search) query = query.ilike('url', `%${search}%`);
    if (scoreFilter === 'good') query = query.gte('seo_score', 70);
    else if (scoreFilter === 'needs-work') query = query.gte('seo_score', 40).lt('seo_score', 70);
    else if (scoreFilter === 'poor') query = query.lt('seo_score', 40);
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { audits: data || [], total: count || 0 };
  }

  static async getScoreHistory({ user, url, limit = 20 }, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    let query = supabase
      .from('audits')
      .select('url, seo_score, created_at')
      .eq('user_id', user);
    if (url) query = query.ilike('url', `%${url}%`);
    const { data, error } = await query
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  static async update(id, updates, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { data, error } = await supabase
      .from('audits')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = Audit;
