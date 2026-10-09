# tietiezhi

Paseo 统一插件：**模型额度与账号切换 · 活跃任务状态气泡 · 多 Host Agent 仪表盘**。当前版本 `0.1.0`。

跨设备在桌面端（macOS/Windows/Linux）与移动端（iOS/Android）使用同一个插件，集成模型配额实时监控、多账号安全切换、输入框任务微徽标与轻量浮窗管理。

## 一键安装命令

在任意已安装 Paseo 的设备终端中直接运行：

```bash
paseo plugin install https://github.com/tietiezhi-1216/tietiezhi-paseo.git
```

重载与更新：
```bash
paseo plugin reload tietiezhi
# 或在线更新
paseo plugin update tietiezhi
```

## 当前已实现

### 渠道额度（无胶囊）

- 侧边栏底部是额度入口：厂商图标、官方重置倒计时、剩余百分比和圆环。点击卡片任意位置打开 Host 额度面板，没有手动刷新按钮或额度 Composer 胶囊。
- 后端启动后约三秒预热，此后每五分钟查询 Codex、Antigravity、Grok 的全部保存账号，不依赖面板是否打开。慢轮询不重叠，某渠道失败不会阻止其他渠道；插件卸载时清理计时器和请求。
- 打开面板会重新查询。客户端也每五分钟读取所选渠道；已知官方重置时间到达时额外查询一次，不等待下一次周期。
- 只展示接口确实提供的比例与重置时间，不把旧日期自动增加五小时或七天，也不因到了重置时间就猜成剩余 100%。
- Grok billing REST 缺失比例时，以同一 Bearer 令牌只读查询补充 gRPC 账单。仅完整成功、已知周/月类型、当前活动周期且与 REST 周期一致的 protobuf 响应，可按其隐式标量默认值解析零用量，并记录 `usageSource: protobuf-default`。仅 REST 缺字段、零余额或日期到点不推断 100%；两个接口都不可计算时显示「额度未提供」。
- 查询失败时隐藏旧百分比，显示查询状态和上次成功获取时间；缓存明确标识，过期窗口不再展示。额度查询授权异常不等于聊天授权不可用。
- 成功数据持久化到该 Host 的账号归档，失败不会改写成功时间。浏览器缓存按 Host + 账号隔离；没有 Host 身份的旧缓存不迁移。
- Antigravity 保留 Gemini 与 Claude/GPT-OSS 独立额度池；不会用另一池的额度填补缺失结果。会员到期时间与额度窗口重置时间独立。
- 桌面 Web 侧按可见的模型选择器识别渠道/额度池；无法识别时回到 Codex 默认显示。额度对应该 Host 的 Pi 默认授权，不保证等于项目独立路由、环境变量授权或已有会话缓存的身份。
- 查询会在令牌即将过期或 HTTP 401 时尝试 OAuth 续期。即使后续额度请求失败，也保存已轮换的 Refresh Token；凭据不发送到客户端。
- 网络请求与代理使用同一个 undici 包，避免与 Paseo 原生 fetch 的版本混用。代理优先使用插件进程环境，其次读取 daemon 的 Pi provider 环境配置；保留旧本地代理端口兼容，连接失败可尝试直连。
- 远端查询/切换需要在该 Host 安装插件；认证与跨公网连接由 Paseo App 管理。本机验证不等于远端验证。

### 界面

- 统一紧凑卡片、下划线标签与图标操作；去掉常驻说明段落。
- Agent ID/活动时间、主机 ID/连接帮助均按需展开；消息发送与账号切换仍需确认。
- 只用官方宿主组件；宽屏 Dialog、窄屏底部 sheet。截图与浏览器测试是模拟宿主，不等于真实 App 验收。

### 账号切换

