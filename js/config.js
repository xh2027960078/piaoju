/* 部署配置：Supabase 项目信息。留空则统计功能自动关闭，其余功能不受影响。 */
window.APP_CONFIG = {
  supabaseUrl: 'https://pihrlxposrvbifachezg.supabase.co',
  // Settings → API Keys 里的 Publishable key（可公开，权限由数据库 RLS 控制，只能写不能读）
  supabaseAnonKey: 'sb_publishable_9TEZlkyYmC9oNCJT6nZ3Ww_rNcoQ3sD',
  // 应用版本，用于后台统计版本分布
  version: '1.1.43',
  // 应用内更新：优先读管理后台发布的版本记录（Supabase），读不到再退回 GitHub 上的 version.json
  releaseApi: 'https://pihrlxposrvbifachezg.supabase.co/rest/v1/releases?select=*&order=version_code.desc,created_at.desc&limit=1',
  updateUrl: 'https://xh2027960078.github.io/piaoju/app/version.json',
  // 是否在「设置 → 隐私」里显示统计开关；false = 隐藏（固定开启）
  showPrivacyToggle: false,
};
