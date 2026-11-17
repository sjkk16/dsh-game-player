# 0.3.13 截图提速与设置页精简验收（2026-11-17）

详见 [本地优化报告](OPTIMIZATION-REPORT-0.3.13-2026-11-17.md)。已通过隔离安全回归、9,228 项原生指纹检查、66 项模拟工具/调度测试、15 项 Recording 输入安全、29+19 项原生生命周期验证，以及 12 组界面检查和官方样例的沙箱浏览器 Core 渲染对照。真实桌面 GPU、游戏、全屏兼容及宿主附件延迟未作实机结论；下文为历史记录。

> 历史文档：以下内容记录 0.3.7 及更早版本。本目录当前为 0.3.9；作者授权水印功能已按原授权范围恢复，旧测试结果不代表新版本已完成验收。当前用法及安全检查请以 README.md 为准。

# 0.3.2 系统鼠标头部跟随验收（2026-11-09）

详见 LIVE2D-CURSOR-FOLLOW-REPORT-0.3.2-2026-11-09.md。系统鼠标独立通道：30 Hz 只读指针、单一 60 FPS RAF、90 ms 平滑、输入/动作/冻结优先，无坐标持久化或配置迁移。

- 最终 371 项无输入 helper 回归、88 项原生探针、15 项普通 AppData、27 项故障恢复、21 项隐藏原生管理、101/32 项私有 Core 及 14 项既有转换通过。
- 六模型各 60 秒实际逐帧绘制：59.717–59.867 FPS，160 项检查通过。达妮娅 10 分钟：35,956 帧、59.924990 FPS，75 项检查通过；每帧检查非授权参数和部件透明度，几何/GL 约 250 ms 检查。
- 115 项方向/转换检查与 36 张尺寸/像素对照通过；长测运动引擎哈希与最终版本一致，最后的布局中性标题提示单独重验。
- 194 个受保护原资源、旧运行文件和真实状态文件差异 0。完整打包、语法及发布摘要见本轮 .qa/cursor-follow-0.3.2。
- QA 不采样真实系统鼠标、不采桌面或注入键鼠；作者水印遮挡了五款猫的部分五官。真实宿主的可见鼠标跟随、DPI/多显示器及重启恢复必须由用户验收。
- 以下 0.3.1 及更早章节为历史记录，不当作最终用户现场验证。

---

# 0.3.1 Live2D 闲置/外观修复验收（2026-11-09）

完整说明见 LIVE2D-IDLE-FIX-REPORT-0.3.1-2026-11-09.md。六个模型各 60 秒及 10 分钟稳定性均为真实经过时间、每帧 Core/WebGL 绘制；另验证真实 headless RAF。无桌面采集、无真实输入、无输入 helper，现场宿主验收仍待用户重启。

- 复现并修复零时间重绘清空物理输出；初始基线、确认状态和物理缓存分离。
- 可见目标 60 FPS，隐藏零持续绘制；Core/Framework 视图一致、几何有限、资源计数稳定。
- 内部物理调用次数与 physicsSeconds 分开验证，不把“调用次数相同”当作物理时间一致。
- 以下 0.3.0 及更早章节为历史记录，不是本轮测试结果。

---

# 0.3.0 桌宠模型库验收（2026-11-09）

模型库、选择／显示事务、启动恢复、复制校验、取消和回滚已实现。本轮 324 项安全回归、101 项私有 Core 检查、61 项包／存储检查通过；原资源保护 102 项差异 0。详细原生证据见 MODEL-LIBRARY-REPORT-0.3.0-2026-11-09.md。

- 不调用真实截图、OS 键鼠或输入 helper；原生检查只使用自己的隐藏 WebView/WebGL 画布。
- 首帧确认在私有 QA 中不得声称窗口实际可见；真实宿主和本机文件选择器仍需用户重启后确认。
- 下方均为 0.2.5 及更早历史记录，不替代 0.3.0 现场验收。

---

# 0.2.4 Live2D 动作验收（2026-11-08）

## 0.2.5 通用模型与五款 ZIP 猫咪（2026-11-08）

- 无 helper 模拟／recording 回归 **282 通过**；两处设置、表单和新增 UI **78 通过**（包含在 282 中）。
- 原生 ZIP／CRC／数据目录探针 **61 检查通过**；实际 Core 私有画布：五款猫咪＋三款通用样例 **95 检查通过**，原有四种 Deepseek 动作 **32 检查通过**。
- 原生隐藏 UI **21**、导入／存储 **27**、真实 Node 管理链路的 ZIP／适配／样式隔离 **14** 检查通过；四帧原有 Core 基线通过。
- 已查看联系表；作者免费版水印保持，尤诺缺手图回退，Haru 缺 Part01Sketch 的动作禁用，不报告虚假可用。Hiyori／Wanko 声明动作合法可见；合法 Model／PartOpacity、Pose 时间推进由独立 QA 样例验证，不加入用户资源。
- 45 个新运行文件在独立 desktop-0.2.5；0.2.4 及旧程序未覆盖。59 个受保护资源／ZIP／profile 的哈希一致，用户 overlay.json 和数据联接不变。
- 不调用真实截图、OS 键鼠或输入 helper；需要用户重启后人工确认当前宿主、真实文件选择、DPI／位置／穿透。详情见 MODEL-ADAPTATION-REPORT-0.2.5-2026-11-08.md。


