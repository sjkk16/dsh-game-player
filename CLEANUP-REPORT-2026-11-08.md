# dsh-game-player 无用文件清理报告（2026-11-08）

## 结论

在保证插件可运行、可回滚、可离线重建原生桌宠的前提下，删除 **1428 个文件、527.7 MB**，项目体积由 **2099.5 MB / 9595 文件** 降为 **1571.8 MB / 8167 文件**。

- 唯一生效的原生运行目录 `runtime/desktop-0.2.5`（45 个文件）**逐项 SHA-256 清理前后完全一致**（差异 0）。
- 打包清单校验通过：`166 packaged files; desktop runtime, 13 shaders, licenses and model exclusion verified.`
- 未删除任何源码、配置、依赖、回滚快照、离线构建工具链与验收证据图片。
- 上级目录的 `dsh-game-player.zip`（1.15 GB）按用户要求保留，未处理。

## 约束（清理前核实）

| 事实 | 依据 |
|---|---|
| 本目录是**活链接**，被当前 profile 直接引用，不可改名或移动 | `C:\Users\sjkk16\.dsh\profiles\desktop\package.json`：`"@local/dsh-game-player": "link:C:/Users/sjkk16/Desktop/新建文件夹 (2)/dsh-game-player"` |
| 仅 `runtime/desktop-0.2.5` 生效 | `src/desktop-runtime.js:4` `DESKTOP_RUNTIME_DIRECTORY='runtime/desktop-0.2.5'`；`src/overlay.js`、`src/overlay-management.js` 只经 `desktopExecutable()` 取路径 |
| 默认桌宠模型在插件**旁**的兄弟目录 | `src/overlay.js:24` `join(directory,'..','..','Deepseek桌宠')` → `Deepseek桌宠/`、`cat/` 不可删 |

## 删除清单（A 级：可再生成 / 重复 / 旧版）

| # | 路径 | 大小 | 依据 |
|---|---|---|---|
| 1 | `desktop/bin/` | 26.07 MB | dotnet 构建输出；与 `runtime/desktop-0.2.5` 内容一致（仅少 8 个 licenses 与 `live2d-build.json`），由 `npm run build:live2d` 重新生成 |
| 2 | `desktop/obj/` | 0.48 MB | 编译中间产物，内含旧机器绝对路径 `C:\Users\57515\...`，不可移植，restore 时重建 |
| 3 | `runtime/desktop/` | 26.00 MB | 旧原生程序（DLL SHA-256 `3E366EF8…`，120832 B），无代码引用；`.qa/backups/*` 内仍有快照 |
| 4 | `runtime/desktop-0.2.4/` | 26.03 MB | 被 0.2.5 取代（DLL `AD0BE5B4…`，138752 B），无代码引用 |
| 5 | `.qa/fix-0.2.1-runtime/` | 26.00 MB | 与 `runtime/desktop` 逐字节相同的副本（45 文件，清单比对差异 0） |
| 6 | `.qa/builds/`（0.2.4、0.2.5 暂存） | 52.12 MB | 分别与 `runtime/desktop-0.2.4`、`runtime/desktop-0.2.5` 逐字节相同（各 45 文件，差异 0） |
| 7 | `.qa/sdk-parts/` | 283.63 MB | 已验证 SDK 压缩包的分片副本（57 片，合计 297,403,780 B，与 `.qa/dotnet-sdk-10.0.301-verified.zip` 同尺寸）；`.qa/download-sdk.mjs` 可重新分片下载 |
| 8 | `.qa/dotnet-sdk-10.0.301-win-x64.zip` | 10.66 MB | 10.7 MB 的残缺下载（完整包 283.6 MB），完整包以 `-verified.zip` 保留 |
| 9 | `.qa/nuget-http/`、`.qa/nuget-scratch/`、`.qa/dotnet-home/` | 20.92 MB | NuGet/CLI 缓存与临时 home；`scripts/desktop-dotnet.mjs:9` 每次构建前自动重建这些目录 |
| 10 | `.qa/tmp/` 全部内容（保留空目录） | 7.88 MB | 测试/编译临时目录（`VBCSCompiler`、`node-compile-cache`、随机名残留目录）；测试与构建自行重建 |
| 11 | `.qa/native-ui-smoke/webview-cache/` | 8.94 MB | WebView2 测试缓存；同目录 `report-*.json`、`overlay-*.json` 保留 |
| 12 | `.qa/live2d/webview-cache-9080/`、`webview-cache-2848/` | 27.60 MB | 测试缓存；`live2d-1..4.png`、`pose-*.json`、`run.log` 保留 |
| 13 | `.qa/harness-ui-local/`、`.qa/harness-ui-home/`、`.qa/native-import-smoke/` | 0.40 MB | 测试用临时 HOME/安装目录；`harness-ui-home` 内还留有测试用 `.credentials.yaml`，不宜长期保留 |
| 14 | `.qa/affinity-visible.png`、`affinity-hidden.png`、`affinity-region-diff.png` | 10.88 MB | 无任何报告引用，且为真实桌面截图 |
| 15 | `.qa/overlay-skin-custom.png`、`overlay-layout-tkl.png`、`overlay-theme-light.png`、`overlay-theme-contrast.png`、`overlay-layout-compact.png`、`keyboard-skin-test.png` | 0.12 MB | 未被任何 `.md` 引用 |
| 16 | `TEST-REPORT-2026-11-05.md` | 0.003 MB | 未被 README/VALIDATION 引用，也不在 `package.json` 的 `files` 中 |

