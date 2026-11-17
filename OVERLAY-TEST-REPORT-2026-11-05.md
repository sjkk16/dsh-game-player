# AI 键鼠可视化实现与验证 — 2026-11-05（Asia/Shanghai）

## 本次交付

新增显示专用的 PowerShell STA / WinForms 悬浮键鼠面板、104 键布局、托盘设置、原生输入观察事件、纯 JS 模拟预览以及统一截图隐藏保护。`overlayEnabled=true`，原有 `requireApproval=true`、`dryRun=true` 保持不变。五个模型工具的公开名称、参数与返回结构不变。

helper 协议升级为 v3，输入账本在保留既有互斥和所有权规则的基础上增加成功 down 标志及全局观察序号。失败意图不冒充成功持有；worker 与独立看门狗共用观察序号，完整快照用于恢复丢失/乱序事件。安全锁定不会因为只读 helper 重连而消失。Unicode 内容不进入观察消息。

## 自动回归：104 项通过

完整的 9 个 `*.test.mjs` 文件已逐文件执行，0 失败、0 跳过：

| 测试文件 | 通过 |
| --- | ---: |
| bridge.test.mjs | 13 |
| protocol.test.mjs | 7 |
| selftest.test.mjs | 16 |
| watch-host.test.mjs | 6 |
| features.test.mjs | 15 |
| overlay.test.mjs | 22 |
| overlay-native.test.mjs | 4 |
| native.test.mjs | 14 |
| window-native.test.mjs | 7 |

新回归覆盖真实/模拟状态隔离、短按余光、组合键、持有期限、鼠标动作、文本隐私、观察协议分片/无效/过期消息、输入故障与守护释放、worker 异常退出、慢管道合并、冷启动预览、审批拒绝、延迟显示、会话关闭、截图并发、隐藏失败、关闭恢复和安全锁定。

最初 `npm test` 在沙箱内因测试子进程 `spawn EPERM` 无法执行，首次两次自动审批超时。这不是测试通过。后续纯 JS 测试在当前进程内逐文件执行；原生录制测试获得单独审批后执行并通过。另一次 `--test-isolation=none` 与旧测试的顶层 await 组合没有产生结果，已中止，不计为通过。

## 原生编译与离屏视觉检查

- Windows PowerShell 5.1 下编译全部输入相关 C# 及显示窗口 C#：通过。
- 人工阻塞输出写线程，同时生成 10,000 条观察消息：生产端完成、队列不超过 128、最新消息保留、溢出标明 resync，输出保持合法逐行 JSON。
- `tests/overlay-offline.ps1` 在内存中绘制真实、模拟及警告面板并生成 PNG；不是桌面截图，没有显示窗口、抢焦点或发送输入。已检查键帽布局和文字，并修复截断。
- 图片位于 `.qa/overlay-simulation.png`、`.qa/overlay-real.png`、`.qa/overlay-warning.png`。

## 语法与打包完整性

- 26 个 JavaScript / MJS 文件通过 `node --check`。
- 3 个 PowerShell 脚本通过 Parser 语法检查。
- `npm pack --dry-run --json --ignore-scripts` 通过，清单包含 44 个文件；没有生成发布包或发布到注册表。
- 对照实际清单检查全部 20 个运行时源文件与相对模块引用，未发现缺失；原先遗漏的窗口、模板、几何和两个 C# 文件已纳入。新面板脚本、布局和观察源文件也包含在内。
- `.qa` 图片、缓存与检查日志不进入交付包。

## 截图保护的实现边界

设置 `WDA_EXCLUDEFROMCAPTURE` 作为额外防护；生产路径默认不信任仅靠 API 成功返回的排除结果，仍执行隐藏确认和 `DwmFlush`。并发截图共享隐藏期限，只有最后一项结束才恢复。确认失败则拒绝截图。仅供宿主测试注入的“已验证亲和性”快速路径也有单测，不是用户配置默认。

## 尚待授权后的实机验收

本轮没有采集真实桌面像素、发送真实键鼠、启动游戏或修改外部宿主配置。以下不得据自动测试宣称通过：

- 真实桌面上的穿透、托盘交互、拖动、焦点保持及多屏 DPI 效果。
- 当前 Windows / 显卡 / CopyFromScreen 下实际截图排除与 watcher 不被面板误唤醒。
- 真实宿主加载、审批后的操作体验、Electron 环境和目标游戏兼容性。

手动运行 `npm run demo:overlay` 可以显示模拟面板，不会启动输入 helper、截屏或发送真实输入。该演示没有在本轮自动运行。