最新结果和回滚步骤见 [0.2.4 动作报告](LIVE2D-EFFECTS-REPORT-0.2.4-2026-11-08.md)。本轮使用模拟队列／录制回执、无输入 helper 回归、原生隐藏测试和模型自身离屏画布；没有调用真实截图、真实键鼠或输入 helper。

- 原有五个工具、审批、绑定和释放保护保持兼容；自动提醒与 dry-run 设置不恢复。
- 待机与操作联动固定活泼、静音；特殊动作按作者资源验证，仅手动单次播放。
- 用户配置、桌宠偏好及作者模型资源保持原值；没有自动重启当前 Harness。
- 真实屏幕上的 DPI、位置拖动／穿透、两处 Host 设置实际展示及手动播放，待用户重启后确认。不得用下方历史真实输入记录替代本轮验收。

---

# 当前版本验收：0.2.3（2026-11-08）

永久关闭画面变化自动提醒、不加重新开启设置；五个游戏工具结构兼容，game_watch 仅返回停止状态。后台采样、自动消息入队和三个观战配置均移除。当前交付说明见 [0.2.3 停用报告](WATCH-DISABLE-REPORT-0.2.3-2026-11-08.md)。

- 定向模拟回归：61 项通过。
- 全套无需输入 helper 的回归（test:safe）：167 项通过，0 失败、0 跳过；native、overlay-native、window-native 三个 recording helper 套件不在本轮执行范围。
- 设置/桌宠管理回归：46 项通过（属于上述 167 项的重叠子集）。
- 原生离线包/设置/存储：25 项通过；仅测试探针，不是 Core 加载/渲染验收。
- 打包：140 个文件、13 个固定着色器、许可与模型/QA 排除通过；五个工具结构与 0.2.2 保持兼容。
- 范围审计：14 个已有文件、2 个新增文件；91 个原生/运行文件及 desktop/web profile、overlay.json 缺失状态、数据联接不变。只读进程审计无本轮新增运行进程，工作前已有进程未关闭。
- 本轮没有真实截图、真实键鼠或输入 helper。当前宿主未重启，旧队列的宿主内人工确认未宣称完成；新加载时通过公开队列接口清理尚未领取的旧提醒，历史消息不删除。

以下 0.2.2 及更早内容是历史记录；原生程序没有变更，不把之前的可见/离屏渲染、真实截图、输入或 recording helper 结果重复计为 0.2.3 通过项。

---

## 0.2.2 历史验收

按用户要求删除两处设置入口、Host schema、默认值、随包配置和 `game_input` 的 dry-run 分支。保留人工审批与桌宠显示专用安全预览；游戏输入不再提供模拟执行选项。当前回归结果、profile 字段清理和回滚步骤见 [0.2.2 删除说明](DRYRUN-REMOVAL-REPORT-0.2.2-2026-11-07.md)。

以下 0.2.1 及更早记录是历史验收，其中的 dryRun 默认值和模拟执行行为不适用于 0.2.2。

---

# 0.2.1 显示超时／导入禁用修复（2026-11-07）

最新修复结果见 [UI-FIX-REPORT-0.2.1-2026-11-07.md](UI-FIX-REPORT-0.2.1-2026-11-07.md)：179 项模拟／recording 回归、25 项模型包／存储／启动代次检查、27 项原生导入／存储检查、21 项隐藏与 22 项可见显示检查及四帧离屏渲染通过。没有真实截图或真实键鼠注入。当前用户宿主的原生文件对话框人工点选与加载新客户端后的人工验收未作为通过项。

0.2.0 以及更早的记录原样保留在下方，不能替代 0.2.1 的现场人工确认。

---

# 0.2.0 桌宠管理验收补充（2026-11-07）

本轮新增统一桌宠管理、修订号／单写入者、模型事务切换、安全预览与隐藏停绘。最新结果见 `UI-OPTIMIZATION-REPORT-2026-11-07.md`。

本轮没有真实桌面截图、没有真实键鼠注入。旧的游戏工具实机记录保留在下方，不替代本轮新增功能的验收。

---

