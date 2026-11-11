# dsh-sidebar-triptych

把 DeepSeek Harness 的左侧栏切成三段，每段一根可点的折叠条：

| 段 | 对应 DOM | 你侧栏里的内容 |
|---|---|---|
| **功能区** | `nav._panelList` | 插件 / 自动化任务 / 上下文洞察 / 更多 |
| **工作区** | `div._regionArea` | 工作区 + 会话列表（**默认展开**） |
| **状态区** | `div._footerActions` | 工作区之下、底部「更多」之上的内容：余额卡 / 今日 / 峰谷条 / 番茄钟 / 远程控制 |

底部 `div._settingsArea`（那行「更多」+ 账号）**常驻最底下**，不参与折叠；品牌行与新会话按钮也保持常驻。

工作区展开时不额外占一条：折叠箭头直接并进宿主自己的「工作区」标题行右侧；收起后才换成一条独立的「工作区」折叠条。所以默认状态下侧栏只多两行（功能区 / 状态区），不会出现两个「工作区」。

## 默认与持久化

- 默认：**工作区展开，功能区与状态区折叠**。
- 状态存在 **Host 侧**：`$DSH_HOME/sidebar-triptych.json`（默认 `~/.dsh/sidebar-triptych.json`）。
- **跨设备同步**：任意设备点折叠 → POST 到 Host → Host 通过 SSE 推给所有在线浏览器，其它设备 1 秒内跟着变。新开的页面进来先 GET 一次，直接拿到当前状态。
- 断线不影响使用：本地乐观生效，SSE 断了每 20 秒 pull 一次收敛。

## 宿主侧 API

```
GET  /plugins/dsh-sidebar-triptych/state     -> { collapsed:{panels,region,foot}, rev, updatedAt }
POST /plugins/dsh-sidebar-triptych/state     <- { collapsed:{...} }
GET  /plugins/dsh-sidebar-triptych/events    -> SSE，event: state
```

`collapsed[key] === true` 表示该区折叠。POST 只接受同源请求（带 `Origin` 时必须与 `Host` 一致）。
状态文件原子写（临时文件 + rename），写失败只告警，不回滚 UI。

## 安装

```bash
# 本地目录（开发）
dsh plugin --profile web add "file:/absolute/path/dsh-sidebar-triptych"
# 或运行时注入（不写 profile，可随时撤回）
#   dev_inject_plugin <dir>
```

装完刷新页面（F5）即可看到三根折叠条；宿主侧路由随 dsh 重启生效。

## 边界与已知限制

- 纯 DOM 增强：不注册 slot、不改 React 树；折叠靠 `<html>` 的 `data-dsh-tp-*` 属性 + 一条 `!important` 规则，React 重渲染不会把状态冲掉。
- 折叠条被重渲染删掉时由 `MutationObserver` 补回（rAF 去抖），另有 2 秒兜底 `sync()`。
- 侧栏收成 <96px 图标窄条时，折叠条隐藏且强制展开（窄条里藏东西只会得到空栏）。
- 三段的锚点用 CSS Modules 类名**后缀**匹配（`_panelList` / `_regionArea` / `_footerActions`），不写死构建哈希；宿主大改侧栏结构时可能失配，失配时只是不出现折叠条，不会破坏页面。
- 与其它「改同一批行」的插件（如 dsh-sidebar-fold / sections / panel-buttons）**不要同时开**。

## 卸载

- 正式安装：`dsh plugin --profile web remove dsh-sidebar-triptych`
- 运行时注入：`dev_uninject_plugin dsh-sidebar-triptych`

删除后状态文件 `~/.dsh/sidebar-triptych.json` 可留可删（留着下次装上还是同一套偏好）。

## License

MIT。
