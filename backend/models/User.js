const { getSupabaseAdmin, createSupabaseUserClient } = require('../config/db');
const bcrypt = require('bcryptjs');

function getClient(accessToken) {
  // This app issues its own JWT cookie for authentication.
  // That token is NOT a Supabase-signed JWT, so it must not be used as a
  // user-scoped Supabase Authorization token (it would fail with "invalid JWT").
  // Use the server-side admin client for all DB access.
  void accessToken;
  return getSupabaseAdmin();
}

class User {
  static async create({ name, email, password, plan = 'free', role = 'user', email_verified = false, email_verify_token = null, email_verify_expires = null }) {
    const hashedPassword = await bcrypt.hash(password, 12);

    const supabase = getClient();
    const { data, error } = await supabase
      .from('users')
      .insert([{
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        plan,
        role,
        audit_count: 0,
        audit_reset_month: new Date().getMonth(),
        email_verified,
        email_verify_token,
        email_verify_expires
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async findOne(criteria, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    let query = supabase.from('users').select('*');

    if (criteria.email) {
      query = query.eq('email', criteria.email.toLowerCase().trim());
    } else if (criteria.id || criteria._id) {
      query = query.eq('id', criteria.id || criteria._id);
    }

    const { data, error } = await query.single();
    
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data;
  }

  static async findById(id, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data;
  }

  static async updateOne(criteria, update, { accessToken } = {}) {
    const userId = criteria._id || criteria.id;

    const supabase = getClient(accessToken);
    const updateData = {};
    
    if (update.$set) {
      Object.keys(update.$set).forEach(key => {
        const snakeKey = key === 'auditCount' ? 'audit_count' : 
                        key === 'auditResetMonth' ? 'audit_reset_month' : key;
        updateData[snakeKey] = update.$set[key];
      });
    }
    
    if (update.$inc) {
      const user = await User.findById(userId, { accessToken });
      Object.keys(update.$inc).forEach(key => {
        const snakeKey = key === 'auditCount' ? 'audit_count' : key;
        updateData[snakeKey] = (user[snakeKey] || 0) + update.$inc[key];
      });
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async comparePassword(candidatePassword, hashedPassword) {
    return bcrypt.compare(candidatePassword, hashedPassword);
  }

  static async findByResetToken(token, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('password_reset_token', token)
      .gt('password_reset_expires', new Date().toISOString())
      .single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
  }

  static async findByVerifyToken(token, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email_verify_token', token)
      .gt('email_verify_expires', new Date().toISOString())
      .single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
  }

  static async deleteById(id, { accessToken } = {}) {
    const supabase = getClient(accessToken);
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  static async findAll({ page = 1, limit = 50 } = {}) {
    const supabase = getClient();
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, error, count } = await supabase
      .from('users')
      .select('id, name, email, plan, role, email_verified, audit_count, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { users: data || [], total: count || 0 };
  }

  static async count() {
    const supabase = getClient();
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  }
}

module.exports = User;