# 验收记录 — 2026-11-04 / 2026-11-05 / 2026-11-06 / 2026-11-07（Asia/Shanghai）

## 修复：游戏代打执行过程中面板闪烁（2026-11-07）

需求：「游戏代打插件在执行的过程中会闪烁」。

根因：`OverlayController.syncCapture()` 在默认配置下对每次 `game_screen` / `game_watch` 采样都发送 `{kind:'capture',hidden:true}`，显示进程 `Hide()` → `DwmFlush` → 采集 → `Show()`；桌面 Live2D 运行时又把 `affinitySupported` 硬编码为 `false`，所以即使窗口已设置 `WDA_EXCLUDEFROMCAPTURE` 也始终走隐藏路径。实测旧进程（PID 9640）在 `game_screen` 期间于 5954ms 消失、6077ms 恢复，单次闪烁约 123ms；`game_watch` 每 200ms 采样时会更明显。

改动：

- `desktop/Native.cs`：新增 `GetWindowDisplayAffinity`。
- `desktop/Program.cs`：`ApplyCaptureAffinity()` 设置 0x11 后读回确认；`SourceInitialized` 与 `Show()` 后各验证一次，创建嵌入键盘窗口时再次验证；`ready` 消息上报真实 `affinitySupported`，运行中变化时发送 `{kind:'affinity'}`；任一步失败即降级为 `false`，保留隐藏兜底。
- `src/overlay.js`：接受 `affinity` 更新；只有 `trustCaptureAffinity && affinity` 才跳过 capture 命令。
- `index.js`：生产 Host 传 `trustCaptureAffinity:true`；未验证的运行时仍会隐藏。
- `desktop/GamePlayer.Desktop.csproj`：把 `src/key-map.json` 纳入构建输出，避免从 `desktop/bin` 直接运行时模型因缺键表降级。
- 新增/更新 overlay 单测：验证「已验证亲和 → 不发送 capture」「未验证 → 仍隐藏」「运行中降级 → 恢复隐藏」。

已验证（自动）：

- `npm test`：**134 项通过、0 失败、0 跳过**（含新增 2 项亲和路径用例）。
- `npm run test:pack`：**114 个打包文件**通过。
- 新构建（Live2D 模型视图）握手：`ready` 返回 `affinity:true`；`capture` 全程未出现 `{kind:'capture'}`，可见性探针 10 秒内无变化。
- `game_watch` 200ms × 12s（约 60 次采样）：探针仅输出 `READY` / `END`，面板始终可见，无隐藏/恢复。

已验证（实机 / 像素）：

- 面板窗口位于 (2120,876,420×496)，`IsWindowVisible=True`，`GetWindowDisplayAffinity=0x11`。
- 可见时与 `ShowWindow(SW_HIDE)` 后各截一张 GDI 图；面板区域 (2120,1000)-(2540,1370) 的 mean abs diff = **0.0**，max = **0**，证明采集图中不含面板，同时面板仍在屏幕上显示。
- 部署：停止旧 PID 9640，替换 `runtime/desktop/GamePlayer.Desktop.exe|dll|pdb`，禁用/启用 `include:game-player`，用 `game_input {kind:'wait'}` 拉起新面板（PID 22324）。全程未改变 `requireApproval` / `dryRun` 默认值。

限制：

- `WDA_EXCLUDEFROMCAPTURE` 需要 Windows 10 2004+；不支持的机器仍走隐藏路径，会有短暂闪烁，但不会把面板拍进截图。
- 屏幕采集仍需要授权；本轮只验证了本机 Windows 11 的 GDI 采集路径，其他采集后端（如 Windows Graphics Capture）仍需实机确认。

## 修复：键盘输入无法进入 SDL2 游戏（2026-11-07）

需求：「修复游戏代打插件的键盘输入无法输入到游戏里」。症状：真实鼠标移动可用，键盘在 Noita（SDL2，`SDL_app` 窗口）里完全无效；CapsLock 能被翻转、Alt+Enter 能切换全屏，说明 `SendInput` 已到达系统。

根因：`InputSession.KeyDown()` 只填 `wVk`、`wScan=0`、不带 `KEYEVENTF_SCANCODE`。SDL2 按 `lParam` 的硬件扫描码（或 Raw Input 的 `MakeCode`）映射物理键，扫描码为 0 时得到 `SDL_SCANCODE_UNKNOWN` 并被丢弃；Noita 的 `config.xml` 键位正是 SDL 扫描码（`key_right=7`、`key_left=4`、`key_up=26`、`key_down=22`）。

改动：

