# 0.3.0 缓存启动权限修复（2026-11-09）

## 原因与复现

- Desktop storage/cache unavailable 发生于 DesktopStorage.PrepareCache 创建 webview-cache／私有子目录，早于模型加载，并非 overlay.json 损坏。
- 工作目录及其新 EXE 继承 Low Mandatory Level（NW）。实际 EXE 进程完整性 SID 为 S-1-16-4096（Low）；系统 dotnet.exe 进程为 S-1-16-8192（Medium）。
- 两种进程具有相同用户 SID。用户数据 ACL 给该账户完整控制；Node 能写入；Low 原生程序／QA dotnet 的 Win32 CreateDirectory 返回 5（Access denied）。系统 dotnet 执行同一 DLL 可以写入。
- 旧 QA 文件夹同为 Low，因此原来的离屏及工作目录持久化测试没有涵盖这个完整性级别边界。

## 修复范围

1. src/desktop-runtime.js 统一生成受控的显示／工具启动命令。仅内置 0.3.0 程序且 DLL／runtimeconfig 存在时，优先使用 ProgramW6432／ProgramFiles 中的系统 dotnet。参数用独立数组传递；不使用 shell、PATH、QA SDK，不提升权限、不调整 ACL。
2. src/overlay.js 与 src/overlay-management.js 采用同一启动命令；取消／退出仍管理自己的宿主与 WebView2 子进程。
3. desktop/Native.cs／Program.cs 在 UI 创建前设置 PerMonitorV2，避免 DLL 宿主丢失 EXE 清单中的 DPI 设置。真实启动回执的多屏边界保持 5120 × 1600。
4. 自定义／便携 EXE 的兼容路径保持不变。缺少系统 .NET 仍需要安装对应 Desktop Runtime 或在合适的普通运行目录部署；本修复不会降低用户数据安全级别来强行启动。

## 验证

- 启动器新增 10 项单元测试通过。
- 全部 334 项无需输入 helper 的回归通过；原有 324 项保留。
- 原生包／设置／存储探针 62 项通过（新增 DPI 验证）。
- 独立正常用户数据目录中两次真实 Core 冷启动、设置重读、缓存隔离与释放等 15 项通过。测试资源仅原始模型只读访问；临时夹清理前严格校验路径边界和非链接属性。
- 真实 C:\Users\sjkk16\AppData\Local\dsh-game-player\overlay.json 路径的只读启动验证成功，回执 error=null、errorCode=null，模型能力可用；原设置文件 SHA-256 不变。该探针延迟模型加载，不代表已完成用户可见模型选择验收。
- 无真实桌面采集、无真实键鼠输入、未启动输入 helper、未重启宿主。

证据位于项目 .qa/storage-permission-20261109：native-start-fixed.json、medium-user-data-report.json、safe-regression.log、native-probe.log、build.log。原生运行仍是独立 runtime/desktop-0.3.0，旧 0.2.5 运行目录未改。

## 备份与下一步

源码、原 0.3.0 原生程序及用户设置备份：.qa/backups/storage-launch-0.3.0-20261109-101908-before。

请用户退出并重新启动 DeepSeek Harness 宿主及客户端，进入“我的桌宠”执行选择并显示；再由用户确认两处设置页同步和重启恢复。不要用管理员运行、删除原模型或降低 AppData 的完整性级别来规避报错。

补充验证：27 项真实原生导入／存储错误恢复回归通过，174 个打包文件检查通过；76 个 JS/MJS 语法检查通过；102 个受保护资源及旧 0.2.5 二进制哈希无变化，真实用户 overlay.json 无变化。