- 提供 Codex、Grok/xAI、Antigravity 三类账号入口。OpenCode Go 已从界面、图标、路由解析和查询适配移除；旧凭据仅保留读取兼容，不再查询/切换，不删除授权。
- 只读合并 Pi `auth.json`、旧 `model-quota.json`、历史 `ttz.json`，按账号身份去重。
- 额度 Dialog 仅保留账号名、默认/切换状态、各额度窗口的剩余比例及重置时间；删除提示/详情折叠项、刷新按钮、会员到期、授权期限和技术诊断。参考旧插件的账号标题+套餐徽标+额度圆环布局，Antigravity 按明确的 Gemini / Claude + GPT 池分组，不猜当前会话、不混池。离线、缓存和查询失败仍可见。
- 内容区最大宽度 440px，四边 padding 16px；账号卡铺满内容区。高度按账号量/视口有界计算，只有账号列表滚动。Tab 13px / 图标 16px，固定 Tab 与登录操作区，不随账号滚动。外框宽度、Title/关闭按钮样式由 Paseo 官方 Modal 控制，不注入 DOM 或修改宿主样式。
- 顶部「登录」提供 Codex / Grok 官方设备码授权：打开验证页、复制链接、等待完成与取消；关闭、切换渠道/Host 时清理会话，离线禁用。凭据只保存到目标 Host 的私有归档，不自动切换默认账号；随后通过原有确认流程切换。
- Antigravity 尚未接入面板登录，入口明确提示在目标 Host 的 Pi 中使用 `/login`，不伪装已实现网页登录。
- 切换前确认 **目标 Host + 平台 + 账号**。账号列表发生变化时，旧确认会被拒绝。
- 切换只改目标 Host 的相应 Pi 默认 provider 槽位，保留其他 provider、命名槽位和未知授权字段。
- 使用与 Pi 兼容的文件锁、原子写入、`0600` 权限和私有备份；归档原始账号，支持切回。
- 查询按需刷新 OAuth；交互登录只在用户主动操作时发起。不会执行 API Key 命令，Token/Refresh Token/API Key 不返回客户端或写入日志。

**影响范围**：使用该授权目录和默认槽位的 Pi 会话。环境变量 API Key、项目独立授权或单会话独立目录可能覆盖默认授权。不会自动重载 Agent 或中断任务；新会话使用新默认账号，现有会话何时重读凭据由 Pi/provider 版本决定。

**暂不包含**：Antigravity 面板登录、手动添加 API Key、删除账号或原生 `registerUsageSource` 适配。查询会尝试续期；Refresh Token 失效时仍需重新登录，不保证旧备份仍能授权。

### Agent 展示与通信

- 使用 `useHosts()` 发现 App 的已配置 Host，包括离线设备。
- 使用 `getPaseoClient(serverId)` 通过已认证连接完整分页读取活跃 Agent。
- 显示 Host、工作区、名称、模型、活动时间，分为失败、等待授权、工作中、完成和空闲。
- 搜索、按 Host 筛选、显示/隐藏子 Agent；归档和已关闭 Agent 不显示。
- 点击打开准确的 Host / Agent 会话，复制组合 ID。
- 对选定 Agent 输入并确认发送消息。使用稳定消息 ID 和显式 `steer`，不采用 SDK 默认的中断当前 turn 行为；目标 provider 必须支持。
- 页面每 5 秒刷新；离线/失败保留上次结果并标注非实时，禁止发送/导航，不回退本机。页面关闭后停止轮询，短期缓存自动回收。

**边界**：这是 **App → 多 daemon**，不是无人值守的 daemon → daemon 中转或自主 Agent 编排。远端需要先配对、认证且连接在线。插件不会创建独立网络监听、保存配对密钥、自动开放端口或绕过权限。

### Agents 胶囊

- 胶囊文字、状态圆点和弹窗共用按 Host 隔离的实时目录；数量按 Host + Agent ID 去重，已连接 Host 的实时数据优先于配置缓存。
- 显示格式「当前 Agent 名 · 状态 · 数量」，名称过长会缩短且改名实时同步；当前会话名也保留在弹窗底部。汇总状态优先级 `done → error → working → idle → closed`，搜索仅过滤列表，不改变全局汇总数量。
- 使用独立 owned subscription，避免其他筛选视图的 remove 事件误归档 Agent。列表分页完整读取，晚返回的列表不能覆盖更新的完成/归档事件；最后一个读取者离开时释放订阅和计时器。
- `npm run test:ui` 包含实际胶囊注册、图标及弹窗渲染的跨 Host 模拟回归（不是实际远端 Host 验收）。