- `src/native.cs`：新增 `MapVirtualKeyW` / `MAPVK_VK_TO_VSC_EX`；`ScanFor()` 计算扫描码与扩展位（内置 E0 扩展键表，因为本机 Windows 的 `MAPVK_VK_TO_VSC_EX` 对方向键与 Insert/Delete/Home/End/PgUp/PgDn/NumLock 不返回 `0xE0` 前缀）；`KeyDown()` 追加 `KEYEVENTF_SCANCODE`，扩展键追加 `KEYEVENTF_EXTENDEDKEY`，保留 `wVk` 作为提示；`VK_PAUSE`（E1 前缀）与无扫描码的虚拟键回退为仅 VK；PrintScreen 固定用 `E0 37`（本机布局表返回的是 SysRq 码 `0x54`）。
- 账本槽位 `+28` 保存 `scan | extended<<8 | hasScan<<9`；`+20` 是 expiry int64 的高 32 位，不可占用。`ReleaseSlot()` 用同一扫描码/扩展位发 keyup；`type` 的 Unicode 路径不变。
- `src/pwsh-helper.ps1`：扩展键兜底列表补 `0x2C` / `0xA3` / `0xA5`。

已验证（自动）：`node --test tests/*.test.mjs` **132 项通过、0 失败**。新增用例 `VK keys inject hardware scan codes and releases reuse the recorded scan` 断言：VK 事件带 `KEYEVENTF_SCANCODE`（8）、`scan` 非 0、down/up 扫描码一致、方向键带 `KEYEVENTF_EXTENDEDKEY`（1）、且不含 Unicode 位（4）；跨调用 `keyup` 走 release-only → `ReleaseKey` → `ReleaseSlot` 复用账本扫描码；Unicode 用例的 `scan` / `keyFlags` 期望保持 `[20013,…]` / `[4,6,…]` 不变。

已验证（实机）：通过 `plugin_manager` 对 `include:game-player` 执行禁用→启用，使宿主重新拉起 helper 并重新 `Add-Type` 编译 C#，然后绑定 Noita（`722358:3644:639296235068486180`，1440×900）：

- `game_input {kind:'key',keys:['esc']}` → 截图出现 Noita 暂停菜单（继续 / 新游戏 / 进展 / 选项 / 模组…），再按 `esc` 返回游戏；
- `hold d` 900ms → 画面右移（角色向右移动）；`keydown a` + `wait 700` + `keyup a` → 画面左移，松开后 `diff 0.0056`（无持续移动，无卡键）；
- 全过程无审批、无 `INPUT_UNSAFE`，live 配置（`requireApproval:false`、`dryRun:false`）未改动。

限制：`MapVirtualKeyW` 依赖 helper 线程的键盘布局；标准键稳定，非标准布局若出现错位需改用 `MapVirtualKeyEx` + 目标线程布局（本轮未实现）。`game_screen target:window` 在窗口右边界超出屏幕时（本轮曾为 `1179+1440>2560`）会报 `Capture target outside virtual desktop`，属几何校验而非输入缺陷。

## 新增：键盘外观 / 键数 / 图片皮肤 / 视图切换（2026-11-06，第三轮）

需求：「添加更换 AI 键盘样式」。落地为 5 个新的 volatile 设置 —— `overlayView`（跟随托盘 / 桌宠 / 完整键盘）、`keyboardTheme`（dark/light/contrast）、`keyboardAccent`（teal/sky/violet/rose/lime）、`keyboardLayout`（104/87/65 键）、`keyboardSkin`（builtin/custom）+ 托盘导入键盘图片；设置总数由 11 变为 16。

已验证（自动）：

- 逐文件在进程内执行，**105 项通过、0 失败**：features 21（新增 3）、overlay 28（新增 3）、client-settings 4、protocol 7、watch-host 6、bridge 14、live2d 9、selftest 16。
- features 新增：16 个 volatile 字段的声明顺序与默认值；非法枚举在 schema 与 `resolveConfig` 两处都回落默认并只告警一次；`keyboard-themes.json` 三主题 × 五强调色 + 每主题模拟色齐备且为合法 hex（且模拟色不等于任何强调色）；`overlay-layout.json` 的 `layouts` 键 id 都存在、`full` 不隐藏、104/87/65 三个键数精确成立、`compact` 是 `tkl` 的真超集；`styleFor()` 对 `light+sky+compact+custom` 与默认值分别给出逐色期望；外观字段变化只调用 `syncStyle`、`overlayView` 调用 `syncView`、无关字段（`maxWidth`/`watchThreshold`）不触发重绘。
- overlay 新增：`ready` 之后先 `view` 后 `style`、再发首个 `state`；相同载荷不重复发送、载荷变化只多发一次；面板回 `applied:false` 或 `skinLoaded:false` 时每值只告警一次，且之后截图/状态照常；显示进程被开关关掉再打开后会重新下发外观（`style`/`view` 各多一次）。
- client-settings 继续逐项比对 `GROUPS` 与 `Config.dict`（顺序/默认值/枚举值），因此 5 个新字段与两组新词条被自动覆盖。
- `tests/overlay-offline.ps1` 扩展为外观矩阵：C# 编译通过后离屏渲染 `dark/light/contrast` × `full/tkl` + 一例自造图片的自定义皮肤，并断言深色底仍为 `#111722`、浅色背景亮度 >0.8、高对比背景亮度 <0.05、皮肤区域为图片颜色、104 键画布 `1040x364`、87 键 `880x364`、65 键 `880x318`。
- **像素回归**：改动前的三张基准渲染（real/simulation/warning）另存后重渲染，SHA-256 **完全一致**，说明新增的画布推导与平移没有改变默认外观。
- `node scripts/check-package.mjs`：**114** 个打包文件校验通过（新增 `src/keyboard-themes.json`、`src/keyboard-style.js`）。

