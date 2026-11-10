# DSH Game Player

面向 **DeepSeek Harness** 的 Windows 插件：为模型提供截图、窗口绑定和受审批控制的键鼠操作，并提供桌面键鼠显示及 Live2D 模型管理。

> **这不是独立游戏程序，也不是通用的自主游戏代理。** 插件依赖 DeepSeek Harness 提供工具注册、附件、审批和客户端 UI 服务。直接运行 `node index.js` 不会启动可用的宿主。项目不包含角色模型、贴图、动作或音频。

当前版本：**0.3.8**。GitHub 仓库仅保存源码；预编译桌面运行时在 [Releases](https://github.com/sjkk16/dsh-game-player/releases) 提供。

## 功能与安全边界

- `game_screen`：按需获取屏幕或已绑定窗口的图像。
- `game_window`：列出窗口、显式绑定/解绑目标并查询状态；不自动抢夺窗口焦点。
- `game_input`：执行鼠标和键盘动作；默认 `requireApproval: true`，真实输入必须经过宿主审批。
- `game_macro`：保存和管理本地动作模板；不要在模板中保存凭据或私人信息。
- 桌面显示：键鼠面板、Live2D 模型导入、动作和显示设置等。
- `game_watch` 只保留兼容接口；**自动画面变化通知已永久停用**，请按需调用 `game_screen`。

真实键鼠输入会影响本机正在运行的程序。请先绑定正确窗口、保留审批，并在不含敏感内容的环境中使用。角色模型由用户自行准备，需遵守模型作者的授权。

## 使用预编译分发包

### 前置条件

- Windows；桌面项目目标框架为 `net10.0-windows10.0.17763.0`。
- 能加载本地插件/bundle 的 **DeepSeek Harness**，并提供工具、附件和所需客户端 UI 服务。
- **.NET 10 Desktop Runtime**（包含 Windows Desktop/WPF/WinForms 框架）。Release 使用框架依赖型部署，不自带 .NET 运行时。
- **Microsoft Edge WebView2 Runtime**。Release 中的 WebView2 SDK DLL 不能替代 WebView2 Runtime。
- Windows PowerShell。输入桥默认使用系统自带的 Windows PowerShell。
- Node.js（带 npm）和 pnpm，用于依赖安装及命令行检查。请使用支持当前 pnpm 锁文件格式的版本。

.NET 与 WebView2 请从 Microsoft 官方渠道安装。目录中的桌面 EXE/DLL 只是插件的显示组件，不替代 DeepSeek Harness。

### 安装步骤

1. 从 [v0.3.8 Release](https://github.com/sjkk16/dsh-game-player/releases/tag/v0.3.8) 下载 `dsh-game-player-v0.3.8-windows.zip` 和 `SHA256SUMS.txt`。
2. 在 PowerShell 中用 `Get-FileHash -Algorithm SHA256` 计算 ZIP 的哈希，与校验文件比较后再解压。
3. 在解压后的 `dsh-game-player` 目录安装生产依赖：

   ```powershell
   pnpm install --prod --frozen-lockfile --ignore-scripts
   ```

4. 按所用 DeepSeek Harness 版本提供的本地插件/bundle 加载方式，选择此解压目录。包标识为 `@local/dsh-game-player`，插件行标识为 `game-player`；入口和补丁已由包清单声明。
5. 保留 `cordis.patch.yml` 中的 `requireApproval: true`。不同宿主版本的安装入口可能不同；本项目不假定未经验证的宿主 CLI 命令。
6. 需要 Live2D 时，在插件的模型管理界面导入你拥有使用权限的模型。模型文件不会随项目分发。

**不要改变运行时相对目录：** `runtime/desktop-0.3.8/` 必须与插件入口处于同一解压根目录下。ZIP 不包含依赖目录，依赖安装仍是必要步骤。包内的 `pnpm-workspace.yaml` 使用 hoisted/copy 配置，依赖安装后为实体目录，便于复制；请不要遗漏这个配置文件。生产依赖安装不运行生命周期脚本。

## 从源码开发或构建

```powershell
git clone https://github.com/sjkk16/dsh-game-player.git
cd dsh-game-player
npm test
npm run test:pack
# 要在宿主中加载源码插件，再安装生产依赖：
pnpm install --prod --frozen-lockfile --ignore-scripts
```

源码仓库不包含预编译运行时、Live2D SDK 或模型。若要直接使用现成运行时，优先下载 Release 的完整分发包。

### 构建 Live2D 桌面运行时

需要 **.NET 10 SDK**（不是仅 Desktop Runtime）、完整开发依赖（使用 `pnpm install --frozen-lockfile` 安装）、可用的 NuGet 依赖源，以及另行取得的官方 **Cubism SDK for Web 5-r.5**。构建脚本不会自动下载 Live2D SDK 或角色模型；.NET restore 可能访问 NuGet。

- 官方 SDK ZIP：`CubismSdkForWeb-5-r.5.zip`。
- ZIP SHA-256：`67064a7fb1812cf502f5c4a03bfe12cc638c75a621bb4acf06bb28763df06ba0`。
- 将 ZIP 及同名解压目录放在同一父目录；也可使用默认位置 `.qa/sdk/`。
- 脚本还会验证 Core 及框架文件的固定哈希，不能以其他 SDK 版本替代。
- 先阅读 SDK 原始许可证和第三方声明；用户自行负责适用的使用和发布授权。

```powershell
pnpm run build:live2d -- --sdk "D:\SDKs\CubismSdkForWeb-5-r.5"
pnpm test
pnpm run test:release
```

上例应同时存在 `D:\SDKs\CubismSdkForWeb-5-r.5.zip`。生成的桌面网页、构建缓存和 `runtime/` 均被 Git 忽略。构建成功不等于渲染或真实输入验收。

### pnpm 构建脚本策略

部分 pnpm 版本可能阻止 `esbuild` 的安装后脚本并要求手动批准。不要自动放开全部依赖的脚本权限；只有在核对依赖来源、确实要构建时，再按 pnpm 提示批准 `esbuild`。本项目的静态检查不依赖它，可直接使用 `npm test` 和 `npm run test:pack`，无需先安装任何依赖。

## 检查命令与已知验证范围

| 命令 | 检查内容 |
| --- | --- |
| `npm test` / `pnpm test` / `pnpm run test:safe` | JS/MJS 语法、本地字面量引用、JSON、敏感模式和隔离回归测试；不启动宿主、不截图、不发送输入 |
| `npm run test:library` | 20 个隔离模型库删除场景及删除按钮确认行为；不接触真实模型库 |
| `npm run test:pack` / `pnpm run test:pack` | npm 源码打包预览、必需文件及禁止文件；源码包不得包含运行时 |
| `npm run test:release` / `pnpm run test:release` | 含运行时的打包预览、托管/原生依赖、13 个着色器、许可证、资源一致性及已记录的构建哈希 |

历史测试文件和历史报告不在当前源码中，因此已移除失效命令。上述检查是**静态、隔离回归和打包检查，不是恢复后的完整功能测试**；字面量引用扫描不保证发现所有动态路径，敏感内容扫描也不能保证不存在任何秘密。

0.3.8 已删除作者授权水印开关，修复默认模型缺失、复制目录后依赖入口失效及模型库删除问题；桌面运行时已重新构建。详细变更见 [更新记录](CHANGELOG.md)。未执行真实键鼠或完整视觉验收。

项目不自带示例模型。未选择模型时保持键鼠显示，不自动加载不存在的默认目录；请从模型库选择已有模型或导入获授权的模型。

## 目录与许可证

- 插件入口、`src/`、`locale/` 和补丁：宿主插件及资源。
- `desktop/`：桌面显示组件源码；`scripts/`：构建及安全检查脚本。
- `runtime/desktop-0.3.8/`：仅存在于 Release 分发包或本地构建输出。

项目自身源码采用 [MIT License](LICENSE)。第三方组件及外部模型不被重新授权为 MIT；详见 [第三方声明](THIRD_PARTY_NOTICES.md) 和分发包中的 `runtime/desktop-0.3.8/licenses/`。Live2D Core 适用其专有许可证，框架和着色器适用各自原始许可证；适用的商业发布义务仍由分发者承担。