### 展示入口

- 侧边栏顶部的 **tietiezhi** → 仪表盘（Agents / 账号切换 / Host 连接）。
- 侧边栏 **对话 Log · 进度示例**（设置页名称仍为「对话 Log 示例」）→ 直接显示进度条。右侧 **▶** 开始本地模拟，每秒前进 5%，20 秒到 100%；运行时可暂停、继续，完成后可重播。侧边栏可见文字 `SidebarRow.label` 和弹窗 `Modal.title` 同步变化，无需重载或重新注册条目。
- 点击该条目打开 Paseo 原生 `Modal`，不切换页面、不新增胶囊。宽屏为 Dialog，窄屏为底部抽屉；弹窗内可重置进度、搜索、筛选消息/工具、追加模拟记录和复制。关闭弹窗不停止进度；暂停、完成、切换 Host、隐藏条目或卸载时清理定时器。模拟不持久化、不读取真实日志或执行任务；真实任务进度尚未接入。
- 侧边栏底部 **模型额度** → 注册 ID 保持 `footer-demo`，保留排序/显示配置。位于「添加项目」下方、系统图标栏上方；显示所选渠道默认账号额度及缓存提示，点击卡片或额度仪表打开简洁额度/账号 Modal，并自动重新查询。渠道变化取消旧确认；Host 变化关闭旧弹窗。顶部模拟进度示例保留。
- Command Center：**打开 tietiezhi 仪表盘**。
- Agent 工作区/Explorer 面板：**tietiezhi**。
- `/tietiezhi [agents|accounts|hosts]`。
- **Settings → Plugins → tietiezhi → 账号切换**。

Pi 计划、待办、后台任务尚未完整迁移；后续 UI 不采用 Composer 胶囊，见 [todo.md](todo.md)。

## 版本与安装

需要 **Paseo daemon 和 App 均为 `0.11.0-beta.4` 或以上兼容版本**；开发测试需要 Node.js 24+、npm。

插件为可信、非沙箱代码。后端可读取和修改本机授权文件。仅在信任代码后安装。

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:ui

