# DeepSeek Harness Desktop

简体中文 | [English](./README.en.md)

[![npm version](https://img.shields.io/npm/v/%40anestis271%2Fdsh-desktop?logo=npm)](https://www.npmjs.com/package/@anestis271/dsh-desktop)
[![npm downloads](https://img.shields.io/npm/dm/%40anestis271%2Fdsh-desktop)](https://www.npmjs.com/package/@anestis271/dsh-desktop)
[![license](https://img.shields.io/badge/license-MIT-2EA44F)](./LICENSE)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555)

让 DeepSeek Harness 官方 WebUI 自然地成为一个桌面应用。

这不是另一套客户端，也不需要单独下载安装桌面程序。它只是一个轻量的 dsh 插件：保留官方 WebUI 的全部能力，在外面加上一层干净、原生的桌面外壳。

## 预览

![DeepSeek Harness Desktop 界面预览](./docs/images/desktop-preview.png)

## 为什么选择本插件

- **无需单独安装应用**：没有额外的 MSI、DMG 或 AppImage，只需安装一个 npm 插件。
- **官方 WebUI 是唯一真源**：不复制、不分叉、不重新实现界面，dsh 更新后依然保持一致。
- **足够干净**：不增加第二套业务状态、账号体系或后台服务，只负责窗口与系统集成。
- **像真正的桌面应用**：提供系统托盘、原生窗口按钮、协调一致的标题栏和可选快捷入口。
- **重复启动更快**：再次点击快捷方式时直接唤起现有窗口，不重复创建 dsh 和 WebUI 实例。

## 安装

安装前请确认：

- Node.js 版本满足 `^22.19.0` 或 `>=24.0.0`
- 已安装 pnpm，且 `pnpm --version` 可以在终端中正常执行
- dsh 已安装，且可以在终端中正常运行

然后执行：

```bash
dsh plugin --profile desktop add @anestis271/dsh-desktop
dsh --profile desktop
```

首次启动时，插件会下载并解压当前平台所需的 Electron 运行环境。下载大小和耗时取决于平台与网络状况，下载进度到达 100% 后仍可能需要等待片刻完成解压，请不要中断进程。准备完成后，后续启动会直接复用 profile 中的 Electron 缓存，启动速度会恢复正常，无需额外配置。

## 桌面体验

- 关闭窗口时可收起到系统托盘
- 托盘菜单支持显示/隐藏、刷新、打开 profile 目录和退出
- 托盘菜单跟随 dsh 的中英文设置实时切换
- 保留各平台原生的最小化、最大化和关闭按钮
- 标题栏颜色与 WebUI 侧边栏协调，形成完整的 L 形视觉
- 同一 profile 始终只保留一个窗口和一个托盘实例
- 支持 Windows、macOS 和 Linux 的用户级快捷入口

## 快捷入口

启动 dsh Desktop 后，可在官方 WebUI 的 **设置 → 通用设置** 中按需创建桌面快捷方式和应用菜单入口；登录时启动默认关闭，可在同一位置开启。

这些入口仍然只启动 `dsh --profile desktop`，不会安装另一份 Electron，也不需要管理员权限。macOS 使用系统自带的 `osacompile` 生成本地 AppleScript 快捷应用，因此从桌面或 Applications 启动时不会额外打开 Terminal。登录启动关闭后，插件只会移除由它自己创建的入口。

macOS 的首次真机验收步骤见 [`docs/MACOS_SMOKE_TEST.md`](./docs/MACOS_SMOKE_TEST.md)。

## 设计原则

`dsh-desktop` 只做桌面外壳应该做的事。会话、设置、模型、工具和所有业务界面继续由 DeepSeek Harness 官方 WebUI 提供；插件不会建立一套需要额外维护的平行客户端。

## 许可证

[MIT](./LICENSE)
