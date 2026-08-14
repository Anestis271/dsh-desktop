# dsh Desktop 插件方案

本文档描述 `@anestis/dsh-desktop` 的设计与实施方案。

## 1. 目标与边界

本插件为 dsh 提供跨平台桌面客户端外壳。dsh 官方 WebUI 是唯一真源；插件不复制、不分叉也不重新实现任何业务 UI，只负责桌面窗口、系统托盘、生命周期、平台集成和可选快捷入口。

目标安装与启动方式：

```bash
dsh plugin --profile desktop add @anestis/dsh-desktop
dsh --profile desktop
```

设计原则：

- 完全服从 dsh 的插件 manifest、入口、生命周期、配置和日志规范。
- 插件以独立 npm 包发布，不要求用户安装第二个服务或维护第二套配置。
- 单一桌面主进程、事件驱动、无常驻轮询、无重复业务状态。
- 不修改 dsh WebUI 的源码和发行产物；所有集成通过 dsh 正式暴露的插件接口完成。
- 平台能力逐项降级，某项桌面集成失败不得影响 dsh 与 WebUI 的正常使用。

## 2. 前置规范核对

实施前应以当前目标版本的 dsh 仓库为准，确认并记录以下正式契约：

1. npm 插件的包字段、manifest 位置、插件 ID 和版本兼容声明。
2. profile 启动时的插件激活钩子、停用钩子及上下文对象。
3. WebUI 的启动/就绪事件、监听地址、鉴权信息和允许加载的 origin。
4. 设置 schema、默认值、作用域、迁移和变更监听 API。
5. profile 数据目录、日志 API、资源解析和插件卸载钩子。

若 dsh 没有正式提供某项能力，应先向 dsh 增加最小的通用插件 API，而不是在插件内读取内部文件、解析控制台文本或依赖未公开实现。

## 3. 推荐技术路线

采用 **Electron 轻量壳层 + dsh 官方 WebUI URL**。Electron 提供稳定的跨平台窗口、托盘、原生菜单、快捷方式和标题栏覆盖能力。插件不引入 React、Vue、路由、状态管理或第二个 HTTP 服务。

这里采用“dsh 宿主 + Electron 子进程”拓扑：`dsh --profile desktop` 继续由 dsh 的 Node 启动器运行，插件在 profile 生命周期内启动一个 Electron runtime 子进程；Electron 子进程只负责桌面窗口和托盘，父子进程通过一次性启动参数和受控本地 IPC 协调生命周期。这样不会把 Electron API 错误地当作普通 Node 模块嵌入 dsh，也不会改变 dsh 的 WebUI 服务模型。

进程职责：

- dsh 插件入口（宿主进程）：接收 profile 上下文，解析插件设置，启动/停止 Electron 子进程，并在 dsh deactivate/退出时等待其结束。
- Electron main（子进程）：管理 `BrowserWindow`、`Tray`、原生菜单、窗口状态和平台集成。
- preload：仅负责标题栏拖拽区域和主题同步，不暴露业务 UI 控制通道。
- renderer：直接加载 dsh 提供的 WebUI，不打包 WebUI 副本，不承载业务状态。

优先使用 dsh 提供的 WebUI 就绪事件。若接口只能提供状态查询，启动阶段可使用有超时和退避的一次性等待，成功或失败后立即释放计时器，禁止在运行期间持续轮询。

启动时序应明确为：dsh profile 先启动官方 WebUI 服务，desktop 宿主收到包含 URL、origin 和生命周期句柄的正式就绪事件后，再启动 Electron 子进程；子进程加载 URL 并回报窗口就绪，宿主随后完成插件激活。WebUI 尚未就绪时不应猜测端口或启动第二个服务器。dsh 停止或 profile 被卸载时，宿主先通知子进程关闭，再在有限超时后终止残留进程。

## 4. npm 包与插件结构

建议结构如下，最终名称以 dsh 官方规范要求为准：