合计 **527.7 MB / 1428 文件**。逐项执行结果（含大小与状态）记录在项目外的 `C:\Users\sjkk16\Desktop\新建文件夹 (2)\cleanup-baseline\deleted.json`。

## 保留清单（B 级）与理由

| 保留项 | 大小 | 理由 |
|---|---|---|
| `.qa/backups/`（6 份快照） | 218 MB | 各版本报告声明的回滚依据 |
| `.qa/dotnet/`、`.qa/nuget/`、`.qa/sdk/`、`.qa/dotnet-sdk-10.0.301-verified.zip` | 761 + 124 + 44.7 + 283.6 MB | 离线重建原生桌宠的固定工具链：`scripts/build-live2d.mjs` 需要 `.qa/sdk/CubismSdkForWeb-5-r.5(.zip)`、`.qa/dotnet/dotnet.exe` 与 `.qa/nuget` 中的 WebView2 1.0.3650.58 |
| `.qa/releases/`（0.2.3/0.2.4/0.2.5 tgz） | 20.8 MB | 本地回滚安装包 |
| `.qa/model-adaptation/visual/`、`.qa/live2d-effects/visual|baseline|final-baseline/`、`.qa/live2d/live2d-*.png`、`.qa/overlay-{simulation,real,warning}.png` | ≈78 MB | 被 `MODEL-ADAPTATION-REPORT-0.2.5`、`LIVE2D-*-REPORT`、`OVERLAY-TEST-REPORT-2026-11-05.md` 引用的验收证据 |
| `.qa/*.log`、`.qa/*.json`、`.qa/*.mjs` | ≈1 MB | 历史回执与一次性脚本，体积可忽略，保留可追溯 |
| `runtime/desktop-0.2.5/` | 26.1 MB | 当前生效的原生程序（45 文件，哈希未变） |
| `src/`、`desktop/`（源码与 `web/`）、`tests/`、`scripts/`、`locale/`、`node_modules/`、`index.js`、`client.js`、`package.json`、`package-lock.json`、`cordis.patch.yml`、`icon.svg`、各 `.md` 文档 | — | 运行、测试与打包所需 |

## 未删除、但可继续评估（C 级）

- `.qa/model-adaptation/deepseek-effects/`（10.1 MB）、`.qa/model-adaptation/core-baseline/`（1.1 MB）：未被报告直接引用的中间渲染帧。
- 上级目录 `dsh-game-player.zip`（1.15 GB，11413 条目）：与当前目录重复的完整副本，用户选择保留。
- 兄弟目录 `cat/`、`Deepseek桌宠/`：桌宠模型资源，删除会失去默认模型。

## 验证记录

