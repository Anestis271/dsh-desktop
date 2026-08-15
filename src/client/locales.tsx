export const zh = {
  desktop: '桌面快捷方式',
  appMenu: '应用菜单',
  login: '登录时启动',
  create: '创建',
} satisfies Record<string, string>

export type DesktopSettingsKey = keyof typeof zh

export const en = {
  desktop: 'Desktop shortcut',
  appMenu: 'Application menu',
  login: 'Launch at login',
  create: 'Create',
} satisfies Record<DesktopSettingsKey, string>