```text
@anestis/dsh-desktop/
  dist/
    index.js              # dsh 插件入口
    main.js               # Electron main process
    preload.js            # 最小桥接层
    shortcuts.js          # 平台快捷入口适配
  assets/
    tray/                 # 各平台托盘资源
  settings-schema.json
  package.json
  README.md
  LICENSE
```

`package.json` 应包含 dsh 要求的插件声明、明确的 `engines`、兼容 dsh 版本范围和导出入口。dsh 插件 API 应作为 peer dependency；不得将 dsh 服务端或 WebUI 重复打包。构建输出使用 ESM 或 dsh 当前统一的模块制式，发布包仅包含运行必需文件。

dsh 仓库内部包遵循 `@deepseek-ai/dsh-*` 命名和 workspace 约束；本项目作为树外插件，按用户指定发布为 `@anestis/dsh-desktop`，不应为了套用内部包名而修改 dsh 的 monorepo。

包必须声明 dsh 可识别的 profile bundle patch，例如 `dsh.bundle.patch: "./cordis.patch.yml"`，并在发布包的 `files` 中包含该 patch。`dsh plugin --profile desktop add @anestis/dsh-desktop` 会在 profile 目录中转发为 pnpm 安装；安装成功后 dsh 根据已安装依赖重新扫描 `dsh.bundle.patch`，自动把该包加入 `dsh.profile.bundles`。插件不能依赖“命令行 add 的参数顺序”来激活，也不能要求用户手工编辑 profile manifest。

该命令的前置条件是 dsh 当前版本可用的 pnpm 运行时；若 dsh 发行版不自带 pnpm，README、安装检查和验收脚本必须明确提示用户安装匹配版本。插件本身不应偷偷下载或替换 pnpm，也不应把 profile 的 `node_modules` 提升到用户全局目录。

bundle patch 应只增加桌面所需的宿主插件行，并显式依赖/复用 dsh 的 web-app bundle 或等价的官方 WebUI 组合；不能在 patch 中复制 WebUI 的插件清单。普通运行依赖放在 npm `dependencies`，profile 层激活声明放在 `dsh.bundle.patch`，两者职责分离。

推荐将 `@deepseek-ai/dsh-web-app` 作为该包的运行依赖而非复制其 patch。这样安装 desktop 包时，dsh 的依赖扫描会同时发现官方 Web bundle 和 desktop bundle；profile 的最终顺序应为 `dsh-base`、`dsh-web-app`、`@anestis/dsh-desktop`，并由 dsh 的 bundle 解析结果验证，而不是由插件自行重排。

### Electron runtime 的分发

Electron 是独立的子进程 runtime，不应由 dsh 的 Node 进程隐式加载。将版本固定在插件的运行依赖中，并让 npm/pnpm 在安装阶段完成平台 runtime 准备；启动时只解析已安装的绝对可执行文件，不在线下载、不在首次启动编译。若 Electron 的安装脚本需要 pnpm `allowBuilds` 或网络权限，应在 README 和 CI 中明确列出，安装失败时由 dsh 原样报告而不是静默退化为浏览器。

实现应提供一个 runtime 适配接口，以便 dsh 将来提供共享 WebView/Electron runtime 时替换包内 runtime；当前默认实现仍需保证单次 `dsh plugin ... add` 后即可启动。Electron 的固定内存成本应在兼容矩阵中记录；“无性能损失”指不增加 WebUI 的第二次渲染、状态同步和服务端请求，不把 Electron 的基础 runtime 成本误称为零。

## 5. WebUI 加载与安全边界

窗口只加载插件上下文提供的 dsh WebUI URL。推荐窗口安全配置：

```js
{
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true
  }
}
```

同时落实以下约束：

- 使用 URL 对象校验 scheme、host 和 port，只允许 dsh 明确提供的 origin。
- 拦截未知导航、下载和 `window.open`；外部链接由用户确认后交给系统浏览器。
- IPC 通道固定定义、逐项校验参数，不向 renderer 暴露 `ipcRenderer`、文件系统或任意命令执行能力。
- 鉴权信息仅通过 dsh 官方机制传递，不写入页面 URL、日志或快捷方式。
- WebUI 加载失败时显示最小的原生错误状态和重试动作，不提供另一套离线 UI。

