export const zh = {
  desktop: '桌面快捷方式',
  desktopDescription: '在桌面创建 DeepSeek Harness 快捷方式',
  appMenu: '应用菜单',
  appMenuDescription: '在系统应用菜单中创建快捷入口',
  login: '登录时启动',
  loginDescription: '登录系统后自动启动 DeepSeek Harness',
  create: '创建',
} satisfies Record<string, string>

export type DesktopSettingsKey = keyof typeof zh

export const en = {
  desktop: 'Desktop shortcut',
  desktopDescription: 'Create a DeepSeek Harness shortcut on the desktop.',
  appMenu: 'Application menu',
  appMenuDescription: 'Add DeepSeek Harness to the system application menu.',
  login: 'Launch at login',
  loginDescription: 'Start DeepSeek Harness automatically after signing in.',
  create: 'Create',
} satisfies Record<DesktopSettingsKey, string>
