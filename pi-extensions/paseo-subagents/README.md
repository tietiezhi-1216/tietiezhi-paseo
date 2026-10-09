# 原生 Paseo 子代理

参考 `yaukwan/pi-extensions` 的 `pi-paseo-subagent` 架构：由 Paseo 创建真实子 Agent，而不是把独立 Pi 子进程伪装成 Agent。

本实现通过 Paseo CLI 的本机 home 解析器连接，保留 `PASEO_AGENT_ID` 作为父会话上下文。创建时检查父 Agent，并在返回后校验子 Agent 的 `ParentAgentId`。不依赖把 Daemon 密码写入 Pi 配置，不使用远程 `--host` 回退。

## 安装与使用

在执行任务的设备安装本仓库的 Pi 包（与 Paseo 插件安装是两个步骤）：

```sh
pi install /absolute/path/to/tietiezhi
# 或可信的 Git 源
pi install git:github.com/tietiezhi-1216/tietiezhi-paseo
```

空闲时重载 Pi 资源，或新建 Pi 会话。Paseo 插件热重载不会替运行中的 Pi 加载新工具。

新增工具 `paseo_subagent`：

- `action: "run", prompt: "任务", name: "名称"`：创建新鲜上下文的原生子 Agent；默认继承父会话 provider/model/thinking，可显式指定 `provider`。
- `action: "list"`：列出当前父会话的未归档子 Agent。
- `action: "read", agentId: "…"`：读取所属子 Agent 的最近 50 条活动。
- `action: "stop", agentId: "…"`：中断所属子 Agent，不删除或归档。

仅在用户授权委派且项目可信时执行。需要该设备的 `paseo` CLI 和运行中的 Daemon。此工具不替换 `pi-subagents` 的 `subagent` 工作流工具。

## 胶囊

Paseo 输入框旁的子代理胶囊从已认证的 SDK Agent 目录读取 `paseo.parent-agent-id`。没有原生子 Agent 时隐藏。列表只显示名称、实时状态和打开箭头；点击走原生 Agent 导航，进入真实会话流，不再在弹窗展开原始工作流输出。

原有 `pi-subagents` 独立进程仍保留在工具时间线，但不计入原生子代理胶囊；不会自动导入、重启或迁移正在运行的任务。其他设备需要分别更新 Paseo 插件、安装此 Pi 扩展，并重载其 Pi 资源。