## 6. 窗口与标题栏

标题栏采用部分重绘，保留各平台原生最小化、最大化和关闭按钮：

- macOS：优先使用 `titleBarStyle: "hiddenInset"`，保留左侧 traffic lights。
- Windows：使用 `titleBarOverlay`，保留右侧原生 caption buttons。
- Linux：在窗口管理器支持时使用标题栏覆盖；不支持时退化为原生标题栏，不模拟窗口控制按钮。

标题栏背景色必须和 WebUI 侧边栏保持一致。颜色应通过 dsh/WebUI 正式主题接口获取；若该接口尚不存在，建议 dsh 暴露只读主题 token（例如 sidebar background 和 foreground），而不是由插件扫描 DOM 或硬编码颜色。主题变化后由 WebUI 通过受控通道单向通知 main 更新 overlay 颜色。

这会使标题栏横向区域与左侧侧边栏形成连续的 L 形视觉结构。36 px 高的拖拽区避开各平台原生窗口按钮，不覆盖 WebUI 的业务交互，也不新增侧边栏管理按钮。

窗口位置、尺寸、最大化/全屏状态按 profile 保存。写入采用退出或节流后的单次持久化；恢复时校验当前显示器工作区，避免显示器变化后窗口不可见。

## 7. 系统托盘

主进程只创建一个 Tray 实例。图标提供 Windows ICO、macOS template image 和 Linux PNG 资源，尺寸遵循各平台规范。

托盘菜单至少包含：

- 显示/隐藏 dsh
- 重新加载 WebUI
- 打开当前 profile 目录
- 退出

关闭主窗口默认隐藏到托盘；只有托盘“退出”、dsh 主进程终止或明确的退出信号才真正释放应用。单击/双击托盘图标的行为遵循平台惯例；恢复窗口时执行 `show()`、必要时恢复最小化状态并 `focus()`。退出流程必须幂等，统一销毁 Tray、窗口和 IPC listener。

## 8. 可选的类 APP 体验

默认不创建快捷方式、不注册文件关联、不安装系统级服务，从而避免签名、公证、管理员权限和安装器维护成本。插件在 dsh 设置中增加以下逻辑配置，具体 schema 语法以 dsh 规范为准：

```json
{
  "desktop": {
    "shortcuts": {
      "desktop": false,
      "appMenu": false,
      "login": false
    }
  }
}
```

`desktop` 是插件设置命名空间，`shortcuts` 是其嵌套配置对象；具体 schema 类型、设置 UI 展示和迁移规则必须由 dsh 的设置 API 注册，不能把这些字段写入 profile patch。所有选项默认 `false`。启用任何入口后，该入口唯一执行：

```bash
dsh --profile desktop
```

实际生成时使用当前 dsh 可执行文件的绝对路径，将 `--profile` 和 `desktop` 作为独立参数安全编码，不经过 shell 拼接。快捷入口不直接启动 Electron、不包含 token，也不绕过 dsh 的 profile 与插件生命周期。

平台实现：

- Windows：用户级桌面/开始菜单 `.lnk`；不写系统级目录。
- Linux：用户级 freedesktop `.desktop` 文件，正确转义 `Exec` 并按需设置 executable bit。
- macOS：用户级、无需重新签名的快捷入口或 alias；不伪造已签名 `.app` bundle。
- 登录启动：仅在用户显式开启时，通过平台推荐的用户级机制调用同一 dsh 命令。

设置变化触发一次性 reconcile。插件为创建的入口写入稳定标识和版本信息；关闭设置或卸载时只删除由本插件创建且标识匹配的入口，不删除用户自行创建的同名文件。失败应记录到 dsh 日志并在设置 UI 返回可操作错误，不阻止主窗口启动。

