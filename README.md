# tietiezhi

Paseo 插件：**Pi 渠道额度/账号切换 + 多 Host Agent 管理**。当前版本 `0.1.0`。

在同一个 Paseo App 中查看、搜索、打开不同设备的 Agent，并向指定 Agent 发送消息。直接借用 App 的已认证连接，支持 Paseo relay、Remote SSH、Tailscale 等运输方式，不要求设备在同一局域网。

## 当前已实现

### 渠道额度（无胶囊）

- 侧边栏底部是唯一额度入口，无 Composer 胶囊。单行紧凑排列：厂商图标 → `4 天 18 小时后重置` → `剩余 50%` → 圆形进度；取消半圆仪表和上下堆叠，不把内容分散到两端。
- 圆环 14px、2.5px 粗描边，从顶部顺时针填充；剩余 ≥50% 绿、30–49% 黄、10–29% 橙、<10% 红，未知为空环。点击左侧查看额度，点击额度仪表独立刷新。
- 窄侧栏自动收紧字距与字体，显示 `4天18小时后重置` / `剩余50%`，不隐藏字段；190px 无截断/重叠模拟回归通过。无等级、到期日期、账号名或点数。
- 可读重置时间每分钟更新（非秒表）；时间是额度窗口的重置时间，非网络轮询时间；过期显示「等待重置」，缓存仍显式标识。
- Antigravity 用 `AG G80%/1h C35%/2h` 一行分别显示双池。
- 直接从 GitHub 克隆 `tietiezhi-1216/paseo-plugins`（`6638f26`）参考，不安装旧插件或改动凭据。
- 查询 Codex、xAI、Antigravity 的真实额度；Gemini 与 Claude/GPT-OSS 不跨额度池回退。缺失比例显示「未获取」，不伪造 0%。
- 面板查看各保存账号额度，并复用确认/备份/切回流程切换该 Host 的渠道默认账号。
- 每 60 秒更新；手动刷新最短间隔 5 秒。失败保留带时间戳的缓存，Host 离线禁用查询与切换；不回退本机。
- **明确边界**：当前 Sidebar API 不直接提供选中会话/模型。按用户要求移除胶囊及其上下文桥接后，不能自动跟随当前 Pi 模型。底部明确显示面板所选渠道的**默认账号**额度，初始为 Codex；渠道选择只改变显示，不修改模型或授权。不从最近活跃 Agent 猜测模型。
- Antigravity 底部分别显示 Gemini/Claude 两池，不假设当前模型或跨池合并。后端保留显式独立路由查询支持；当前简洁 UI 不自动选择独立模型路由。
- 额度依据该 Host 存储的 Pi 授权，不保证等于已有会话缓存或环境变量覆盖的授权。切换仅改变渠道默认账号，不改写独立模型路由，不自动重载/中断会话。
- 远端查询/切换需要该 Host 安装此插件；认证与跨公网连接仍由 Paseo App 管理。

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
- 查询/切换不刷新 OAuth；登录只在用户点击「开始登录」后发起。不会执行 API Key 命令，Token/Refresh Token/API Key 不返回客户端或写入日志。

**影响范围**：使用该授权目录和默认槽位的 Pi 会话。环境变量 API Key、项目独立授权或单会话独立目录可能覆盖默认授权。不会自动重载 Agent 或中断任务；新会话使用新默认账号，现有会话何时重读凭据由 Pi/provider 版本决定。

**暂不包含**：Antigravity 面板登录、手动添加 API Key、删除账号、自动续期或原生 `registerUsageSource` 适配。已过期令牌需要由 Pi 续期/重新登录，不保证旧备份仍能授权。

### Agent 展示与通信

- 使用 `useHosts()` 发现 App 的已配置 Host，包括离线设备。
- 使用 `getPaseoClient(serverId)` 通过已认证连接完整分页读取活跃 Agent。
- 显示 Host、工作区、名称、模型、活动时间，分为失败、等待授权、工作中、完成和空闲。
- 搜索、按 Host 筛选、显示/隐藏子 Agent；归档和已关闭 Agent 不显示。
- 点击打开准确的 Host / Agent 会话，复制组合 ID。
- 对选定 Agent 输入并确认发送消息。使用稳定消息 ID 和显式 `steer`，不采用 SDK 默认的中断当前 turn 行为；目标 provider 必须支持。
- 页面每 5 秒刷新；离线/失败保留上次结果并标注非实时，禁止发送/导航，不回退本机。页面关闭后停止轮询，短期缓存自动回收。

