# DSH Game Player

面向 **DeepSeek Harness** 的 Windows 插件：提供截图、显式窗口绑定、受宿主审批控制的键鼠操作，以及桌面键鼠显示和 Live2D 模型管理。当前版本 **0.3.10**。

> 这不是独立游戏程序或通用自主游戏代理。插件依赖 DSH 的工具注册、附件、审批及客户端 UI 服务；直接运行入口或桌面 EXE 不能替代宿主。项目不包含角色模型、贴图、动作或音频。

## 下载与安装

在 [v0.3.10 Release](https://github.com/sjkk16/dsh-game-player/releases/tag/v0.3.10) 下载 **dsh-game-player-0.3.10-windows-x64.zip** 和 **SHA256SUMS.txt**。GitHub 自动生成的 Source code ZIP 不含预编译运行时，不替代完整分发包。

需要 Windows x64、可加载本地插件/bundle 的 DeepSeek Harness、**.NET 10 Desktop Runtime**（包含 WPF/WinForms）、**Microsoft Edge WebView2 Runtime**、Windows PowerShell，以及用于安装生产依赖的 Node.js/npm/pnpm。Release 为框架依赖型部署，不自带 .NET 或 WebView2 Runtime。

1. 用 PowerShell 的 Get-FileHash -Algorithm SHA256 计算 ZIP 哈希，与 SHA256SUMS.txt 比较后解压。
2. 进入解压后的 dsh-game-player 目录，安装生产依赖：

~~~powershell
pnpm install --prod --frozen-lockfile
~~~

3. 完全退出旧宿主，停用旧版本；使用宿主提供的本地插件/bundle 加载入口选择该目录。包标识为 @local/dsh-game-player，插件行标识为 game-player。不要同时加载两个同名实例。
4. 重新启动宿主，保留 requireApproval: true。需要 Live2D 时自行导入有使用权限的模型。

保持 runtime/desktop-0.3.10 与插件入口的相对位置。ZIP 不包含 node_modules，生产依赖安装仍是必要步骤。不同 DSH 版本的加载入口可能不同，本项目不假定未经验证的宿主 CLI 命令。

## 功能与安全边界

- game_screen：按需获取屏幕或已绑定窗口的图像。
- game_window：列出并显式绑定/解绑窗口，不自动抢夺焦点。
- game_input：真实键鼠动作默认需要宿主审批；保留故障锁、持有期限和自动释放机制。
- game_macro：管理本地动作模板，不应保存凭据或私人信息。
- 桌面键鼠显示、Live2D 文件/ZIP/文件夹导入、模型库、参数适配、动作和显示设置。
- game_watch 仅保留兼容接口，自动画面变化通知永久停用；请按需调用 game_screen。

真实输入会影响本机程序。请先绑定正确窗口、保留审批，并在不含敏感内容的环境中使用。外部模型必须遵守作者授权。

### 控制自适应模式

在桌宠管理中启用并显示桌宠后，键盘/Live2D 将只读映射整个桌面的键鼠操作。上方持续显示最后识别的“人控制”或“AI控制”；空闲或界面切换不清除标识，重启后等待首次识别，不保存操作者历史。

“人”指系统报告的非注入事件；“AI”仅指本插件确认的真实输入。其他软件注入使用独立未知提示，不能可靠识别硬件宏、驱动模拟或实际操作者身份。标识不表示仍在输入。本模式不读取输入文本或剪贴板、不保存按键历史、不修改审批或释放机制；隐藏桌宠、停用模式、锁屏或退出时停止只读监听。

### 普通底部说明与模型库

“显示模型下方文字”默认开启，只控制普通底部说明；关闭后上方操作者标识与安全警告仍保留，不改变模型大小或位置。

未选择模型时保持键鼠显示，不自动加载不存在的默认示例模型。可以删除当前或最后一个模型：先解除选择并退回键鼠显示，不自动选择替代模型。删除只影响库中的受管理副本，不修改外部原始文件；共享资源包继续保留。删除需要确认，加载/预览/动作进行中须先结束当前操作。

### 水印控制已删除

不提供“作者授权水印”的隐藏/恢复 UI、授权清单、保存记录或管理/渲染控制；旧隐藏记录不再生效。模型素材不改写，按自身资源正常显示。通用动作和参数适配仍不能修改受保护作者参数。普通底部说明开关不是模型水印功能。

## 本地数据与可选隔离

正式分发默认不设置 dataDirectory，沿用原有本地用户数据目录；不携带测试配置、测试模型或测试设置。

新增可选、非热更新 dataDirectory 配置。相对路径按插件目录解析，不按宿主工作目录解析；也可使用本地绝对路径，修改后需重新加载插件。显式路径无效或不可写会失败，禁止回退到原目录。

配置后，偏好、模型库、桌面缓存和默认宏存储迁至该目录；真正自定义的绝对 macroStoragePath 仍优先。未配置时保持原行为。隔离实例初次模型库为空，不自动迁移旧模型或设置。宿主自身的加载记录和设置不属于插件数据隔离范围。

## 从源码检查与构建

~~~powershell
git clone https://github.com/sjkk16/dsh-game-player.git
cd dsh-game-player
pnpm install --frozen-lockfile
pnpm test
pnpm run test:pack
~~~

构建桌面运行时需要 **.NET 10 SDK**、完整开发依赖、可用 NuGet 源及另行取得的官方 **Cubism SDK for Web 5-r.5**。脚本不会下载 SDK 或角色模型；.NET restore 可能访问 NuGet。

官方 ZIP 为 CubismSdkForWeb-5-r.5.zip，SHA-256：

~~~text
67064a7fb1812cf502f5c4a03bfe12cc638c75a621bb4acf06bb28763df06ba0
~~~

将 ZIP 与同名解压目录放在同一父目录，脚本验证固定 SDK/Core/Framework 哈希和许可证。先阅读原始 SDK 许可证及第三方声明。

~~~powershell
pnpm run build:live2d -- --sdk "D:\SDKs\CubismSdkForWeb-5-r.5"
pnpm test
pnpm run test:release
pnpm run test:native-isolation
~~~

若 pnpm 要求批准构建脚本，不要放开所有依赖；核对来源后只批准确实需要的 esbuild。生成的桌面资源、构建缓存与 runtime 被 Git 忽略，预编译运行时只存在于完整 Release 包或本地构建输出。

## 检查范围

- npm test：语法、本地引用、JSON、敏感内容模式，以及隔离的 UI/模型库/水印删除/自适应/数据目录回归。
- npm run test:pack：实际 npm 打包清单、身份、必需源码与禁止文件；兼容源码目录和当前运行时目录。
- npm run test:release：运行时依赖、13 个着色器、许可证、资源一致性和记录哈希。
- npm run test:native-isolation：新运行包的合成设置、缓存目录和旧记录行为，需要 .NET SDK；不启动可见桌宠或输入监听。

自动检查不截图、不发送真实输入、不修改真实用户数据，不等于恢复了全部历史测试套件或完成所有外部模型的视觉验收。此次本地测试副本经用户确认可发布；特定模型、设备、多屏/DPI与游戏兼容仍需实际使用验证。

## 目录与许可证

源码仓库包含插件入口、src、locale、desktop、scripts、锁文件与文档，不包含模型、完整 SDK、预编译运行时或用户数据。Release ZIP 额外包含当前运行时及第三方许可，不包含依赖安装目录或测试数据。

项目源码采用 [MIT License](LICENSE)。第三方组件及外部模型不被重新授权为 MIT；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和运行包 licenses 目录。