快捷入口和重复启动必须共享单实例策略：同一 `desktop` profile 已有窗口时，新的 `dsh --profile desktop` 只向现有 Electron 子进程发送 focus/show 请求，然后宿主正常退出或复用已有宿主，不创建第二个托盘和第二个 WebUI 会话。单实例锁应位于 profile 作用域并使用平台原子机制，异常退出后可恢复。

## 9. 性能与可靠性

- 不引入重复的前端框架、Web 服务器、数据库或状态同步层。
- 除 Electron 必需进程外不创建常驻 worker；禁用未使用的 Electron 能力。
- 所有生命周期、Tray、窗口和设置变更均事件驱动。
- WebUI 就绪等待有明确超时，成功后取消所有 timer。
- profile 配置写入合并并节流，避免 resize/move 事件频繁落盘。
- 处理 SIGINT、SIGTERM、dsh deactivate、托盘退出和异常关闭，清理逻辑可重复调用。
- renderer 崩溃或 WebUI 断开时允许显式重载，不静默创建无限重试循环。

需注意：Electron 本身不是体积最小的桌面运行时，但在原生标题栏覆盖、跨平台 Tray、npm 独立分发和统一行为之间风险最低。若 dsh 已内置并正式暴露可复用的 Chromium/Electron runtime，应复用宿主 runtime，避免包内重复携带二进制；否则应将 runtime 获取方式设计为符合 dsh 插件安装规范的可选/平台依赖，并在实现前验证两条目标命令能完成完整安装。

## 10. 测试与发布

CI 至少覆盖 Windows、macOS、主流 Linux：

1. 在干净环境执行插件安装命令。
2. 执行 `dsh --profile desktop` 并等待 WebUI 可交互。
3. 验证安装包声明 `dsh.bundle.patch`，profile manifest 自动包含正确的 bundle 顺序，且不需要手工编辑配置。
4. 验证 UI 来源为 dsh 官方 WebUI，且插件包不包含其副本。
5. 验证 Tray 显示、隐藏、恢复、重载和退出。
6. 验证原生窗口按钮仍由平台提供且行为正确。
7. 验证主题切换后标题栏和侧边栏颜色一致。
8. 验证标题栏拖拽区可移动窗口且不遮挡原生窗口按钮。
9. 验证快捷方式默认无副作用，开启后命令精确指向 `dsh --profile desktop`，关闭/卸载后安全清理。
10. 验证重复启动只产生一个窗口和 Tray。
11. 验证多显示器恢复、renderer crash、WebUI 不可达和 dsh 退出场景。

发布使用锁文件、最小 files 白名单、npm provenance、变更日志和 dsh/Electron/Node 兼容矩阵。发布前检查生产依赖许可证与安全公告。

## 11. 实施阶段

1. 对照目标 dsh 版本完成插件 API 合规表，不使用任何未公开内部接口。
2. 建立独立 npm 包、manifest、设置 schema 和最小生命周期入口。
3. 接入官方 WebUI 地址与就绪事件，完成安全 BrowserWindow/preload。
4. 实现 Tray、窗口状态持久化和统一退出流程。
5. 实现三平台标题栏策略、拖拽区域和主题 token 同步。
6. 实现默认关闭、幂等且可撤销的快捷入口 reconcile。
7. 完成三平台端到端测试、安装/卸载测试和 npm 发布验证。

## 12. 验收标准

- 两条目标命令能在支持的平台完成安装与启动，无额外手工步骤。
- 所有业务 UI 和状态来自 dsh 官方 WebUI，插件不存在 WebUI 分叉或副本。
- 托盘可显示/隐藏/恢复窗口并可靠退出。
- 标题栏与侧边栏颜色一致，原生最小化/最大化/关闭按钮完整保留。
- 标题栏拖拽区域可用，且不会遮挡原生窗口按钮或 WebUI 业务控件。
- 默认不创建快捷入口；用户开启后，所有入口只执行 `dsh --profile desktop`，关闭或卸载可安全撤销。
- 无运行期轮询、无多余常驻服务、无未校验 IPC、无 profile 之间的配置串用。
