# macOS 真机测试

本文用于验证无法在 Windows 单元测试中覆盖的 Electron.app、Dock、Tray、Finder 和 launchd 行为。分别在 Apple Silicon 和 Intel/Rosetta 环境执行时，记录 macOS、Node、Electron 和 CPU 架构版本。

## 1. 全新运行时

先退出 dsh Desktop，将当前 profile 下的 `desktop-shell/electron` 目录移动到备份位置，再运行：

```bash
dsh --profile desktop
```

确认首次下载完成后窗口可以启动，且没有 `EACCES`、dyld 或 framework 错误。检查缓存中的主程序可执行，并确认 framework 的 `Versions/Current` 是符号链接：

```bash
test -x ~/.dsh/profiles/desktop/desktop-shell/electron/*-darwin-*/Electron.app/Contents/MacOS/Electron
find ~/.dsh/profiles/desktop/desktop-shell/electron -path '*/Versions/Current' -type l -print
```

## 2. 窗口与标题栏

1. 展开和收起侧边栏，拖动标题栏区域移动窗口。
2. 点击会话标题栏右侧的所有按钮，确认没有被拖拽层拦截。
3. 验证左侧 traffic lights 可点击，最小化、全屏和关闭行为正常。
4. 分别切换浅色和深色主题，确认标题栏背景随 WebUI 更新。
5. 关闭到后台后点击 Dock 图标，确认现有窗口恢复并获得焦点。

## 3. Tray 与 Dock

确认 Dock 显示 dsh 图标而非 Electron 默认图标。浅色和深色菜单栏下，Tray 图标都应为清晰的单色 template image；依次验证显示/隐藏、重新加载、打开 profile 目录和退出。

## 4. 快捷入口

在设置中分别创建桌面和 Applications 入口，确认生成 `DeepSeek Harness.app`。双击后应启动或聚焦 dsh Desktop，不应打开 Terminal。创建同名但没有 `.dsh-owner` 标记的文件后再次创建，插件应拒绝覆盖。

若使用自定义 `DSH_HOME`，从快捷应用启动后确认仍加载同一个 desktop profile。

## 5. 登录启动

开启登录启动后先检查 plist：

```bash
plutil -lint ~/Library/LaunchAgents/com.anestis271.dsh-desktop.plist
plutil -p ~/Library/LaunchAgents/com.anestis271.dsh-desktop.plist
```

注销并重新登录，确认 dsh Desktop 以隐藏窗口启动，Tray 可用，并继续使用正确的 `DSH_HOME`。关闭登录启动后再次登录，确认不再自动启动。
