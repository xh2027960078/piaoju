/* 部署配置：填入 Supabase 项目信息后，匿名使用统计才会启用。
   不填也能正常使用（统计自动关闭）。 */
window.APP_CONFIG = {
  // 例：https://abcdefghijk.supabase.co
  supabaseUrl: 'https://pihrlxposrvbifachezg.supabase.co',
  // 项目 Settings → API Keys 里的 Publishable key（sb_publishable_...），可公开，权限由 RLS 控制。
  // 老项目也可以填以前的 anon public key（eyJ... 开头），两种都支持。
  supabaseAnonKey: 'sb_publishable_9TEZlkyYmC9oNCJT6nZ3Ww_rNcoQ3sD',
  // 应用版本，用于后台统计版本分布
  version: '1.1.8',
};
