# 0.2.2 移除模拟运行设置（2026-11-07）

## 变更范围

- 两个设置入口移除「模拟运行（dry-run）」开关及中英文文案。Host Config、volatile 更新、默认配置和随包 cordis.patch.yml 不再提供 dryRun。
- game_input 不再走模拟成功分支，新执行不再返回 dryRun 标记；成功调用走真实输入传输。五个模型工具的名称、输入参数与输出 schema 保持兼容；历史模拟回执仍标注未注入，避免将旧记录误认成真实操作。窗口绑定、预算、故障锁与释放保护保留。
- 人工审批功能仍保留且默认开启；当前用户 profile 的审批值不被修改。关闭审批时，不依赖已移除字段，界面和日志都会警告真实输入无需确认。
- 桌宠管理的约 3 秒安全预览保留，只驱动显示，不截图、不发送键鼠、不创建真实输入 helper。模型导入、显示和渲染器保持 0.2.1 实现。

## 配置清理与备份

没有独立的 dry-run 配置文件，因此没有删除整份共享配置。当前 `C:\Users\57515\.dsh\profiles\desktop\cordis.patch.yml` 仅删除游戏代打节点的一行 `dryRun: false`；其余字节与原文件一致，审批配置仍为原值（false）。其他 profile 未发现此字段，未作修改。旧的 true、false 或 volatile 字段交给新版本时会被忽略，不改变审批值。

源码／构建产物快照：`C:\Users\57515\Desktop\aAAAA\dsh-game-player\.qa\backups\remove-dryrun-2026-11-07-225803-before`。配置回滚元数据保存于快照中的 `profile-dryrun-removal.json`；只记录删除字段与校验信息，不复制其他插件配置或凭据。桌宠联接、pet-state、overlay.json、模型资源及键盘皮肤没有删除或改写。

## 验证

| 检查 | 结果 |
| --- | --- |
| npm test | 183 通过，0 失败、0 跳过 |
| npm run test:ui | 46 通过，包含双入口移除、默认审批与关闭审批告警 |
| npm run test:live2d:package | 25 原生包／设置／存储检查通过 |
| npm run test:ui:native | 21 隐藏显示检查通过，安全预览继续可用且不创建输入 helper |
| npm run test:ui:imports | 27 导入／存储检查通过，失败回滚与隐藏重试正常 |
| npm run test:pack | 138 个打包文件通过，13 个固定着色器／许可／私有资源排除通过 |
| 五个工具兼容性 | 名称、输入参数与输出 schema 逐项对比 0.2.1 快照完全一致 |
| 配置清理 | 当前 profile 只删除一行，读回 SHA-256 与目标一致；其他配置未变 |
| 生命周期审计 | 所属显示、WebView2、插件脚本 helper 均为 0；本轮新建缓存全部清理 |

所有输入测试仅使用模拟传输或 recording 后端，不采集真实桌面、不注入真实键鼠。原生显示源码与运行产物相对快照的 SHA-256 完全一致，无需重建 .NET。可见窗口与四帧离屏渲染本次没有重跑，不把 0.2.1 的历史结果作为本轮新验收。已有 QA 旧缓存、SDK 与旧快照未作无关删除。

日志：项目 `.qa/remove-dryrun-tests.log`、`remove-dryrun-ui.log`、`remove-dryrun-native-package.log`、`remove-dryrun-native-hidden.log`、`remove-dryrun-native-imports.log`、`remove-dryrun-pack.log`。字段清理、工具接口对比与变更范围另存为 `.qa/remove-dryrun-profile.json`、`remove-dryrun-tool-compatibility.json`、`remove-dryrun-scope-audit.json`，不进入发布包。

## 重载与人工确认

未自动重启 Harness 或调用真实游戏输入。完成回归后，需在没有输入任务时重新加载插件和客户端（可重启 Harness），确认两处不再显示模拟运行开关。请注意当前用户审批是关闭的；新版本没有模拟执行选项，AI 输入调用会走真实 Windows 输入。若需要逐次确认，请先开启「真实键鼠操作前需要人工确认」。

## 回滚

1. 在没有真实输入任务时停止插件，保留当前 profile 和桌宠偏好。
2. 从快照恢复本次变更的 index.js、client.js、src/tools.js、src/extra-tools.js、cordis.patch.yml、package.json、package-lock.json、README.md、VALIDATION.md、scripts/check-package.mjs 及对应测试文件。运行产物本次未改，不必覆盖。
3. 需要恢复本次删除的用户字段时，根据 profile-dryrun-removal.json 在 game-player 的 config 下补回原 dryRun 行，不覆盖整份共享 YAML；若期间已有新配置，先人工确认。
4. 重新加载插件与客户端。不要删除 pet-state、overlay.json、模型、联接或 QA SDK；历史 0.2.1 及更早报告保留原样，不能当作 0.2.2 当前行为说明。
