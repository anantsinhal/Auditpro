const { createClient } = require('@supabase/supabase-js');

let adminClient = null;
let cachedUrl = null;
let cachedAnonKey = null;
let cachedServiceRoleKey = null;

const connectDB = async () => {
  try {
    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
    const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured.');
    }
    if (!supabaseServiceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY must be configured (server-side only).');
    }

    cachedUrl = supabaseUrl;
    cachedAnonKey = supabaseAnonKey;
    cachedServiceRoleKey = supabaseServiceRoleKey;

    const adminKey = cachedServiceRoleKey || cachedAnonKey;
    adminClient = createClient(cachedUrl, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'auditpro-server' } }
    });
    
    // Test connection by running a simple query
    const { error } = await adminClient
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned" which is fine
      throw error;
    }

    console.log(' Connected to Supabase');
  } catch (error) {
    console.error('Supabase connection error:', error.message);
    throw error;
  }
};

const getSupabaseAdmin = () => {
  if (!adminClient) {
    throw new Error('Supabase not initialized. Call connectDB() first.');
  }
  return adminClient;
};

const createSupabaseUserClient = (accessToken) => {
  const token = (accessToken || '').trim();
  if (!token) throw new Error('Missing access token for user-scoped Supabase client.');
  if (!cachedUrl || !cachedAnonKey) {
    throw new Error('Supabase not initialized. Call connectDB() first.');
  }
  return createClient(cachedUrl, cachedAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Client-Info': 'auditpro-user'
      }
    }
  });
};

module.exports = { connectDB, getSupabaseAdmin, createSupabaseUserClient };