1. **运行目录完整性**：`runtime/desktop-0.2.5` 45 个文件的 `路径|SHA-256` 清单，清理前后 `Compare-Object` 差异 **0**。
2. **语法**：`node --check` 通过 `index.js`、`client.js`、`src/overlay.js`、`src/overlay-management.js`、`src/desktop-runtime.js`。
3. **模块加载**：`import('./index.js')` 成功，导出 `Config, apply, inject, isLiveValue, name, resolveConfig`；`desktopExecutable()` 指向 `runtime/desktop-0.2.5` 且文件存在。
4. **打包清单**：`node scripts/check-package.mjs` 输出 `166 packaged files; desktop runtime, 13 shaders, licenses and model exclusion verified.`（该脚本需启动 npm 子进程，在文件沙箱下会因 `EPERM` 失败，故以无沙箱模式执行一次）。
5. **临时目录可重建**：`.qa/tmp` 保留为空目录；`scripts/test.mjs`、`tests/*.test.mjs`、`scripts/desktop-dotnet.mjs` 均以 `mkdir -p` 方式自行重建。
6. **引用复核**：`src/`、`scripts/`、`tests/`、`desktop/*.js` 中无对被删路径（`runtime/desktop`、`desktop-0.2.4`、`sdk-parts`、`TEST-REPORT-2026-11-05`、`affinity-*`）的引用；`scripts/check-package.mjs` 中的 `runtime/desktop/...` 是映射前缀，第 28 行会改写为 `DESKTOP_RUNTIME_DIRECTORY`，不受影响。
7. **抽样测试**：`node tests/overlay-cache.test.mjs` 结果 3 通过 / 2 失败。失败项均为本机 junction 语义问题（本机 `fs.symlink(...,'junction')` 后 `lstat().isSymbolicLink()` 返回 `false`，独立探针已复现），与本次删除无关：`src/overlay-cache.js`、`tests/overlay-cache.test.mjs` 的最后修改时间仍是 2026-11-07 22:32，本次未改动任何源码。`node --test` 在文件沙箱下会因 `spawn EPERM` 失败，完整测试套件需在无沙箱环境运行。

## 再生成方式

| 已删内容 | 重建命令 / 机制 |
|---|---|
| `desktop/bin`、`desktop/obj` | `npm run build:live2d`（dotnet restore + publish） |
| `runtime/desktop-0.2.4`、`runtime/desktop` | `DSH_DESKTOP_OUTPUT=.qa/<staging> npm run build:live2d`；或从 `.qa/backups/*` 快照取回 |
| `.qa/builds/*` | 同上，构建时指定 staging 输出目录 |
| `.qa/sdk-parts`、残包 | `node .qa/download-sdk.mjs`（分片下载并按 SHA-512 校验） |
| `.qa/nuget-http`、`nuget-scratch`、`dotnet-home`、`tmp` | `scripts/desktop-dotnet.mjs` 自动创建 |
| `webview-cache` 系列 | `npm run test:overlay:render`、`npm run test:live2d:render`、`npm run test:ui:native` 重新生成 |
| 已删截图 / `TEST-REPORT-2026-11-05.md` | 由对应测试或历史记录重新产生；文档类如需保留可从上级 `dsh-game-player.zip` 内取回 |

## 回滚方式

本次删除项均不再生也可正常运行（当前生效的 `runtime/desktop-0.2.5`、源码、依赖、配置均未改动）。如需恢复被删的运行副本：

1. 确认没有正在运行的桌宠进程；
2. 从 `.qa/backups/<对应快照>/runtime/desktop`（或 `files/runtime/desktop`）复制回 `runtime/desktop`；
3. 0.2.4 可从 `.qa/backups/model-adaptation-2026-11-08-135047-before/files/runtime/desktop-0.2.4` 取回；
4. 构建产物用 `npm run build:live2d` 重新生成即可，无需从快照恢复。

## 边界说明

- 未修改任何源码、`package.json`、`cordis.patch.yml`、profile 配置；未重启宿主、未重装依赖。
- 历史报告中对 `runtime/desktop`、`.qa/builds/0.2.5` 等路径的描述保持原文，作为当时记录；其现状以本报告为准。
- 删除前已确认：无 `GamePlayer.Desktop` / `dotnet` / `MSBuild` 进程占用目标文件，目标目录内无 junction/符号链接（避免误删链接目标）。