已验证（宿主侧）：

- `dotnet build/publish` 通过（0 警告 0 错误），`runtime/desktop/GamePlayer.Desktop.exe|dll` 更新，`runtime/desktop/overlay-layout.json` 已含 `layouts`。
- 禁用/启用 `include:game-player` 后 `Config.listConfigs` 投影里 16 个字段均带 `x-cordis.volatile: true`，新字段默认值与枚举分支正确，`powershellPath`/`macroStoragePath` 仍未标记 volatile。
- `node tests/live2d-render.mjs`：WebView2 初始化 → 模型加载 → 四帧离屏渲染通过，说明 `Program.cs` 的 `Place()`/`EnsureKeyboard()` 改动没有破坏桌宠视图。
- 实机（发布后的 `runtime/desktop`，独立进程直连 NDJSON）：下发 `light + tkl` 样式后收到 `{"applied":true,"skinLoaded":true}`，面板窗口标题 `AI Input · 游戏代打` 出现在设置的 (200,700)，尺寸 **900×372**（= 900 × 364/880，正是 87 键预设的画布比例，而默认 104 键应为 900×315）——证明发布版原生程序确实接受了 `style` 并重算了画布。

未验证 / 限制：

- **UI 尚待重启后实测**：`client.js` 改动属于客户端模块图，需重启一次 Harness 应用才会出现「键盘外观」分组；设置页到 profile patch 的写入链路已在上一轮验证，本轮未再截图。
- 面板按设计设置了 `WDA_EXCLUDEFROMCAPTURE`，因此桌面截图（包括我自己的 `game_screen`）不会拍到面板内容——外观像素由上面的离屏渲染矩阵证明，而不是桌面截图。（旧实现未验证亲和，实际仍走隐藏路径；2026-11-07 的修复与像素对比见本文顶部。）
- 该独立实机进程里 WebView2 页面在 20 秒内没有完成首帧，应用按设计降级到键盘面板（`renderer:"keyboard"`）；同一程序在 `--qa-dir` 测试路径下四帧渲染正常，故判断为一次性冷启动延迟，非本轮改动引入。
- 未执行真实键鼠输入（不需要：面板只读显示，样式与布局均由 ack 与窗口几何证明）。

## 新增：11 项实时设置（2026-11-06，第二轮）

在第一轮只有「显示面板」一个开关的基础上，把原先只能写 YAML 的参数全部搬进设置页。

已验证（自动）：

- 全部 8 个可运行套件逐文件在进程内执行，**100 项通过、0 失败**：features 19、client-settings 4（新增）、overlay 25、protocol 7、watch-host 6、bridge 14、live2d 9、selftest 16。
- features 新增用例：11 个 volatile 字段的声明顺序与默认值；`requireApproval` 作为活引用时，同一个 `tools/pre-execute` 监听器从 `ask` 直接切到放行、无需重注册；`requireApproval` 与 `dryRun` 同时关闭时的告警只报一次、恢复安全组合后可再次触发、无关字段变化不触发。
- client-settings（新增）用例：`GROUPS` 的字段序列与 Host `Config.dict` 的 volatile 字段**完全一致**（顺序、默认值、min/max、枚举值逐项比对，防止客户端与 Host 漂移）；zh/en 词条键集合相同且覆盖每个分组、字段与枚举值；`parseField` 的边界（319/320/2560/2561、`12.5` 对整数字段、空串、`0`/`1.5` 对阈值、非法枚举）；用假 `ctx` 调用 `apply`，确认仍然只注册 `settings.section` 与 `plugins.row.config` 两个插槽，且客户端除 `react` 外不 require 任何包。
- bridge 新增用例：`timeoutMs` 可为函数来源，`requestTimeoutMs` 随来源实时变化、来源返回非正数时回落到静态值、`bridge.timeoutMs = 1500` 的既有直接赋值仍能覆盖（保护 `normalHarness`）。
- schemastery round-trip 单独核对：`union([const,const]).volatile()`、`natural().min().max().volatile()`、`number()`/`boolean()` 经 `toJSON()` → `new Schema(json)` 后仍产生活跃引用并正确校验（`monitor: 'bad'` 报 `expected "primary" | "virtual"`）。
- `node scripts/check-package.mjs`：112 个打包文件校验通过。

