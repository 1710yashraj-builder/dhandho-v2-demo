/* Cloud endpoint for sync + backup.
   The publishable key is PUBLIC by design (Supabase model): every visitor
   gets it, and Row Level Security on the server is what protects the data
   (S2). Empty values = cloud features hide themselves, app stays local. */
window.DR_CLOUD = {
  url: 'https://ketnijvrheiaznwzxfeu.supabase.co',
  anonKey: 'sb_publishable_KPq9IgpWwNaa_s2zaFUhZA_fiBiDvvr'
};