**边界**：这是 **App → 多 daemon**，不是无人值守的 daemon → daemon 中转或自主 Agent 编排。远端需要先配对、认证且连接在线。插件不会创建独立网络监听、保存配对密钥、自动开放端口或绕过权限。

### 展示入口

- 侧边栏顶部的 **tietiezhi** → 仪表盘（Agents / 账号切换 / Host 连接）。
- 侧边栏 **对话 Log · 进度示例**（设置页名称仍为「对话 Log 示例」）→ 直接显示进度条。右侧 **▶** 开始本地模拟，每秒前进 5%，20 秒到 100%；运行时可暂停、继续，完成后可重播。侧边栏可见文字 `SidebarRow.label` 和弹窗 `Modal.title` 同步变化，无需重载或重新注册条目。
- 点击该条目打开 Paseo 原生 `Modal`，不切换页面、不新增胶囊。宽屏为 Dialog，窄屏为底部抽屉；弹窗内可重置进度、搜索、筛选消息/工具、追加模拟记录和复制。关闭弹窗不停止进度；暂停、完成、切换 Host、隐藏条目或卸载时清理定时器。模拟不持久化、不读取真实日志或执行任务；真实任务进度尚未接入。
- 侧边栏底部 **模型额度** → 注册 ID 保持 `footer-demo`，保留排序/显示配置。位于「添加项目」下方、系统图标栏上方；显示所选渠道默认账号额度及缓存提示，点击额度仪表刷新，点击打开简洁额度/账号 Modal。渠道变化取消旧确认；Host 变化关闭旧弹窗。顶部模拟进度示例保留。
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

## 开发与验证

- `npm run typecheck`：针对已固定的新版 SDK 检查。
- `npm test`：全部使用临时目录/模拟 SDK，不切换真实账号，不发送真实消息。
- `npm run test:ui`：Chromium 界面回归，默认使用 macOS Google Chrome；可设置 `CHROME_PATH`，或执行 `npx playwright install chromium`。虚拟时钟验证进度条/动态标题同步、暂停/继续/重置/重播、关闭后继续更新、Host 切换时清理定时器。浏览器加载真实客户端入口的注册逻辑、模拟宿主与 RPC，验证零 Composer 胶囊、顶部/底部注册和位置、单卡账号/额度布局、手动渠道同步、确认切换/切回、渠道变化/延迟返回隔离、离线缓存与卸载清理。
- `.artifacts/ui/`：模拟数据的宽屏深色、窄屏浅色截图（不提交）。Dialog 截图使用测试专用的模拟宿主外壳，真实外观以 Paseo App 提供的 Modal 为准。

当前验证：33 个单元测试与浏览器模拟集成通过；已从本地源码安装到本机 Paseo，状态 `running`、客户端 bundle 已提供。实际 daemon 账号列表只读返回 12 个账号；Codex/xAI 默认账号额度查询成功；Antigravity 曾查询成功，最新查询返回授权失效，已正确标为缓存（须由 Pi 续期）。Go 已保存账号但没有匹配的默认授权槽位。本机活跃 Pi 模型路由可解析；只读验证前后授权文件未变。**不等同于已在 Paseo App 或两个真实跨公网 Host 上完成完整验收**；实际页面、导航和远端消息交互仍需确认，没有自动切换真实账号或发送消息。

## 结构

- `client/`：界面、Host 查询和操作。没有 DOM 注入、Node 导入或自建 socket。
- `server/`：Host 本地授权读取、额度查询/缓存、备份、切换。
- `shared/`：Zod RPC 契约、状态分类和纯函数。
- `tests/`：隔离文件测试、Host 路由测试、模拟浏览器 UI。

完整计划见 [todo.md](todo.md)。旧插件功能基线来自 [paseo-plugins](https://github.com/tietiezhi-1216/paseo-plugins)，提交 `6638f2670dbb2886aeb3f5396f49b09754cb78c9`。不引入 `slotgame-release` 功能。

参考：[插件文档](https://paseo.sh/docs/plugins/reference.md) · [SDK](https://paseo.sh/docs/sdk/reference.md) · [连接方式](https://paseo.sh/docs/connectivity.md)

## License

MIT，见 [LICENSE](LICENSE) 及 [第三方声明](THIRD_PARTY_NOTICES.md)。