已验证（宿主侧）：

- 对 `include:game-player` 做一次禁用/启用后，`Config.listConfigs` 中该条目仍为 `schema`，11 个字段与范围均出现在投影里，5 个工具重新注册。

未验证 / 限制：

- **UI 尚待重启后实测**：`client.js` 改动属于客户端模块图，需重启一次 Harness 应用；本轮未做「改数字 → 写回 patch → 下一次 `game_screen` 用新宽度」的端到端截图证据。
- `native`、`overlay-native`、`window-native` 三个套件仍需真实 PowerShell helper，沙箱内 `EPERM`，本轮未执行；与本次改动无关。
- watcher 的「新参数作用于下一个 watcher」是设计约定：已运行的 watcher 保留启动时的 interval/threshold/maxWakes，没有做运行时热更新。

## 新增：宿主内设置页（2026-11-06，第一轮）

本轮把 `overlayEnabled` 接到宿主设置体系：

- `index.js` 导出 `Config` schema（`@deepseek-ai/schemastery@3.18.5`，与宿主同版本），声明全部既有字段，其中只有 `overlayEnabled` 标记 `.volatile()`。
- `resolveConfig` 识别 Loader 解析出的 volatile 引用（`Symbol.for('cosmokit.volatile.write')`），返回对象的属性用 getter 读取实时值。
- `src/overlay.js` 的 `enabled` 改为解析器，新增 `syncEnabled()`：关闭时结束显示进程并复位控制器，可再次启动。
- 新增 `client.js`（`dsh.client`），在 `设置 → 插件 → 游戏代打 → 配置` 与 `设置 → 游戏代打` 两处渲染同一个开关；写入走 `configForms` → Host `settings.mutate`。
- `package.json` 增加依赖、`./client` 导出与 `dsh.client` 清单；`package-lock.json` 同步更新。

已验证：

- 单元回归（逐文件在进程内执行 `node tests/<file>.test.mjs`，因为沙箱内 `node --test` 以 piped stdio 启动子进程会 `EPERM`）：features 17、overlay 25、protocol 7、watch-host 6、bridge 13、live2d 9、selftest 16 全部通过。新增用例覆盖：schema 默认值与取值域、只有 `overlayEnabled` 是 volatile、volatile 引用在 `resolveConfig` 中保持实时、普通配置仍按原逻辑校验并回退、`OverlayController` 的 `enabled` 解析器与「关闭显示进程后可再次启动」。
- 宿主侧：对 `include:game-player` 执行一次禁用/启用后，`Config.listConfigs` 由 `status: "absent"` 变为 `"schema"`，条目仍为 active，5 个工具全部重新注册——说明 Loader 已接受新 schema。
- `client.js` / `index.js` / `src/overlay.js` 通过 `node --check`；`import('./index.js')` 在插件目录内可正常解析 schemastery，`Config({overlayEnabled:false})` 产出的引用与 `resolveConfig` 行为符合预期。
- 客户端页面肉眼验收通过：重启后两个入口均出现，开关可写入 profile patch。

未验证 / 限制：

- `native`、`overlay-native`、`window-native` 三个套件需要真实启动 PowerShell helper，沙箱内 `HELPER_START_FAILED`（`EPERM`），本轮未执行；与本次改动无关。


## 新增：AI 键鼠可视化（2026-11-05）

本次新增面板、协议 v3 观察通道、模拟预览与截图隐藏保护。完整测试集合逐文件执行 104 项通过；输入 C# / WinForms 编译、输出队列拥塞和离屏绘图检查通过。没有采集真实桌面或发送真实键鼠；真实面板穿透、焦点、多屏和截图排除仍待授权验收。详情见 `OVERLAY-TEST-REPORT-2026-11-05.md`。以下较早实机记录保留原文，不作为新面板的实机证据。

## 验收边界

2026-11-04 一轮只执行纯模拟回归、Windows recording 后端、合成图像、语法/编译检查及只读 helper 探测。没有采集真实屏幕，没有调用真实键鼠 SendInput，没有启动 DeepSeek 宿主。2026-11-05 补做了宿主内实机验证，见下一节。

## 实机验证（2026-11-05，本轮修复后）

以下结论来自在运行中的 DeepSeek 宿主里真实调用工具，而不是模拟：

