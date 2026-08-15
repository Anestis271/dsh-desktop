export const zh = {
  title: '桌面快捷入口',
  description: '创建当前用户的系统入口；每个入口仅启动 desktop profile。',
  desktop: '桌面快捷方式',
  appMenu: '应用菜单',
  login: '登录时启动',
} satisfies Record<string, string>

export type DesktopSettingsKey = keyof typeof zh

export const en = {
  title: 'Desktop shortcuts',
  description: 'Create per-user system entries that only start the desktop profile.',
  desktop: 'Desktop shortcut',
  appMenu: 'Application menu',
  login: 'Launch at login',
} satisfies Record<DesktopSettingsKey, string>
