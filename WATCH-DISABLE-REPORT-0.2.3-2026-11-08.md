# 0.2.3 永久停用画面变化自动提醒

日期：2026-11-08（Asia/Shanghai）。目标环境：Windows x64，DeepSeek Harness 0.2.2-rc.1。

## 交付内容

- 不再后台采样画面、创建监视计时器或向聊天队列发送 [game-watch] 提醒；不新增重新开启设置。
- 两处设置页移除三个观战参数，Host schema、默认值及校验同时移除。旧配置及动态引用被忽略。
- 现有五个工具的名称、参数结构、输出 schema 与并发默认值保持兼容。game_watch 三个动作返回 stopped，使用现有 lastError 说明停用原因。
- 兼容回执固定为 running=false、wakes=0、intervalMs=1000、threshold=0.03、maxWakes=20；这些不是有效监视设置。
- 通过公开 Inbox.remove(id) 仅清理 source.kind=game-watch 且 ID 前缀为 game-watch: 的待处理提醒。普通消息、其他插件消息和已领取的聊天历史不变。
- 插件重载使用可选 agents.list() 处理已接入会话；agent/created 处理新建及恢复会话。缺少安全队列接口时不直接修改会话文件，只记录一次受限原因。
- 主动截图保留固定 3% 的图片变化判定，force 与新图片需求继续有效；不再读取被移除的监视阈值。
- 键鼠执行、审批、窗口绑定、释放保护、桌宠预览以及首次 AI 操作后的显示行为不变。dry-run 未恢复。

## 验证

| 验证入口 | 结果 |
| --- | --- |
| 定向 watch / 配置 / 工具回归 | 61 通过，0 失败、0 跳过 |
| npm run test:safe | 167 通过，0 失败、0 跳过；不启动输入 helper |
| npm run test:ui | 46 通过，双入口字段删除、冲突/同步、导入回滚、安全预览及停绘/恢复均回归 |
| npm run test:live2d:package | 25 离线包/设置/存储检查通过；不是 Core 加载或渲染测试 |
| npm run test:pack | 140 个文件，13 个着色器、许可及模型/QA 排除通过 |
| 五个游戏工具接口 | 对比 0.2.2 快照与固定 fixture，名称、参数形状、输出 schema 和并发默认值不变 |
| 变更范围 | 14 个已有文件、2 个新增文件；91 个原生/运行资源文件的 SHA-256 不变 |

定向测试和 test:ui 是 test:safe 的重叠子集，不把上表简单相加作为独立通过总数。

本轮明确排除 native.test.mjs、overlay-native.test.mjs、window-native.test.mjs 三个会启动 recording 输入 helper 的套件；它们未执行，也未计为通过。可见/离屏/Core 渲染及当前宿主手动验收未重跑，不把旧版本结果计为本轮通过。回归中主动画面查看全部使用合成帧，输入使用模拟/录制传输，不运行真实桌面截图或键鼠。

只读进程审计：本轮新增的插件运行进程为 0。工作前已有 2 个 helper 和 1 个桌宠进程均未被本轮终止；这不是“系统内所有 helper 都已退出”的声明。

日志和结构化回执（不进入发布包）：.qa/disable-watch-focused.log、disable-watch-safe.log、disable-watch-ui.log、disable-watch-native-package.log、disable-watch-pack.log，以及 disable-watch-tool-compatibility.json、disable-watch-scope-audit.json、disable-watch-process-audit.json、disable-watch-validation.json。

本轮不启动真实截图、真实键鼠或输入 helper；不重启当前宿主，也不关闭工作前已存在的桌宠/助手进程。原生源码/运行产物不改动，不重建桌宠程序；离线包校验复用本地已验证的 .NET SDK 10.0.301 构建/执行测试探针，SDK 与系统 PATH 不作修改。

## 配置与快照

修改前快照（159 个源码/构建文件，SHA-256 校验）：

C:\Users\57515\Desktop\aAAAA\dsh-game-player\.qa\backups\disable-game-watch-2026-11-08-112310-before

当前 desktop 与 web profile 未包含三个观战配置字段，本轮不写入或删除任何用户配置文件。overlay.json 在快照时不存在；联接、pet-state 目录、模型/作者资源不修改。

## 本地版本包

0.2.3 版本包保存于插件目录的 .qa/releases/0.2.3。实际文件名、SHA-256 及打包清单记录于 .qa/disable-watch-package.json；打包使用 ignore-scripts，不发布到网络。QA、用户配置、作者模型、SDK 与快照不进入版本包。

## 应用与回滚

1. 停止当前 AI 操作后，由用户重启 Harness 加载 Host 与 client 新模块。此步骤未自动执行。
2. 加载后仅清理尚未领取的插件监视提醒；已进入当前回合的消息无法撤回，不删除历史。人工确认两个设置入口无观战参数，队列不再增长。
3. 回滚时使用 snapshot-manifest.json 与最终 scope audit 的 changedExistingFiles 清单，只把这些文件从上述快照逐个恢复到原路径；新 report/fixture 可保留为未使用文档或在确认其位于插件工作目录后删除。
4. 不整份覆盖 profile YAML，不恢复/改写 session 日志，不删除数据联接、pet-state、模型或 SDK。已通过公开接口移除的旧提醒不会因源码回滚而重新排队。
5. 回滚后同样由用户重启 Harness。旧 0.2.2 仅在新的 game_watch start 被调用时可能再次产生自动提醒。