- `game_screen`：真实截图可用。返回 900×506 图对应 2560×1440 物理屏幕，`scale`、`screenX/screenY`、光标物理坐标与真实桌面一致，图片由 `attachments.saveImage` 落盘并可回放。
- `game_watch`：真实唤醒可用。唤醒消息以带 `id` 的完整 `UserMessage` 经 `agent.followup()` 进入会话收件箱，已确认持久化在会话日志（`user/message`，`source.kind = 'game-watch'`）；达到 `maxWakes` 后自行停止，之后不再唤醒。
- 生命周期：`plugin_manager` 禁用 `include:game-player` 后，helper PowerShell 进程与看门狗启动器均已退出，无残留。
- `game_input`：默认 `dryRun: true` 下只回执注入意图。**真实 SendInput 已在 2026-11-05 单独实测**，见下一节。

## 真实输入实测（2026-11-05）

为覆盖最后一块空白，临时把配置改为 `requireApproval: false` + `dryRun: false`（本会话审批策略为 `never`，无法走 ask），实测后已恢复安全默认值。

- 审批闸门：`requireApproval: true` 时调用 `game_input` 被宿主拒绝（`the user rejected tool "game_input"`），调用未执行。真实 ask 路径生效。
- 真实移动：`move` 到 (100,1000) 与 (1200,700)，helper 回读光标为 `(100,1000)`、`(1200,701)`，与请求一致，误差 ≤1 物理像素。
- 真实按键：`hold shift 250ms` 与 `keydown shift` + `keyup shift` 均成功；事后用 `GetAsyncKeyState` 检查 shift/ctrl/alt/w/space，全部未按下，无悬挂键。
- 超限拒绝：`hold w 3500ms` 在超过 `maxHoldMs: 3000` 时被拒绝，未注入。
- 光标被其他程序抢占：连续两次采样间隔 1.5 秒，无任何插件调用时光标自行移动 682 像素，说明当时有真人在操作这台机器。`game_input` 的落点在每次回执时都准确，偏差只来自其后的人工移动，不是插件缺陷。

### 本轮修复的缺陷

1. `ctx.interval` 在宿主中不可用（timer 服务未注入），watcher 启动即抛 `cannot get property "timer" without inject`。现按宿主调度器 → Node 计时器逐级回退，任何键都受控制器与插件 effect 管理，不会在插件卸载后继续运行。
2. `agent.followup()` 的契约是**同步**接收一条带 `id` 的完整 `UserMessage`，而不是 `{ content, source }`。旧实现传入无 id 对象，导致 `message "undefined" is already pending` 且永不唤醒。现构造完整消息，失败不计入唤醒数、不残留附图需求。
3. 唤醒消息 id 原按 generation 计数，插件重载后从 1 重来会与会话收件箱里已存在的 id 冲突；现加入每次控制器实例的随机 run tag。

### 唤醒语义的更正（2026-11-05 晚）

排查“唤醒消息为何在 watcher 已停后仍陆续到达”时，先误判为“无 id 的幽灵消息被重投递”，随后按 `turn/start` 逐轮核对会话事件，确认该判断**错误**：

- `agent.followup()` 把消息排进 `next-turn` 收件箱；每个 turn 开始时会 `splice(removedCount:1)` 取出**一条**并转为 `user/message`。
- 因此 n 条排队的唤醒会占用 **n 个独立 turn** 依次投递，表现为“watcher 早已停止却仍不断被唤醒”。这是宿主正常的多轮投递，不是重复投递，也不是计时器泄漏。
- 证据：seq 383 / 990 / 991 / 1135 各写入一条，随后 seq 1421 / 1454 / 1477 各移除一条并各自生成 `user/message`，四条互不相同；事后 `inbox` 投影为 `next-turn: ""`、`next-step: ""`，helper 进程 6 秒 CPU 增量 0，`game_watch status` 为 stopped。

由此得到的使用注意：**`maxWakes` 只限制入队次数，不限制随后的投递轮次**。批量触发（阈值设得过低）后会连续多轮被唤醒，每轮都应由模型自己判断是否还需要继续等待。本插件不为此改动语义，因为它保证了“每次唤醒都不会被吞掉”。

## 通过

运行时：Node v24.16.0，Windows PowerShell 5.1.22621.4391。

- `npm test`：54 项通过，0 失败、0 取消、0 跳过；约 18 秒。
  - 40 项 JS 协议/参数、桥接模拟、工具 Schema 和模拟宿主/watcher 测试。
  - 14 项 Windows recording 后端及双进程测试，包括合成 JPEG/PNG 和实际 INPUT 字段记录。