# 经确认后安装本地源目录，不需要重启 daemon：
paseo plugin install /absolute/path/to/tietiezhi --id tietiezhi
paseo plugin ls
```

公共 Git 仓库安装（先确认这些实现已推送到远端）：

```sh
paseo plugin install git:github.com/tietiezhi-1216/tietiezhi-paseo --id tietiezhi
```

Git 安装的准备步骤只安装生产依赖，并禁止 npm 安装脚本。源代码变更用 `paseo plugin reload tietiezhi`，不要为插件重启 daemon。

## 跨公网接入

1. 在每台远程设备运行 Paseo daemon。
2. 远程 Host 设置中打开 **Pair a device → Enable relay**，生成配对链接/二维码。
3. 在当前 App 通过 **Add host** 加入该设备，确认状态在线。
4. 打开本插件的 Agents 页面，自动汇总并操作远端 Agent。

查看/打开/发消息不要求远端安装插件。**切换远端账号**需要在该 Host 安装 `tietiezhi`，然后在仪表盘顶部使用 Paseo 提供的 Host 切换器。账号 RPC 始终在所选插件安装主机执行，不从本机转发凭据。

Relay 为端到端加密，不需要公网开放 daemon 端口。桌面也可使用 **Remote SSH**；已配置 Tailscale 时可使用直连。连接建立、认证、重连及传输切换由 Paseo App 负责。

## 数据与备份

- `${PASEO_HOME:-~/.paseo}/tietiezhi/accounts.json`：首次切换时创建的私有账号归档，**含授权凭据，不能提交 Git**。
- `${PASEO_HOME:-~/.paseo}/tietiezhi/backups/`：授权/归档备份，目录 `0700`、文件 `0600`，每种保留最近 10 个。
- 原 `model-quota.json` / `ttz.json` 仅读取，不修改、不删除。
- Pi 目录优先级：`TIETIEZHI_PI_AGENT_DIR` → daemon 的 `agents.providers.pi.env.PI_CODING_AGENT_DIR` → 插件进程 `PI_CODING_AGENT_DIR` → `~/.pi/agent`。支持 `~/`，拒绝歧义相对路径。

不要在 Pi 正在续期时手动覆盖授权文件。需要回滚时先确保没有授权写入者，再在目标主机检查私有备份并恢复，保留 `0600` 权限。备份不是凭据刷新服务，已失效的 Refresh Token 不能靠回滚复活。

## 首 token 时间采集

- Pi 扩展源码在 [`pi-extensions/turn-timing/`](pi-extensions/turn-timing/README.md)，与 Paseo 插件同仓库，不复制到全局扩展目录。
- 本机全局安装：`pi install /absolute/path/to/tietiezhi`。仓库的 `pi.extensions` 只声明采集扩展；Pi 全局配置引用本地源码，不复制文件，各项目都能加载，不依赖各项目的信任设置。远端主机需独立安装。
- 新 Pi 会话加载后开始采集；已运行的 Pi 会话需在空闲时重载资源。`paseo plugin reload` 只重载展示/读取端，不重载 Pi，不要因此重启 daemon 或中断正在执行的任务。
- 用单调时钟记录 provider request 到首个非空正文/思考/工具参数增量的耗时；仅保存计时及响应标识，不保存 prompt、输出或凭据，也不进入模型上下文。
- 页脚只匹配整轮第一次模型响应的数据，不取后续调用均值。旧记录、缺失采集、错误/中断或重复/不匹配元数据仍显示 `ttft —`。自定义 provider 没有转发请求 hook 时无法采集，不用总耗时代替。

## 开发与验证

- `npm run typecheck`：针对已固定的新版 SDK 检查。
- `npm test`：全部使用临时目录/模拟 SDK，不切换真实账号，不发送真实消息。
- `npm run test:ui`：Chromium 界面回归，默认使用 macOS Google Chrome；可设置 `CHROME_PATH`，或执行 `npx playwright install chromium`。虚拟时钟验证进度条/动态标题同步、暂停/继续/重置/重播、关闭后继续更新、Host 切换时清理定时器。浏览器加载真实客户端入口的注册逻辑、模拟宿主与 RPC，验证无额度 Composer 胶囊、Agents 胶囊与列表状态/数量一致、顶部/底部注册和位置、单卡账号/额度布局、手动渠道同步、确认切换/切回、渠道变化/延迟返回隔离、离线缓存与卸载清理。
- `.artifacts/ui/`：模拟数据的宽屏深色、窄屏浅色截图（不提交）。Dialog 截图使用测试专用的模拟宿主外壳，真实外观以 Paseo App 提供的 Modal 为准。

额度修复验证：类型检查、额度/代理/轮询/Host 缓存测试及桌面深色、移动浅色浏览器模拟回归通过。本机已通过实际插件 RPC 重新获取 Codex、Antigravity 数据；Grok 对缺失比例采用经验证的补充账单响应，不沿用上一周期百分比。远端 Host 的安装版本、网络及具体账号仍须独立验证，不能由本机测试推断。\n
## 结构

- `client/`：界面、Host 查询和操作。没有 DOM 注入、Node 导入或自建 socket。
- `server/`：Host 本地授权读取、额度查询/缓存、备份、切换。
- `shared/`：Zod RPC 契约、状态分类和纯函数。
- `tests/`：隔离文件测试、Host 路由测试、模拟浏览器 UI。

完整计划见 [todo.md](todo.md)。旧插件功能基线来自 [paseo-plugins](https://github.com/tietiezhi-1216/paseo-plugins)，提交 `6638f2670dbb2886aeb3f5396f49b09754cb78c9`。不引入 `slotgame-release` 功能。

参考：[插件文档](https://paseo.sh/docs/plugins/reference.md) · [SDK](https://paseo.sh/docs/sdk/reference.md) · [连接方式](https://paseo.sh/docs/connectivity.md)

## License

MIT，见 [LICENSE](LICENSE) 及 [第三方声明](THIRD_PARTY_NOTICES.md)。
