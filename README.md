# tietiezhi

统一整合 `model-quota`、`pi-chat`、`slotgame-agents` 的 Paseo 插件。

目前仅完成项目初始化及三个模块的静态占位，尚未迁移业务功能，未安装到 Paseo。
完整功能清单和分阶段实施计划见 [todo.md](todo.md)。

## 开发

需要 Node.js、npm 和 Paseo 0.10.2 或以上。

```sh
npm ci
npm run typecheck
```

## 结构

- `index.client.tsx`：客户端入口、仪表盘注册及清理。
- `client/`：跨平台 UI（额度查看、状态展示、Agent 展示）。
- `index.server.ts`：服务端入口，目前不注册业务 RPC。
- `server/`：未来的账号、额度、远程主机及日志处理。
- `shared/`：未来的 Zod RPC 契约、纯状态和类型。
- `paseo-plugin.json`：插件 ID 与兼容性要求。

三个模块共用一个插件 ID `tietiezhi`，内部保持模块边界。
不引入 `slotgame-release` 的 PR、发布或合作方功能。

## 安全与迁移

插件为可信、非沙箱代码。凭据、文件和网络操作只能放在服务端。
不要提交账号数据、Token、设备密码或私人配置。
未经明确授权，不安装本插件、不重启 daemon、不停用或卸载现有三个插件。
后续迁移前先确认功能和数据兼容，再逐个替换。

## 参考

- 当前功能基线：`https://github.com/tietiezhi-1216/paseo-plugins`，提交 `6638f2670dbb2886aeb3f5396f49b09754cb78c9`。
- [Paseo 插件文档](https://paseo.sh/docs/plugins.md)

迁移源码时需保留原仓库及相关文件的许可证和版权说明。
