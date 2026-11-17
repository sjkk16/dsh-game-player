# 0.2.1：显示超时与模型导入禁用修复

日期：2026-11-07（Asia/Shanghai）。首个兼容目标：Windows x64 / DeepSeek Harness 0.2.2-rc.1。

## 现场事实

- 用户确认导入故障为「按钮灰色、无法点击」。原按钮把文件选择能力与当前模型加载能力绑定，渲染器失败会连带锁死导入。
- `C:\Users\57515\AppData\Local\dsh-game-player` 为目录联接，指向不存在的 `C:\Users\57515\Desktop\aAAAA\pet-state`；旧渲染器将 WebView2 启动与模型加载共用超时提示。本轮不能把所有超时都归因于模型损坏。
- 根据用户选择，仅补回缺失目标，保留联接。本轮开始时原 overlay.json 不存在；没有创建默认偏好文件或重置 profile 配置。

## 实现

- 两处设置入口继续共用同一控制器。模型文件／文件夹按钮依据 Remote 可用、overlayEnabled、picker 能力及忙碌状态启用，并说明禁用原因；不再要求 model 能力为真。
- 新增原生隐藏/deferred 启动：先确认渲染页面可用，再加载选中的候选；不必先成功加载默认模型。不可用渲染器仅重试一次，失败保留旧选择；同一路径重新导入也执行验证。
- 启动前验证数据／缓存目录。保留有效目录联接，解析到真实目标创建 GUID 专属缓存；断开联接及非目录父路径立即反馈 storage_unavailable。启动/page 与模型各有 25 秒预算，Node 完整启动等待 55 秒，普通命令 30 秒。
- 保留显式显示需求；取消只撤销本次操作，不能覆盖后续 AI 显示。补充取消已生效显示及后备重启后的状态恢复。迟到 WebView2 结果受代次检查约束，退出释放自己的环境进程与订阅。实际本机验证发现 SQLite 文件可能被嵌入进程锁到退出，因而补充 Node 进程结束后的清理：只接受该显示进程声明、位于解析后的数据目录内且名称为 GUID 的缓存，不删除其他缓存或配置。
- Remote 方法仍为 getState / updatePreferences / command；显示 IPC 仍为 v3，v2 键盘不冒充管理成功。新增 stage/errorCode 为兼容状态信息，没有新增模型工具或改变五个游戏工具。缓存所有权作为既有 status / ready 消息的可选元数据，不新增未知消息类型；原样 0.2.0 Node v3 解析器的隐藏实机握手另行验证。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| npm test（全套模拟／recording） | 179 通过，0 失败、0 跳过 |
| npm run test:ui | 44 通过 |
| 缓存边界／进程退出后清理单测 | 5 通过，包含有效联接、非 GUID、越界和缓存自身联接拒绝 |
| npm run test:live2d:package | 25 包／设置／存储／启动代次检查通过 |
| npm run test:ui:imports | 27 原生导入／存储检查通过 |
| npm run test:ui:native | 21 隐藏显示检查通过 |
| npm run test:ui:display | 22 可见显示检查通过，空闲实测约 13 FPS |
| npm run test:live2d:render | 实际 Cubism Core 加载、四帧离屏渲染及所属 WebView2 退出通过，四张画面均检查 |
| npm run test:pack | 137 个打包文件通过，13 个固定着色器、依赖／许可和私有资源排除通过 |
| 已修复的本机数据目录／正式运行产物 | 本机修复后的真实目录 + 正式 v3 运行产物隐藏加载通过，偏好未写入，新增缓存与所属进程退出检查通过 |

原生导入用例使用真实 .model3.json 和纹理，但文件选择结果由 QA 提供，没有自动操作 Windows 对话框。覆盖默认模型不存在时导入、断开联接快速后备、恢复联接后的单次隐藏重试、持续失败不无限重试以及缓存路径冲突。未将模拟 picker 回执当作人工文件选择器验收。

index.js、输入桥接和原生键盘代码未变；渲染源、页面、CSS、bundled renderer 与 Cubism Core 相对 0.2.0 快照的 SHA-256 一致。没有改动作者模型、动作／表情或音频。使用已有经官方 SHA-512 校验的 .NET SDK 10.0.301；没有改系统 PATH 或全局 NuGet 配置。

全套 recording 回归使用记录后端；导入、预览、原生显示与离屏测试没有创建真实输入 helper，没有真实桌面采集或键鼠注入。

## 部署与未覆盖项目

正式运行产物已替换，并校验与暂存构建一致。只停止旧桌宠显示进程 PID 16792，没有重启或修改 Harness 宿主。遇到的 WebView2 Loader 文件锁通过保留哈希相同的文件处理，没有关闭其他程序。之后用正式运行产物和修复后的真实数据目录完成隐藏验证，旧客户端仍需用户重新加载。

更新后的客户端模块不会因磁盘文件变化自动替换已加载的旧模块。请在没有进行中的真实输入任务时重新加载插件及客户端；最稳妥的是重启一次 Harness，然后打开「设置 → 游戏代打」或插件配置入口，确认版本 0.2.1，点击「重试显示」或「显示桌宠」。不要为此关闭 requireApproval 或 dryRun。

当前用户宿主内的下列项目未人工验收，不声明通过：

- 两处设置入口的新客户端实际重载；原生文件／文件夹对话框人工选取及确认。
- 实际手动拖动、混合 DPI／独占全屏、真实截图排除及真实游戏响应。

已通过的独立原生可见测试覆盖显示／隐藏、透明度、位置参数／调整模式、键盘／模型切换和安全预览，但不等同于在用户宿主中人工点选。

## 回滚

快照：`C:\Users\57515\Desktop\aAAAA\dsh-game-player\.qa\backups\fix-0.2.1-2026-11-07-215331-before`。包含 0.2.0 源码、构建产物和 data-junction.json 元数据；无 node_modules、QA、作者模型或用户凭据。

1. 先停止插件，确认没有真实输入任务，保存当前 overlay.json（若存在）与 profile 配置。不要删除或还原已补回的 pet-state 目录，不要替换联接，也不要覆盖新的用户偏好。
2. 从快照还原插件源码及 runtime 内容，排除 data-junction.json / user-overlay.json 等快照元数据；不要把快照中的用户偏好覆盖回去。
3. 为避免旧 C# 项目通配编译混入新文件，仅移除本轮新增的 desktop/DesktopStorage.cs、desktop/RendererLifecycle.cs、desktop/DisplayRuntime.cs；另移除新增 src/overlay-cache.js（旧源不依赖它）。如需完全恢复包清单，再移除 tests/desktop-import-smoke.mjs、tests/overlay-cache.test.mjs 与本报告。所有目标须解析并确认位于插件工作目录内；不作递归清理，也不删除项目外目录。
4. 恢复对应 package.json / lockfile；本轮未更换依赖版本。然后重新加载插件及客户端，必要时重启一次 Harness。0.2.0 与当前偏好 v3 兼容。

## QA 产物

修复日志位于项目 .qa：fix-0.2.1-build.log、fix-0.2.1-tests.log、fix-0.2.1-ui.log、fix-0.2.1-probe.log、fix-0.2.1-native-imports.log、fix-0.2.1-native-hidden.log、fix-0.2.1-native-visible.log、fix-0.2.1-render.log、fix-0.2.1-old-v3-client.log、fix-0.2.1-pack.log、fix-0.2.1-local-data.log 与 fix-0.2.1-deployment.json。这些文件以及 SDK、QA profile、模型和 PNG 均不进入包。