- JS 语法：入口、keys、tools、watch、bridge、watchdog launcher。
- PowerShell helper 语法检查通过；原生 C# 在 Windows PowerShell 编译通过，x64 INPUT 大小为 40 字节。
- `npm run test:probe`：只读几何/光标、中文与 emoji 无效操作名回显、EOF 后 running 状态失效检查通过。
- 只读 probe：primary 2560×1440，virtual 5120×1600，原点 (0,-67)，无插件持有键或按钮。几何是本次探测结果，不替代实机坐标落点测试。

### 主要回归证据

- 鼠标绝对事件的 dx/dy、虚拟桌面边界归一化、按钮及负滚轮数据。
- Ctrl+S 平铺组合键、别名归一、逆序释放及保留已持有修饰键。
- 中文/emoji UTF-8 回显与配对 UTF-16 输入事件；控制字符和不配对 surrogate 拒绝。
- worker/看门狗后端握手先于输入，录制/真实模式不一致时拒绝执行。
- 整个批次校验先于原生调用；非法嵌套协议、未知动作、越界及超预算拒绝。
- 持有期限、重复 down 不续期、跨 agent 拒绝、无关 agent 清理不释放他人的键。
- 注入失败与部分执行恢复、释放失败后输入锁定、不能凭正常 helper 退出宣称释放完成。
- 阻塞 hold 的取消走独立看门狗；worker/看门狗退出及父进程 exit/kill 均留下模拟释放证据。
- stdin 错误、超时、旧代次响应、EOF、关闭后禁止重启、取消后排队输入失效。
- 旧看门狗尚在重试时，新 bridge 不能恢复真实输入。
- 独立差分基线、几何重置、唤醒后附图、附件失败/取消保留需求、停止/重启/销毁竞态。
- 模拟宿主注册与撤销、附件、系统提示、followup、审批 allow→ask/deny，以及 dry-run 无输入调用。

## 明确跳过

`npm run test:live` 无参数执行：

- SKIP 真实截图。
- SKIP 真实键鼠输入。

这两个跳过项不计入 54 项通过，也不作为实机通过证据。非 Windows 环境的原生 recording 用例会明确跳过，本次是在 Windows 上执行。

## 未验证 / 未归因

- 真实多屏与混合 DPI 的鼠标落点（本轮为单屏 2560×1440）。
- 真实游戏内的按键响应与反作弊干预。
- Electron run-as-node 机制下看门狗启动器的兼容性。
- 整个进程树同时被终止、系统崩溃、两个安全进程同时不可运行或系统阻断释放时的行为。
- 评审省略的三条 P2 未逐条还原；没有旧失败日志，不能把本轮问题认定为此前退出码 1 的原因。

## 配置与交付

默认与随包配置均为 `requireApproval=true`、`dryRun=true`。保留自动释放限制和故障锁，不自动聚焦、不绕过宿主审批。本轮仍不声明适合无人确认的真实控制。

README、原生 C#、共享键表、PowerShell helper、独立启动器及回归测试均列入打包清单。`npm pack --dry-run --json` 清单检查通过：25 个文件，无调试日志、临时事件文件或 node_modules；未发布包。

## 2026-11-05：Live2D 桌宠增量

本轮不沿用历史结论：实际重新执行全部 10 个自动测试文件，共 116 项通过（分组运行），另有 15 项模型包/设置校验；真实 Core 6.0.1 加载 Deepseek 模型及四张自身画布渲染通过，正常退出后 WebView2 子进程退出检查通过。helper 更新至 v4，完整发布构建与打包验证见 `LIVE2D-TEST-REPORT-2026-11-05.md`。尚未进行真实输入、桌面截图或可见桌宠的人工验收。


### 2026-11-09：修复 0.3.0 的真实用户缓存权限问题

若直接运行工作目录中的 EXE，它可能继承 Windows Low Mandatory Level 标签，从而无法写入普通 Medium 完整性的用户数据目录，即使账户 ACL 显示完整控制。生产显示进程及模型工具现在优先通过已安装的系统 \dotnet\dotnet.exe 执行同目录 GamePlayer.Desktop.dll，不使用 PATH 或 .qa SDK，不申请管理员权限，不调整用户数据的 ACL／完整性标签。没有系统宿主或使用自定义原生程序时保留原 EXE 兼容路径。

原生入口在 WPF／WinForms 创建窗口前设置 PerMonitorV2 UI 线程上下文，保持跨屏 DPI 行为。新增 test:storage:native 使用正常用户数据目录中的随机、独立临时夹验证真实缓存和模型启动；不修改现有 overlay.json，不启动输入 helper，不采集桌面，不发送真实输入。具体证据见 STORAGE-FIX-REPORT-0.3.0-2026-11-09.md。宿主及两处设置页的真实显示／重启恢复验收仍须用户完成。
