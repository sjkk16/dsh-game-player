/**
 * Game Player — settings UI for the Web client.
 *
 * The Host half declares twelve volatile Config fields, so
 * `@deepseek-ai/dsh-settings` serves a form for the `game-player` entry and the
 * shared `configForms` service exposes it to this page. The same component is
 * mounted twice: once as the row's configuration page inside the Plugins
 * section, and once as its own settings page.
 *
 * Every row here is a live setting: a write goes through the Host's
 * revision-checked form, the Loader commits the value into the running plugin
 * and the page folds the answer back from the shared snapshot. Nothing here
 * remounts the plugin.
 *
 * Only React is taken from the module table. Harness Client packages are not
 * imported: their modules change without notice, so the controls are
 * implemented here with theme tokens alone.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-game-player',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Settings namespace: the Loader entry id declared by the bundle patch. */
    const NS = 'game-player'
    /** Key of this row inside the Plugins page: `<package name>#<row id>`. */
    const ROW_KEY = '@local/dsh-game-player#game-player'

    /**
     * The editable fields, in Host Config declaration order.
     *
     * `fallback` mirrors the Host schema default and is only used while the
     * snapshot is missing a value (first paint, or a client running ahead of a
     * Host reload). `min`/`max`/`step`/`values` mirror the schema ranges, so an
     * obvious typo is refused here instead of being written and rejected.
     */
    const GROUPS = [
      {
        id: 'safety',
        fields: [
          { key: 'requireApproval', kind: 'boolean', fallback: true },
        ],
      },
      {
        id: 'panel',
        fields: [
          { key: 'overlayEnabled', kind: 'boolean', fallback: true },
          { key: 'overlayView', kind: 'enum', values: ['auto', 'model', 'keyboard'], fallback: 'auto' },
        ],
      },
      {
        id: 'keyboard',
        fields: [
          { key: 'keyboardTheme', kind: 'enum', values: ['dark', 'light', 'contrast'], fallback: 'dark' },
          { key: 'keyboardAccent', kind: 'enum', values: ['teal', 'sky', 'violet', 'rose', 'lime'], fallback: 'teal' },
          { key: 'keyboardLayout', kind: 'enum', values: ['full', 'tkl', 'compact'], fallback: 'full' },
          { key: 'keyboardSkin', kind: 'enum', values: ['builtin', 'custom'], fallback: 'builtin' },
        ],
      },
      {
        id: 'capture',
        fields: [
          { key: 'maxWidth', kind: 'integer', min: 320, max: 2560, step: 1, fallback: 1280 },
          { key: 'jpegQuality', kind: 'integer', min: 20, max: 95, step: 1, fallback: 60 },
          { key: 'monitor', kind: 'enum', values: ['primary', 'virtual'], fallback: 'primary' },
        ],
      },
      {
        id: 'input',
        fields: [
          { key: 'maxHoldMs', kind: 'integer', min: 10, max: 60000, step: 1, fallback: 3000 },
          { key: 'helperTimeoutMs', kind: 'integer', min: 1000, max: 120000, step: 1, fallback: 15000 },
        ],
      },
    ]

    const zh = {
      sectionTitle: '游戏代打',
      summary: '面板、键盘外观、审批、截图与输入设置。',
      'group.safety': '安全',
      'group.panel': '悬浮面板',
      'group.keyboard': '键盘外观',
      'group.capture': '截图',
      'group.input': '输入',
      'field.requireApproval.label': '真实键鼠操作前需要人工确认',
      'field.requireApproval.hint': '开启时，模型每次要动真实鼠标或键盘都要先经你确认；关闭后不询问直接操作。',
      'field.overlayEnabled.label': '显示 AI 键鼠悬浮面板',
      'field.overlayEnabled.hint': '只影响面板显示，不改动输入审批。关闭后显示进程退出，再次打开会在下一次操作时重新出现。',
      'field.overlayView.label': '显示视图',
      'field.overlayView.hint': '「沿用本机保存的视图」使用此前保存的桌宠或键盘视图；「桌宠」加载 Live2D 模型，「完整键盘」直接显示键鼠面板（模型加载失败也会回落到键盘）。',
      'overlayView.auto': '沿用本机保存的视图',
      'overlayView.model': '桌宠（Live2D）',
      'overlayView.keyboard': '完整键盘',
      'field.keyboardTheme.label': '键盘配色主题',
      'field.keyboardTheme.hint': '深色为默认；浅色适合明亮的游戏画面；高对比用纯黑底和亮边，画面很花时最容易看清。',
      'keyboardTheme.dark': '深色',
      'keyboardTheme.light': '浅色',
      'keyboardTheme.contrast': '高对比',
      'field.keyboardAccent.label': '强调色',
      'field.keyboardAccent.hint': '真实输入时高亮按键和标题的颜色；模拟预览始终是琥珀色，方便一眼分出真假。',
      'keyboardAccent.teal': '青色',
      'keyboardAccent.sky': '天蓝',
      'keyboardAccent.violet': '紫罗兰',
      'keyboardAccent.rose': '玫红',
      'keyboardAccent.lime': '青柠',
      'field.keyboardLayout.label': '键盘键数量',
      'field.keyboardLayout.hint': '104 键全尺寸、去掉小键盘的 87 键、只留主键区和方向键的 65 键；只隐藏键位，不重排。',
      'keyboardLayout.full': '104 键（全尺寸）',
      'keyboardLayout.tkl': '87 键（无小键盘）',
      'keyboardLayout.compact': '65 键（紧凑）',
      'field.keyboardSkin.label': '键盘皮肤',
      'field.keyboardSkin.hint': '内置绘制按主题配色画键帽；自定义图片需先在上方「桌宠管理」导入键盘图片。',
      'keyboardSkin.builtin': '内置绘制',
      'keyboardSkin.custom': '自定义图片',
      'field.maxWidth.label': '截图宽度',
      'field.maxWidth.hint': '截图像素宽度，320–2560；高度按屏幕比例自动计算。',
      'field.jpegQuality.label': '截图 JPEG 质量',
      'field.jpegQuality.hint': '20–95，越高越清晰，图片体积也越大。',
      'field.monitor.label': '截图范围',
      'field.monitor.hint': '只截主屏，还是把所有显示器拼成一张。',
      'monitor.primary': '仅主屏',
      'monitor.virtual': '全部显示器',
      'field.maxHoldMs.label': '单次按住上限',
      'field.maxHoldMs.hint': '按住键或鼠标键的最长时间（毫秒），10–60000；到点自动释放。',
      'field.helperTimeoutMs.label': 'helper 请求超时',
      'field.helperTimeoutMs.hint': '一次截图或输入请求最长等多久（毫秒），1000–120000；超时会中断并尝试释放。',
      loading: '正在读取设置…',
      unavailable: '当前 profile 没有为这个插件提供设置。',
      readOnly: '这些配置由更高优先级的层（home 配置或命令行覆盖）控制，无法在这里修改。',
      saveFailed: '保存失败：Host 拒绝了这次修改（可能被更高优先级的 home 配置或命令行覆盖）。',
      reset: '恢复默认',
      resetFailed: '恢复默认失败：Host 拒绝了这次修改。',
      saving: '正在保存…',
      dangerBanner: '真实键鼠输入已启用且不再询问：模型接下来的每次操作都会直接作用在这台电脑上。',
      invalidInteger: '请填写整数。',
      invalidNumber: '请填写数字。',
      outOfRange: '超出允许范围。',
      invalidChoice: '请选择有效值。',
    }

    const en = {
      sectionTitle: 'Game Player',
      summary: 'Overlay panel, keyboard appearance, approval, capture and input settings.',
      'group.safety': 'Safety',
      'group.panel': 'Overlay panel',
      'group.keyboard': 'Keyboard appearance',
      'group.capture': 'Screen capture',
      'group.input': 'Input',
      'field.requireApproval.label': 'Ask before real keyboard and mouse input',
      'field.requireApproval.hint': 'On, every request to move the real pointer or press real keys waits for your confirmation. Off, the model acts without asking.',
      'field.overlayEnabled.label': 'Show the AI input overlay panel',
      'field.overlayEnabled.hint': 'Display only. Turning it off closes the display process; turning it back on shows the panel again on the next action.',
      'field.overlayView.label': 'Shown view',
      'field.overlayView.hint': 'Saved view on this PC retains the previously saved pet or keyboard view; Pet loads the Live2D model; Full keyboard shows the keyboard panel directly (a failed model load also falls back to it).',
      'overlayView.auto': 'Saved view on this PC',
      'overlayView.model': 'Pet (Live2D)',
      'overlayView.keyboard': 'Full keyboard',
      'field.keyboardTheme.label': 'Keyboard theme',
      'field.keyboardTheme.hint': 'Dark is the default; light suits bright game scenes; high contrast uses a black background and bright edges for busy pictures.',
      'keyboardTheme.dark': 'Dark',
      'keyboardTheme.light': 'Light',
      'keyboardTheme.contrast': 'High contrast',
      'field.keyboardAccent.label': 'Accent color',
      'field.keyboardAccent.hint': 'Color of a highlighted key and the title during real input; a simulation preview always stays amber so the two are never confused.',
      'keyboardAccent.teal': 'Teal',
      'keyboardAccent.sky': 'Sky',
      'keyboardAccent.violet': 'Violet',
      'keyboardAccent.rose': 'Rose',
      'keyboardAccent.lime': 'Lime',
      'field.keyboardLayout.label': 'Key count',
      'field.keyboardLayout.hint': '104 keys full size, 87 without the number pad, or 65 with only the main block and arrows. Keys are hidden, never rearranged.',
      'keyboardLayout.full': '104 keys (full size)',
      'keyboardLayout.tkl': '87 keys (no number pad)',
      'keyboardLayout.compact': '65 keys (compact)',
      'field.keyboardSkin.label': 'Keyboard skin',
      'field.keyboardSkin.hint': 'Built-in drawing paints the keycaps with the theme palette; a custom image must first be imported in Desktop pet management above.',
      'keyboardSkin.builtin': 'Built-in drawing',
      'keyboardSkin.custom': 'Custom image',
      'field.maxWidth.label': 'Capture width',
      'field.maxWidth.hint': 'Screenshot width in pixels, 320–2560; height follows the screen aspect ratio.',
      'field.jpegQuality.label': 'Capture JPEG quality',
      'field.jpegQuality.hint': '20–95. Higher is sharper and larger.',
      'field.monitor.label': 'Capture area',
      'field.monitor.hint': 'Capture only the primary monitor, or every monitor as one image.',
      'monitor.primary': 'Primary monitor',
      'monitor.virtual': 'All monitors',
      'field.maxHoldMs.label': 'Held input limit',
      'field.maxHoldMs.hint': 'Longest a key or mouse button may stay down, in milliseconds (10–60000); it is released automatically at the limit.',
      'field.helperTimeoutMs.label': 'Helper request timeout',
      'field.helperTimeoutMs.hint': 'How long one capture or input request may take, in milliseconds (1000–120000); a timeout cancels and releases.',
      loading: 'Reading settings…',
      unavailable: 'This profile does not serve settings for this plugin.',
      readOnly: 'A higher-priority layer (home configuration or a command-line overlay) owns these values, so they cannot be edited here.',
      saveFailed: 'Save failed: the Host rejected the change (a higher-priority home configuration or command-line overlay may own this value).',
      reset: 'Default',
      resetFailed: 'Restore failed: the Host rejected the change.',
      saving: 'Saving…',
      dangerBanner: 'Real keyboard and mouse input is on and no longer asks: every action the model takes lands on this computer directly.',
      invalidInteger: 'Enter a whole number.',
      invalidNumber: 'Enter a number.',
      outOfRange: 'Out of the allowed range.',
      invalidChoice: 'Choose one of the listed values.',
    }

    Object.assign(zh, {
      'local.title':'桌宠管理','local.hint':'本机共享偏好。导入与预览只控制显示；打开本页不会启动桌宠。',
      'local.unavailable':'桌宠管理接口不可用或当前连接不是宿主 owner；原有插件配置仍可使用。',
      'local.widthDip':'桌宠大小','local.keyboardWidthDip':'键盘面板大小','local.opacity':'不透明度',
      'local.model':'模型','local.profile':'全局参数适配 JSON','local.globalProfile':'全局键鼠配置（无需保留原文件）','local.image':'键盘图片','local.default':'使用默认模型／适配',
      'local.emptyImage':'未导入（导入后在键盘外观中选择自定义图片）','local.importModelFile':'导入模型文件／ZIP','local.importModelFolder':'导入模型文件夹',
      'local.importProfile':'选择适配文件','local.clearProfile':'恢复全局键鼠自动识别','local.importKeyboardImage':'导入键盘图片','local.clearKeyboardImage':'清除图片选择',
      'local.show':'显示桌宠','local.hide':'隐藏桌宠','local.beginAdjust':'调整位置','local.endAdjust':'结束调整并保存',
      'local.resetLayout':'恢复默认布局','local.reloadModel':'重新加载模型','local.retryDisplay':'重试显示',
      'local.preview':'安全预览（约 3 秒）','local.stopPreview':'停止预览','local.cancelLoad':'取消导入／加载',
      'local.not-started':'尚未启动','local.starting':'启动中','local.ready':'就绪','local.loading':'模型加载中','local.picking':'选择文件中',
      'local.fallback':'键盘后备模式','local.stopped':'已停止','local.error':'显示异常','local.visible':'已显示','local.hidden':'已隐藏',
      'local.saved':'已保存','local.completed':'操作完成','local.pending':'正在处理…','local.invalid':'数值无效或超出范围',
      'local.conflict':'其他入口已修改偏好，已刷新；请确认新值后重试。','local.unsafe':'真实输入仍按住或释放未确认，不能播放预览。',
      'local.disabled':'悬浮面板已关闭；可保存尺寸，导入、显示和预览需先开启上方开关。',
      'local.runtimeLimit':'当前后备运行时不支持完整桌宠管理。可重试显示，原有键盘展示仍可使用。',
      'local.pickerUnavailable':'缺少本机文件选择器，请重新构建或安装桌宠运行时。','local.importBusy':'另一个桌宠操作正在进行，请完成或取消后再导入。',
      'local.importRecovery':'可直接导入模型；需要时会在隐藏状态重试渲染器，不要求默认模型先加载成功。',
      'local.stage.storage':'检查数据／缓存目录','local.stage.runtime':'初始化 WebView2','local.stage.page':'初始化本地渲染页面','local.stage.model':'验证模型',
    })
    Object.assign(en, {
      'local.title':'Desktop pet management','local.hint':'Preferences are shared on this PC. Import and preview affect display only; opening this page never starts the pet.',
      'local.unavailable':'Desktop management is unavailable or this connection is not the Host owner. Existing plugin settings remain available.',
      'local.widthDip':'Pet size','local.keyboardWidthDip':'Keyboard panel size','local.opacity':'Opacity',
      'local.model':'Model','local.profile':'Global parameter adapter JSON','local.globalProfile':'Global input settings (source file no longer required)','local.image':'Keyboard image','local.default':'Default model / adapter',
      'local.emptyImage':'No imported image (select Custom image under Keyboard appearance after importing)',
      'local.importModelFile':'Import model file / ZIP','local.importModelFolder':'Import model folder','local.importProfile':'Choose adapter',
      'local.clearProfile':'Restore global automatic inputs','local.importKeyboardImage':'Import keyboard image','local.clearKeyboardImage':'Clear image selection',
      'local.show':'Show pet','local.hide':'Hide pet','local.beginAdjust':'Adjust position','local.endAdjust':'Finish adjustment and save',
      'local.resetLayout':'Reset layout','local.reloadModel':'Reload model','local.retryDisplay':'Retry display',
      'local.preview':'Safe preview (~3 sec)','local.stopPreview':'Stop preview','local.cancelLoad':'Cancel import / load',
      'local.not-started':'Not started','local.starting':'Starting','local.ready':'Ready','local.loading':'Loading model','local.picking':'Choosing a file',
      'local.fallback':'Keyboard fallback','local.stopped':'Stopped','local.error':'Display error','local.visible':'Visible','local.hidden':'Hidden',
      'local.saved':'Saved','local.completed':'Done','local.pending':'Working…','local.invalid':'Invalid or out-of-range number',
      'local.conflict':'Preferences changed in another entry. Values were refreshed; review them and retry.',
      'local.unsafe':'Real input is held or its release is unconfirmed. Preview is unavailable.',
      'local.disabled':'The overlay is disabled. Sizes can be saved; enable the switch above before importing, showing, or previewing.',
      'local.runtimeLimit':'This fallback runtime does not support full pet management. Retry the display; the existing keyboard view remains available.',
      'local.pickerUnavailable':'The native file picker is missing. Rebuild or reinstall the desktop runtime.','local.importBusy':'Another desktop operation is active. Finish or cancel it before importing.',
      'local.importRecovery':'Import directly; the renderer can retry hidden without loading the default model first.',
      'local.stage.storage':'Checking data/cache storage','local.stage.runtime':'Initializing WebView2','local.stage.page':'Initializing the local renderer page','local.stage.model':'Validating the model',
    })

    /** One external store for both page mounts; one visible-page polling loop. */
    Object.assign(zh, {
      'local.motions':'Live2D 动作','local.refreshMotions':'读取可用动作','local.playMotion':'播放动作','local.stopMotion':'停止动作',
      'local.motionHint':'活泼联动与待机 · 静音。特殊动作仅手动播放；真实输入立即中断。',
      'local.motionUnread':'尚未读取动作。读取只会隐藏验证模型，不会显示桌宠。','local.motionEmpty':'当前模型未声明动作。',
      'local.motionUnavailable':'当前渲染器不支持动作播放，请更新桌宠运行程序；键盘后备不支持此功能。',
      'local.motionLoading':'正在隐藏加载并验证动作…','local.motionPlaying':'动作播放中 · 未操作电脑','local.motionNone':'请选择动作',
      'local.motionInvalid':'该动作不可用：','local.motionStale':'模型或动作目录已变化，请重新读取动作。',
      'local.motionName.Hello':'打招呼','local.motionName.Surprised':'惊讶','local.motionName.Sweat':'流汗','local.motionName.Heart':'爱心',
    })
    Object.assign(en, {
      'local.motions':'Live2D motions','local.refreshMotions':'Read available motions','local.playMotion':'Play motion','local.stopMotion':'Stop motion',
      'local.motionHint':'Lively feedback and idle effects, muted. Special motions are manual; real input interrupts immediately.',
      'local.motionUnread':'Read the motion catalog first. Validation runs hidden and does not show the pet.','local.motionEmpty':'This model declares no motions.',
      'local.motionUnavailable':'This renderer cannot play motions. Update the desktop runtime; the keyboard fallback does not support this feature.',
      'local.motionLoading':'Loading and validating motions while hidden…','local.motionPlaying':'Playing motion · no computer input','local.motionNone':'Select a motion',
      'local.motionInvalid':'Motion unavailable: ','local.motionStale':'The model or motion catalog changed. Read the catalog again.',
      'local.motionName.Hello':'Hello','local.motionName.Surprised':'Surprised','local.motionName.Sweat':'Sweat','local.motionName.Heart':'Heart',
    })
    const emptyAdapterSave=()=>({status:'idle',identity:null,catalogGeneration:null,draft:{},error:null})
    const adapterSelection=value=>JSON.stringify([value?.preferences?.modelPath??null,value?.preferences?.modelEntry??null])
    const adapterIdentity=value=>value?.adapterCatalog?JSON.stringify([value.adapterCatalog.modelKey,adapterSelection(value)]):null
    const owns=(object,key)=>Object.prototype.hasOwnProperty.call(object??{},key)
    const globalAdapter=value=>value?.preferences?.globalAdapter??value?.adapterCatalog?.globalAdapter??{}
    const adapterBinding=(binding,kind)=>binding===null?null:kind==='bindings'?{...(binding?.id?{id:binding.id}:{}),reverse:binding?.reverse===true}:{...(binding?.ids?.length?{ids:[...binding.ids].sort()}:{}),reverse:binding?.reverse===true}
    const sameBinding=(left,right,kind)=>JSON.stringify(adapterBinding(left,kind))===JSON.stringify(adapterBinding(right,kind))
    function mergeAdapterDraft(previous,patch){
      const next=patch.reset?{...(owns(previous,'handStyle')?{handStyle:previous.handStyle}:{}),reset:true}:{...previous}
      for(const kind of ['bindings','effects'])if(patch[kind])next[kind]={...(next[kind]??{}),...patch[kind]}
      if(owns(patch,'handStyle'))next.handStyle=patch.handStyle
      return next
    }
    function changedAdapterFields(patch,value,draft={}){
      const next={}
      for(const kind of ['bindings','effects'])for(const [role,binding]of Object.entries(patch[kind]??{})){
        const current=owns(draft[kind],role)?draft[kind][role]:globalAdapter(value)[kind]?.[role]
        if(!sameBinding(binding,current,kind))(next[kind]??={})[role]=binding
      }
      if(owns(patch,'handStyle')&&patch.handStyle!==(draft.handStyle??globalAdapter(value).handStyle??'default'))next.handStyle=patch.handStyle
      if(patch.reset&&(Object.keys(globalAdapter(value).bindings??{}).length||Object.keys(globalAdapter(value).effects??{}).length||Object.keys(draft.bindings??{}).length||Object.keys(draft.effects??{}).length))next.reset=true
      return next
    }
    function adapterWasSaved(value,patch){
      const record=value?.preferences?.globalAdapter
      if(!record)return false
      for(const kind of ['bindings','effects']){
        if(patch.reset&&!patch[kind]&&owns(record,kind))return false
        for(const [role,binding]of Object.entries(patch[kind]??{}))if(!owns(record[kind],role)||!sameBinding(record[kind][role],binding,kind))return false
      }
      return (!owns(patch,'handStyle')||record.handStyle===patch.handStyle)&&(!patch.reset||value.preferences.profilePath===null)
    }
    class OverlayUIController {
      constructor({setTimer=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer=id=>globalThis.clearTimeout(id),document:doc=globalThis.document}={}) {
        this.setTimer=setTimer;this.clearTimer=clearTimer;this.doc=doc;this.listeners=new Set();this.timer=null
        this.connection=null;this.generation=0;this.sequence=0;this.applied=0;this.queue=Promise.resolve();this.calls=new Set();this.edits=new Map();this.editing=null
        this.adapterJob=null;this.adapterCalls=new Set()
        this.snapshot={status:'unavailable',value:null,pending:'',failure:null,feedback:'',adapterSave:emptyAdapterSave()}
        this.visibility=()=>{this.stopPolling();if(this.visible())void this.refresh()}
      }
      visible(){return this.listeners.size>0&&this.doc?.visibilityState!=='hidden'}
      getSnapshot=()=>this.snapshot
      publish(patch){this.snapshot={...this.snapshot,...patch};for(const listener of this.listeners)listener()}
      subscribe=(listener)=>{
        this.listeners.add(listener)
        if(this.listeners.size===1){this.doc?.addEventListener?.('visibilitychange',this.visibility);void this.refresh()}
        return()=>{this.listeners.delete(listener);if(!this.listeners.size){this.doc?.removeEventListener?.('visibilitychange',this.visibility);this.stopPolling();for(const call of this.calls)if(!this.adapterCalls.has(call))call.abort()}}
      }
      attach(connection){
        this.detach();this.connection=connection;this.generation++;this.applied=0
        this.publish({status:'loading',value:null,failure:null});if(this.visible())void this.refresh()
        return()=>{if(this.connection===connection)this.detach()}
      }
      detach(){
        if(this.adapterJob)this.finishAdapter(this.adapterJob,'failed',{code:'disconnected',message:'Desktop management disconnected before saving was confirmed.'})
        this.generation++;this.connection=null;this.refreshing=null;this.edits.clear();this.stopPolling();for(const call of this.calls)call.abort()
        this.publish({status:'unavailable',value:null,pending:''})
      }
      stopPolling(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null}
      schedule(){if(this.timer===null&&this.connection&&this.visible())this.timer=this.setTimer(()=>{this.timer=null;void this.refresh()},1000)}
      async rpc(method,args,signal){
        if(!this.connection)throw Error('Desktop management unavailable')
        const response=await this.connection.rpc.call('/api','gamePlayerOverlay/'+method,{args},signal)
        if(!response.ok)throw Error(response.error?.message??'Host request failed')
        return response.value
      }
      reconcileAdapter(value){
        const save=this.snapshot.adapterSave
        if(!save.identity)return save
        const sameSelection=adapterSelection(value)===this.adapterJob?.selection
        // Polls can observe an intermediate directory while our native commit is
        // active. Only its successful RPC reply may rebase queued edits.
        if(this.adapterJob?.active&&sameSelection&&(!value.adapterCatalog||adapterIdentity(value)===save.identity))return save
        if(adapterIdentity(value)===save.identity&&value.adapterCatalog.generation===save.catalogGeneration)return save
        if(!Object.keys(save.draft).length)return save.status==='saved'&&(!save.confirmedGlobal||save.confirmedGlobal===JSON.stringify(globalAdapter(value)))?{...save,identity:adapterIdentity(value),catalogGeneration:value.adapterCatalog?.generation??null}:emptyAdapterSave()
        if(this.adapterJob){this.adapterJob.canceled=true;this.adapterJob.pending={}}
        return {...save,status:'conflict',draft:{},error:{code:'stale_adapter_catalog',message:'The model or parameter directory changed. Review the current model before editing.'}}
      }
      accept(value,id,generation,{adapterSave}={}){
        if(generation!==this.generation)return false
        const current=this.snapshot.value
        if(current){
          if(value.stateGeneration&&value.stateGeneration===current.stateGeneration){if(value.stateRevision<current.stateRevision)return false}
          else if(id<this.applied&&value.revision<=current.revision)return false
        }
        this.applied=Math.max(id,this.applied);this.publish({status:'ready',value,adapterSave:adapterSave??this.reconcileAdapter(value)});return true
      }
      async refresh(){
        if(!this.connection||!this.visible()||this.refreshing)return
        const generation=this.generation,id=++this.sequence,call=new AbortController();this.calls.add(call);this.refreshing=call
        try{const value=await this.rpc('getState',{},call.signal);if(!call.signal.aborted)this.accept(value,id,generation)}
        catch(error){if(!call.signal.aborted&&generation===this.generation&&id>=this.applied)this.publish({status:'unavailable',failure:error.message})}
        finally{this.calls.delete(call);if(this.refreshing===call)this.refreshing=null;this.schedule()}
      }
      perform(method,args,key,feedback){
        const generation=this.generation
        const run=async()=>{
          if(generation!==this.generation||!this.connection)return
          if(method==='command'&&['selectModel','selectLibraryModel','importModelFile','importModelFolder','retryDisplay'].includes(key)&&this.snapshot.adapterSave.status==='failed'&&Object.keys(this.snapshot.adapterSave.draft).length){this.publish({failure:{code:'adapter_unsaved',message:'Retry saving the global adaptation before switching models.'}});return false}
          const id=++this.sequence,call=new AbortController();this.calls.add(call);this.publish({pending:key,failure:null,feedback:''})
          try{
            const input=method==='updatePreferences'?{...args,revision:this.snapshot.value?.revision??0}:args
            const result=await this.rpc(method,input,call.signal)
            if(!call.signal.aborted&&this.accept(result.state,id,generation))this.publish(result.success?{feedback:result.state?.modelCatalog?'modelChoice':feedback,failure:null}:{feedback:'',failure:result.error??{message:'Operation failed'}})
            return result.success
          }catch(error){if(!call.signal.aborted&&generation===this.generation)this.publish({failure:{message:error.message},feedback:''})}
          finally{this.calls.delete(call);if(generation===this.generation&&this.snapshot.pending===key)this.publish({pending:''})}
        }
        if(key==='cancelLoad'||key==='stopPreview'||key==='stopMotion'||(key==='hide'&&this.snapshot.value?.motion)||(key==='show'&&this.snapshot.value?.motion))return run()
        const result=this.queue.then(run,run);this.queue=result.catch(()=>{});return result
      }
      finishAdapter(job,status,error){
        if(this.adapterJob!==job)return
        const draft=status==='conflict'?{}:mergeAdapterDraft(job.active??{},job.pending)
        job.canceled=true;job.pending={}
        this.publish({adapterSave:{status,identity:job.identity,catalogGeneration:job.catalogGeneration,draft,error},failure:error,feedback:''})
      }
      setAdapter(change){
        const value=this.snapshot.value,catalog=value?.adapterCatalog,identity=adapterIdentity(value)
        if(!this.connection||this.snapshot.status!=='ready'||!catalog||change.catalogGeneration!==catalog.generation){
          this.publish({adapterSave:{...emptyAdapterSave(),status:'conflict',error:{code:'stale_adapter_catalog',message:'Read the current model parameters before editing.'}}})
          return Promise.resolve(false)
        }
        const save=this.snapshot.adapterSave,oldDraft=save.identity===identity&&(save.status==='saving'||save.catalogGeneration===catalog.generation)?save.draft:{}
        const patch=changedAdapterFields(change,value,save.status==='failed'?{}:oldDraft)
        if(!Object.keys(patch).length)return this.adapterJob?.promise??Promise.resolve(true)
        let job=this.adapterJob
        if(!job||job.canceled){
          job={identity,selection:adapterSelection(value),catalogGeneration:catalog.generation,generation:this.generation,pending:{},active:null,canceled:false,promise:null}
          this.adapterJob=job
        }
        if(job.identity!==identity||job.catalogGeneration!==catalog.generation&&!job.active){this.finishAdapter(job,'conflict',{code:'stale_adapter_catalog',message:'The model changed before saving.'});return Promise.resolve(false)}
        job.pending=mergeAdapterDraft(job.pending,job.active?patch:mergeAdapterDraft(oldDraft,patch))
        this.publish({adapterSave:{status:'saving',identity,catalogGeneration:job.catalogGeneration,draft:mergeAdapterDraft(job.active??{},job.pending),error:null},failure:null,feedback:''})
        if(!job.promise){
          job.promise=this.queue.then(()=>this.runAdapter(job),()=>this.runAdapter(job))
          this.queue=job.promise.catch(()=>{})
        }
        return job.promise
      }
      retryAdapter=()=>{
        const save=this.snapshot.adapterSave
        if(save.status!=='failed'||!Object.keys(save.draft).length)return Promise.resolve(false)
        return this.setAdapter({catalogGeneration:save.catalogGeneration,...save.draft})
      }
      async runAdapter(job){
        try{
          while(!job.canceled&&Object.keys(job.pending).length){
            const value=this.snapshot.value
            if(job.generation!==this.generation||!this.connection)return false
            if(adapterIdentity(value)!==job.identity||value.adapterCatalog.generation!==job.catalogGeneration){this.finishAdapter(job,'conflict',{code:'stale_adapter_catalog',message:'The model or parameter directory changed before saving.'});return false}
            job.active=job.pending;job.pending={}
            const id=++this.sequence,call=new AbortController();this.calls.add(call);this.adapterCalls.add(call)
            this.publish({pending:'adapter',failure:null,feedback:''})
            try{
              const result=await this.rpc('updatePreferences',{patch:{modelAdapter:{catalogGeneration:job.catalogGeneration,...job.active}},revision:value.revision},call.signal)
              if(call.signal.aborted||job.canceled||job.generation!==this.generation)return false
              if(!result.success){
                this.accept(result.state,id,job.generation,{adapterSave:this.snapshot.adapterSave})
                const current=this.snapshot.value,error=result.error??{message:'Operation failed'}
                const conflict=['preference_conflict','stale_adapter_catalog','stale_model_resources','stale_model_catalog','library_conflict'].includes(error.code)||adapterIdentity(current)!==job.identity||current.adapterCatalog.generation!==job.catalogGeneration
                this.finishAdapter(job,conflict?'conflict':'failed',error);return false
              }
              if(adapterIdentity(result.state)!==job.identity||!adapterWasSaved(result.state,job.active)){
                this.finishAdapter(job,'conflict',{code:'stale_adapter_catalog',message:'The returned model state does not confirm the saved adaptation.'});return false
              }
              const pending=changedAdapterFields(job.pending,result.state),generation=result.state.adapterCatalog.generation
              const saved={status:Object.keys(pending).length?'saving':'saved',identity:job.identity,catalogGeneration:generation,draft:pending,error:null,confirmedGlobal:JSON.stringify(result.state.preferences.globalAdapter)}
              if(!this.accept(result.state,id,job.generation,{adapterSave:saved})){
                this.finishAdapter(job,'conflict',{code:'preference_conflict',message:'A newer state arrived before saving could be confirmed.'});return false
              }
              job.catalogGeneration=generation;job.active=null;job.pending=pending
            }catch(error){
              if(!job.canceled&&job.generation===this.generation)this.finishAdapter(job,'failed',{code:error.code??'operation_failed',message:String(error.message)})
              return false
            }finally{this.calls.delete(call);this.adapterCalls.delete(call)}
          }
          return !job.canceled
        }finally{
          if(this.adapterJob===job){this.adapterJob=null;if(this.snapshot.pending==='adapter')this.publish({pending:''})}
        }
      }
      set=(key,value)=>{
        if(key==='modelAdapter')return this.setAdapter(value)
        this.edits.set(key,value)
        if(this.editing)return this.editing
        this.editing=(async()=>{while(this.edits.size){const patch=Object.fromEntries(this.edits);this.edits.clear();const ok=await this.perform('updatePreferences',{patch},'preferences','saved');if(!ok){this.edits.clear();break}}})().finally(()=>{this.editing=null})
        return this.editing
      }
      command=(action)=>this.perform('command',{action},typeof action==='object'?action.type:action,'completed')
    }

    function LocalRange({manager,spec,value,disabled,t,resetToken}) {
      const display=spec.key==='opacity'?Math.round(value*100):value
      const [draft,setDraft]=React.useState(String(display)),[invalid,setInvalid]=React.useState(false)
      const focused=React.useRef(false),timer=React.useRef(null),cancelBlur=React.useRef(false)
      React.useEffect(()=>{if(!focused.current)setDraft(String(display))},[display,resetToken])
      React.useEffect(()=>()=>clearTimeout(timer.current),[])
      const commit=(raw=draft)=>{
        clearTimeout(timer.current);const number=Number(raw)
        if(raw.trim()===''||!Number.isFinite(number)||number<spec.min||number>spec.max){setInvalid(true);return}
        setInvalid(false);void manager.set(spec.key,spec.key==='opacity'?number/100:number)
      }
      const change=event=>{const next=event.target.value;setDraft(next);setInvalid(false);clearTimeout(timer.current);timer.current=setTimeout(()=>commit(next),120)}
      const id=React.useId()
      return h('div',{className:'dgp-row'},[
        h('label',{key:'label',className:'dgp-label dgp-localLabel',htmlFor:id},t('local.'+spec.key)),
        h('div',{key:'control',className:'dgp-localRange'},[
          h('input',{key:'range',type:'range',min:spec.min,max:spec.max,step:1,value:Number(draft)||spec.min,disabled,
            'aria-label':t('local.'+spec.key),onChange:change,onFocus:()=>{focused.current=true},onBlur:()=>{focused.current=false},onPointerUp:event=>commit(event.currentTarget.value),onKeyUp:event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Enter'].includes(event.key))commit(event.currentTarget.value)}}),
          h('input',{key:'number',id,type:'number',className:'dgp-input'+(invalid?' dgp-invalid':''),min:spec.min,max:spec.max,value:draft,disabled,
            onFocus:()=>{focused.current=true},onChange:event=>{setDraft(event.target.value);setInvalid(false)},
            onBlur:()=>{focused.current=false;if(cancelBlur.current){cancelBlur.current=false;return}commit()},onKeyDown:event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();event.currentTarget.blur()}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.nativeEvent?.stopImmediatePropagation?.();clearTimeout(timer.current);cancelBlur.current=true;setDraft(String(display));setInvalid(false);event.currentTarget.blur()}}}),
          h('span',{key:'unit',className:'dgp-hint'},spec.key==='opacity'?'%':'DIP'),
          invalid?h('span',{key:'error',className:'dgp-fieldError',role:'alert'},t('local.invalid')):null,
        ]),
      ])
    }
    function modelImportUnavailable(state) {
      if(state.status!=='ready')return 'local.unavailable'
      const value=state.value??{}
      if(!value.enabled)return 'local.disabled'
      if(!value.capabilities?.picker)return 'local.pickerUnavailable'
      if(state.pending||value.loading)return 'local.importBusy'
      return null
    }
    function MotionControls({manager,state,value,t}) {
      const catalog=value.motionCatalog,items=catalog?.items??[],generation=catalog?.generation
      const [selected,setSelected]=React.useState(''),selectId=React.useId()
      React.useEffect(()=>{setSelected(items.find(x=>x.enabled)?.id??items[0]?.id??'')},[generation])
      const chosen=items.find(x=>x.id===selected)??items.find(x=>x.enabled)??items[0]
      const ready=state.status==='ready',supported=ready&&value.capabilities?.management&&value.capabilities?.motions,enabled=supported&&value.enabled
      const safe=value.capabilities?.motionPreview??value.capabilities?.preview
      const busy=Boolean(state.pending)||value.loading||Boolean(value.motion)
      const reason=!ready?'local.unavailable':!value.enabled?'local.disabled':!supported?'local.motionUnavailable':busy?'local.importBusy':null
      const name=item=>{const key='local.motionName.'+item.name,label=t(key);return label===key?item.name:label}
      const play=()=>void manager.command({type:'playMotion',catalogGeneration:generation,motionId:chosen.id})
      return h('div',{className:'dgp-list','aria-label':t('local.motions')},[
        h('h4',{key:'title',className:'dgp-groupTitle'},t('local.motions')),
        h('p',{key:'hint',className:'dgp-hint'},t('local.motionHint')),
        h('div',{key:'controls',className:'dgp-row dgp-localButtons'},[
          h('button',{key:'read',type:'button',className:'dgp-button',disabled:!enabled||busy,title:reason?t(reason):undefined,onClick:()=>void manager.command('refreshMotions')},t('local.refreshMotions')),
          h('label',{key:'label',className:'dgp-label',htmlFor:selectId},t('local.motionNone')),
          h('select',{key:'select',id:selectId,className:'dgp-input',value:chosen?.id??'',disabled:!enabled||busy||!items.length,onChange:event=>setSelected(event.target.value)},items.length?items.map(item=>h('option',{key:item.id,value:item.id},name(item)+(item.enabled?'':' · '+t('local.motionInvalid')))):h('option',{value:''},t('local.motionNone'))),
          h('button',{key:'play',type:'button',className:'dgp-button',disabled:!enabled||busy||!chosen?.enabled||!safe,title:reason?t(reason):!safe?t('local.unsafe'):chosen?.error,onClick:play},t('local.playMotion')),
          value.motion?h('button',{key:'stop',type:'button',className:'dgp-button',disabled:!ready,onClick:()=>void manager.command('stopMotion')},t('local.stopMotion')):null,
        ]),
        value.motion?h('p',{key:'playing',className:'dgp-status','aria-live':'polite'},[t(value.motion.phase==='playing'?'local.motionPlaying':'local.motionLoading'),' · ',name(value.motion),' · ',Math.ceil((value.motion.durationMs??0)/1000),'s']):null,
        reason&&!busy?h('p',{key:'reason',className:'dgp-status'},t(reason)):null,
        !catalog?h('p',{key:'unread',className:'dgp-hint'},t('local.motionUnread')):!items.length?h('p',{key:'empty',className:'dgp-hint'},t('local.motionEmpty')):null,
        chosen&&!chosen.enabled?h('p',{key:'invalid',className:'dgp-status'},t('local.motionInvalid')+chosen.error):null,
      ])
    }
    Object.assign(zh, {
      'local.discovering':'读取模型包','local.selectingModel':'验证所选模型','local.readingAdapter':'读取模型参数',
      'local.modelChoice':'请选择要导入的模型','local.modelChoose':'确认导入所选模型','local.modelCancel':'取消选择',
      'local.modelCandidatesHint':'发现多个模型，请明确选择。旧模型会保留到新模型验证和保存成功。',
      'local.adapterTitle':'全局参数适配','local.adapterUnsaved':'全局适配尚未保存，请先重试保存，再切换模型。','local.adapterEffective':'当前模型生效：','local.adapterFallback':'全局选项不兼容，当前模型自动兜底：','local.refreshAdapter':'读取模型参数','local.adapterHint':'参数选择、反向和手部样式由所有模型共用。不兼容项目自动识别兜底，不会改写全局选择。读取参数不会显示桌宠。',
      'local.adapterUnavailable':'当前显示程序不支持参数适配，请更新并重启宿主；键盘后备不提供这些能力。',
      'local.adapterUnread':'尚未读取当前模型参数。','local.adapterSave':'保存适配','local.adapterReset':'恢复自动识别',
      'local.adapterNone':'不启用','local.adapterReverse':'反向','local.adapterAuto':'自动识别','local.adapterManual':'手动适配','local.adapterJson':'适配 JSON',
      'local.adapterMissing':'模型没有提供对应能力','local.adapterInvisible':'参数存在，但没有可见效果','local.adapterReserved':'该参数由键鼠联动使用',
      'local.adapterStyle':'手部图片样式','local.adapterStyle.default':'原包默认','local.adapterStyle.labels':'有按键显示','local.adapterStyle.no-labels':'无按键显示',
      'local.adapterInputs':'键鼠联动','local.adapterEffects':'自动效果','local.adapterDraft':'有未保存的适配修改。',
      'local.adapterChanged':'模型或参数目录已变化，未保存的修改已清除，请确认后重新设置。','local.adapterStale':'模型或参数目录已变化，请重新读取参数后再保存。',
      'local.adapterBounds':'范围／默认值','local.adapter.role.keyboard':'键盘按下','local.adapter.role.mouseX':'鼠标横向移动','local.adapter.role.mouseY':'鼠标纵向移动',
      'local.adapter.role.left':'鼠标左键','local.adapter.role.right':'鼠标右键','local.adapter.role.middle':'鼠标中键','local.adapter.role.wheel':'滚轮',
      'local.adapter.role.blink':'眨眼（可多选）','local.adapter.role.breath':'呼吸','local.adapter.role.headX':'头部左右','local.adapter.role.headY':'头部上下','local.adapter.role.headZ':'头部倾斜',
      'local.adapter.role.bodyX':'身体左右','local.adapter.role.bodyY':'身体反馈','local.adapter.role.bodyZ':'身体倾斜',
      'local.modelStale':'候选模型或资源已变化，请重新导入。','local.modelResourcesStale':'模型资源已变化，请重新读取或加载。',
    })
    Object.assign(en, {
      'local.discovering':'Reading model package','local.selectingModel':'Validating selected model','local.readingAdapter':'Reading model parameters',
      'local.modelChoice':'Choose a model to import','local.modelChoose':'Import selected model','local.modelCancel':'Cancel selection',
      'local.modelCandidatesHint':'Multiple models were found. Select explicitly; the previous model remains until validation and saving succeed.',
      'local.adapterTitle':'Global model adaptation','local.adapterUnsaved':'Global adaptation is not saved. Retry saving before switching models.','local.adapterEffective':'Effective on this model:','local.adapterFallback':'Global setting unavailable; model fallback:','local.refreshAdapter':'Read model parameters','local.adapterHint':'Bindings, reversal and hand artwork are shared by all models. Unsupported settings fall back without changing global preferences. Reading parameters never shows the pet.',
      'local.adapterUnavailable':'This display runtime does not provide adaptation. Update and restart the Host; keyboard fallback has no parameter catalog.',
      'local.adapterUnread':'Current model parameters have not been read.','local.adapterSave':'Save adaptation','local.adapterReset':'Restore automatic detection',
      'local.adapterNone':'Disabled','local.adapterReverse':'Reverse','local.adapterAuto':'Automatic','local.adapterManual':'Manual','local.adapterJson':'Adapter JSON',
      'local.adapterMissing':'Not provided by the model','local.adapterInvisible':'Parameter exists but has no visible effect','local.adapterReserved':'Parameter is owned by input',
      'local.adapterStyle':'Hand artwork','local.adapterStyle.default':'Original','local.adapterStyle.labels':'Key labels','local.adapterStyle.no-labels':'No key labels',
      'local.adapterInputs':'Input feedback','local.adapterEffects':'Automatic effects','local.adapterDraft':'Adaptation changes have not been saved.',
      'local.adapterChanged':'The model/catalog changed; unsaved changes were cleared. Review the current model before editing.','local.adapterStale':'The model/catalog changed. Read the parameters again before saving.',
      'local.adapterBounds':'Range / default','local.adapter.role.keyboard':'Keyboard press','local.adapter.role.mouseX':'Mouse horizontal','local.adapter.role.mouseY':'Mouse vertical',
      'local.adapter.role.left':'Left mouse button','local.adapter.role.right':'Right mouse button','local.adapter.role.middle':'Middle mouse button','local.adapter.role.wheel':'Wheel',
      'local.adapter.role.blink':'Blink (multiple parameters)','local.adapter.role.breath':'Breathing','local.adapter.role.headX':'Head left/right','local.adapter.role.headY':'Head up/down','local.adapter.role.headZ':'Head tilt',
      'local.adapter.role.bodyX':'Body left/right','local.adapter.role.bodyY':'Body feedback','local.adapter.role.bodyZ':'Body tilt',
      'local.modelStale':'Model candidates/resources changed. Import again.','local.modelResourcesStale':'Model resources changed. Read or reload them again.',
    })
    function ModelCandidateControls({manager,state,value,t}) {
      const catalog=value.modelCatalog,items=catalog?.items??[],[selection,setSelected]=React.useState({generation:null,id:''}),id=React.useId()
      const selected=selection.generation===catalog?.generation?selection.id:''
      React.useEffect(()=>setSelected({generation:catalog?.generation,id:''}),[catalog?.generation])
      if(!catalog)return null
      const busy=!!state.pending||value.loading,enabled=state.status==='ready'&&value.enabled&&value.capabilities?.picker,chosen=items.find(x=>x.id===selected)
      return h('div',{className:'dgp-list','aria-label':t('local.modelChoice')},[
        h('p',{key:'hint',className:'dgp-hint'},t('local.modelCandidatesHint')),
        h('div',{key:'choices',className:'dgp-row dgp-localButtons'},[
          h('label',{key:'label',className:'dgp-label',htmlFor:id},t('local.modelChoice')),
          h('select',{key:'model-select',id,className:'dgp-input',value:selected,disabled:!enabled||busy,onChange:event=>setSelected({generation:catalog.generation,id:event.target.value})},[
            h('option',{key:'empty',value:''},t('local.modelChoice')),...items.map(item=>h('option',{key:item.id,value:item.id,disabled:!item.enabled},item.name+(item.enabled?'':' · '+item.error))),
          ]),
          h('button',{key:'model-confirm',className:'dgp-button',type:'button',disabled:!enabled||busy||!chosen?.enabled,onClick:()=>void manager.command({type:'selectModel',catalogGeneration:catalog.generation,modelId:chosen.id,revision:value.revision})},t('local.modelChoose')),
          h('button',{key:'model-cancel',className:'dgp-button',type:'button',disabled:state.status!=='ready',onClick:()=>void manager.command('cancelLoad')},t('local.modelCancel')),
        ]),
      ])
    }
    Object.assign(zh,{
      'local.adapterAutoSave':'修改会自动应用并保存；看到“已保存”后可退出或重启。',
      'local.adapterPending':'待保存的适配修改','local.adapterSaving':'正在保存适配设置…','local.adapterSaved':'适配设置已保存。',
      'local.adapterSaveFailed':'适配设置保存失败，修改尚未保存。','local.adapterRetry':'重试保存',
      'local.adapterChanged':'模型或参数目录已变化，未保存的修改未重放。请确认当前模型后重新设置。',
    })
    Object.assign(en,{
      'local.adapterAutoSave':'Changes are applied and saved automatically. Wait for “Saved” before exiting or restarting.',
      'local.adapterPending':'Unsaved adaptation changes','local.adapterSaving':'Saving adaptation…','local.adapterSaved':'Adaptation saved.',
      'local.adapterSaveFailed':'Adaptation could not be saved. Your changes are not saved.','local.adapterRetry':'Retry saving',
      'local.adapterChanged':'The model or parameter directory changed. Unsaved edits were not replayed; review the current model before editing.',
    })
    function ModelAdapterControls({manager,state,value,t}) {
      const catalog=value.adapterCatalog,id=React.useId(),save=state.adapterSave??emptyAdapterSave()
      const desired=globalAdapter(value)
      const draft=save.identity===adapterIdentity(value)&&(save.status==='saving'||save.catalogGeneration===catalog?.generation)?save.draft:{}
      const supported=state.status==='ready'&&value.capabilities?.management&&value.capabilities?.adaptation,enabled=supported&&value.enabled
      const busy=!!state.pending&&state.pending!=='adapter'||value.loading||!!value.motion||!!value.previewing
      const reason=state.status!=='ready'?'local.unavailable':!value.enabled?'local.disabled':!supported?'local.adapterUnavailable':busy?'local.importBusy':null
      const setBinding=(kind,role,binding)=>void manager.set('modelAdapter',{catalogGeneration:catalog.generation,[kind]:{[role]:binding}})
      const changed=Object.keys(draft).length>0,parameters=catalog?.parameters??[],inputOwners=new Set()
      for(const input of catalog?.inputs??[]){const own=Object.prototype.hasOwnProperty.call(draft.bindings??{},input.role),binding=own?draft.bindings[input.role]:input;if(binding!==null&&(binding?.id??input.id))inputOwners.add(binding?.id??input.id)}
      const errorText=error=>error==='Parameter has no visible effect in this model'?t('local.adapterInvisible'):error==='Parameter is owned by input'?t('local.adapterReserved'):error?.startsWith('Model does not provide')?t('local.adapterMissing'):error
      const row=(kind,current)=>{
        const own=Object.prototype.hasOwnProperty.call(draft[kind]??{},current.role),binding=own?draft[kind][current.role]:desired[kind]?.[current.role],multiple=kind==='effects'&&current.role==='blink'
        const selected=kind==='bindings'?(binding?.id??''):(binding?.ids??[]),ids=Array.isArray(selected)?selected:selected?[selected]:[],reverse=binding?.reverse===true,automatic=binding!==null&&!ids.length,selectId=id+'-'+kind+'-'+current.role
        const label=parameter=>parameter.name===parameter.id?parameter.id:parameter.name+' ('+parameter.id+')'
        const choices=parameters.map(p=>h('option',{key:p.id,value:p.id,disabled:p.min===p.max||p.id==='Paramshuiying'||kind==='effects'&&inputOwners.has(p.id)},label(p)))
        for(const missing of ids.filter(pid=>!parameters.some(p=>p.id===pid)))choices.push(h('option',{key:missing,value:missing,disabled:true},missing+' · '+t('local.adapterMissing')))
        const change=event=>{const picks=multiple?Array.from(event.target.selectedOptions??[],o=>o.value):[event.target.value];const clean=picks.filter(Boolean);setBinding(kind,current.role,picks.includes('@auto')?{reverse}:picks.includes('')||!clean.length?null:kind==='bindings'?{id:clean[0],reverse}:{ids:clean,reverse})}
        const flip=event=>setBinding(kind,current.role,automatic?{reverse:event.target.checked}:!ids.length?null:kind==='bindings'?{id:ids[0],reverse:event.target.checked}:{ids:[...ids],reverse:event.target.checked})
        return h('div',{key:kind+'-'+current.role,className:'dgp-row dgp-adapterRow'},[
          h('div',{key:'text',className:'dgp-text'},[h('label',{key:'label',className:'dgp-label',htmlFor:selectId},t('local.adapter.role.'+current.role)),h('span',{key:'source',className:'dgp-hint'},own?t('local.adapterPending'):t('local.adapter'+(binding===null||binding?.id||binding?.ids?'Manual':'Auto'))),h('span',{key:'effective',className:'dgp-hint'},t('local.adapterEffective')+' '+(current.id??current.ids?.join(', ')??t('local.adapterNone'))),!own&&current.error?h('span',{key:'error',className:'dgp-hint'},errorText(current.error)):null]),
          h('div',{key:'actions',className:'dgp-actions dgp-adapterActions'},[
            h('select',{key:'parameter',id:selectId,className:'dgp-input',multiple,value:multiple?(automatic?['@auto']:ids.length?ids:['']):automatic?'@auto':ids[0]??'',disabled:!enabled||busy,onChange:change},[h('option',{key:'auto',value:'@auto'},t('local.adapterAuto')),h('option',{key:'none',value:''},t('local.adapterNone')),...choices]),
            h('label',{key:'reverse',className:'dgp-hint'},[h('input',{key:'check',type:'checkbox',checked:reverse,disabled:!enabled||busy||binding===null,onChange:flip}),t('local.adapterReverse')]),
          ]),
        ])
      }
      return h('div',{className:'dgp-list','aria-label':t('local.adapterTitle')},[
        h('h4',{key:'title',className:'dgp-groupTitle'},t('local.adapterTitle')),h('p',{key:'hint',className:'dgp-hint'},t('local.adapterHint')),
        h('div',{key:'buttons',className:'dgp-row dgp-localButtons'},[
          h('button',{key:'adapter-read',type:'button',className:'dgp-button',disabled:!enabled||busy||save.status==='saving',title:reason?t(reason):undefined,onClick:()=>void manager.command('refreshAdapter')},t('local.refreshAdapter')),
          save.status==='failed'&&changed?h('button',{key:'adapter-retry',type:'button',className:'dgp-button',disabled:!enabled||busy||!catalog,onClick:()=>void manager.retryAdapter()},t('local.adapterRetry')):null,
          h('button',{key:'adapter-reset',type:'button',className:'dgp-button',disabled:!enabled||busy||!catalog||save.status==='saving',onClick:()=>void manager.set('modelAdapter',{catalogGeneration:catalog.generation,reset:true})},t('local.adapterReset')),
        ]),
        reason?h('p',{key:'reason',className:'dgp-status'},t(reason)):null,
        !catalog?h('p',{key:'unread',className:'dgp-hint'},t('local.adapterUnread')):[
          h('div',{key:'hand-style',className:'dgp-row'},[h('label',{key:'label',className:'dgp-label',htmlFor:id+'-style'},t('local.adapterStyle')),h('select',{key:'style',id:id+'-style',className:'dgp-input',value:draft.handStyle??desired.handStyle??'default',disabled:!enabled||busy||!value.capabilities?.handStyles,onChange:event=>void manager.set('modelAdapter',{catalogGeneration:catalog.generation,handStyle:event.target.value})},['default','labels','no-labels'].map(style=>({id:style})).map(s=>h('option',{key:s.id,value:s.id,disabled:!(catalog.handStyles??[]).some(item=>item.id===s.id)},t('local.adapterStyle.'+s.id))))]),
          h('h4',{key:'inputs',className:'dgp-groupTitle'},t('local.adapterInputs')),...(catalog.inputs??[]).map(i=>row('bindings',i)),
          h('h4',{key:'effects',className:'dgp-groupTitle'},t('local.adapterEffects')),...(catalog.effects??[]).map(e=>row('effects',e)),
          ...(catalog.fallbacks??[]).map((fallback,i)=>h('p',{key:'fallback-'+i,className:'dgp-status'},t('local.adapterFallback')+' '+t(fallback.kind==='handStyle'?'local.adapterStyle':'local.adapter.role.'+fallback.role)+' → '+(Array.isArray(fallback.effective)?fallback.effective.join(', '):fallback.effective??t('local.adapterNone')))),
          ...(catalog.warnings??[]).map((warning,i)=>h('p',{key:'warning-'+i,className:'dgp-hint'},warning)),
        ],
        h('p',{key:'adapter-status',className:'dgp-status'+(['failed','conflict'].includes(save.status)?' dgp-error':''),'aria-live':'polite',role:['failed','conflict'].includes(save.status)?'alert':'status'},
          save.status==='saving'?t('local.adapterSaving'):save.status==='saved'?t('local.adapterSaved'):save.status==='conflict'?t('local.adapterChanged'):save.status==='failed'?t('local.adapterSaveFailed')+' '+(save.error?.message??''):t('local.adapterAutoSave')),
      ])
    }
    Object.assign(zh,{
      'local.library':'我的桌宠','local.libraryHint':'添加的模型复制到本机模型库。点击选择立即显示，重启自动恢复。',
      'local.addLibraryFile':'添加模型／ZIP','local.addLibraryFolder':'添加模型文件夹','local.libraryChoose':'选择并显示','local.libraryCurrent':'当前桌宠',
      'local.libraryDisplaying':'正在显示','local.libraryRemove':'移除','local.libraryRemoveConfirm':'从模型库移除？原始模型文件不会被删除：',
      'local.libraryAddSelected':'添加勾选模型','local.libraryCandidates':'选择要加入模型库的模型','local.libraryCandidateHint':'默认勾选有效模型；添加不会替换当前桌宠。',
      'local.libraryLimit':'最多 32 个桌宠，包含默认模型。','local.libraryUnavailable':'模型库功能需要 0.3.0 运行时，请更新并重启宿主。',
      'local.libraryHidden':'已选中 · 未显示','local.libraryMissing':'托管资源缺失，请重新添加','local.libraryConflict':'模型库已被其他操作更新，请刷新后重试。',
      'local.libraryAdvanced':'高级：手动参数、动作与显示','local.copyingModels':'正在复制并校验模型…','local.selectingLibrary':'正在切换桌宠…',
      'local.removingModel':'正在移除桌宠…','local.libraryModelView':'桌宠视图','local.libraryKeyboardView':'键盘视图',
    })
    Object.assign(en,{
      'local.library':'My desktop pets','local.libraryHint':'Models are copied into a local library. Select to show immediately; your last pet returns after restart.',
      'local.addLibraryFile':'Add model / ZIP','local.addLibraryFolder':'Add model folder','local.libraryChoose':'Select and show','local.libraryCurrent':'Current pet',
      'local.libraryDisplaying':'Showing','local.libraryRemove':'Remove','local.libraryRemoveConfirm':'Remove from the library? Original files will not be deleted:',
      'local.libraryAddSelected':'Add checked models','local.libraryCandidates':'Choose models to add','local.libraryCandidateHint':'Valid models are checked by default. Adding does not replace your current pet.',
      'local.libraryLimit':'Up to 32 pets including the default model.','local.libraryUnavailable':'The library requires the 0.3.0 runtime. Update and restart the Host.',
      'local.libraryHidden':'Selected · hidden','local.libraryMissing':'Managed files are missing; add the model again','local.libraryConflict':'The library changed elsewhere. Refresh and retry.',
      'local.libraryAdvanced':'Advanced: manual parameters, motions and display','local.copyingModels':'Copying and validating models…','local.selectingLibrary':'Switching desktop pet…',
      'local.removingModel':'Removing desktop pet…','local.libraryModelView':'Pet view','local.libraryKeyboardView':'Keyboard view',
    })
    function LibraryCandidateControls({manager,state,value,t}) {
      const catalog=value.libraryCatalog,[draft,setDraft]=React.useState({generation:null,ids:[]})
      if(!catalog)return null
      const items=catalog.items??[],ids=draft.generation===catalog.generation?draft.ids:items.filter(i=>i.enabled).slice(0,31).map(i=>i.id)
      const busy=!!state.pending||value.loading,ready=state.status==='ready'
      const toggle=(id,checked)=>setDraft({generation:catalog.generation,ids:checked?[...ids.filter(x=>x!==id),id]:ids.filter(x=>x!==id)})
      return h('fieldset',{className:'dgp-libraryCandidates'},[
        h('legend',{key:'title',className:'dgp-label'},t('local.libraryCandidates')),
        h('p',{key:'hint',className:'dgp-hint'},t('local.libraryCandidateHint')),
        ...items.map(item=>h('label',{key:item.id,className:'dgp-libraryCandidate'},[
          h('input',{key:'check',type:'checkbox',checked:ids.includes(item.id),disabled:!ready||busy||!item.enabled,onChange:e=>toggle(item.id,e.target.checked)}),
          h('span',{key:'name',className:'dgp-text'},[h('span',{key:'label'},item.name),h('span',{key:'detail',className:'dgp-hint'},item.error??item.entry)]),
        ])),
        h('div',{key:'actions',className:'dgp-localButtons'},[
          h('button',{key:'library-add-confirm',type:'button',className:'dgp-button',disabled:!ready||busy||!ids.length||ids.length>31,onClick:()=>void manager.command({type:'addLibraryModels',catalogGeneration:catalog.generation,modelIds:ids,libraryRevision:value.modelLibrary?.revision??0})},t('local.libraryAddSelected')),
          h('button',{key:'library-cancel',type:'button',className:'dgp-button',disabled:!ready,onClick:()=>void manager.command('cancelLoad')},t('local.modelCancel')),
        ]),
      ])
    }
    function ModelLibraryControls({manager,state,value,t}) {
      const library=value.modelLibrary??{revision:0,items:[]},ready=state.status==='ready',busy=!!state.pending||value.loading||!!value.motion
      const canAdd=ready&&value.capabilities?.library&&!busy&&!value.libraryError
      const select=item=>void manager.command({type:'selectLibraryModel',modelId:item.id,libraryRevision:library.revision,revision:value.revision})
      const remove=item=>{if(globalThis.confirm?.(t('local.libraryRemoveConfirm')+' '+item.name)===true)void manager.command({type:'removeLibraryModel',modelId:item.id,libraryRevision:library.revision,revision:value.revision})}
      return h('div',{className:'dgp-library'},[
        h('div',{key:'heading',className:'dgp-row'},[
          h('div',{key:'text',className:'dgp-text'},[h('h4',{key:'title',className:'dgp-label'},t('local.library')),h('p',{key:'hint',className:'dgp-hint'},t('local.libraryHint'))]),
          h('div',{key:'add',className:'dgp-localButtons'},['addLibraryFile','addLibraryFolder'].map(action=>h('button',{key:action,type:'button',className:'dgp-button',disabled:!canAdd,onClick:()=>void manager.command(action)},t('local.'+action)))),
        ]),
        ready&&!value.capabilities?.library?h('p',{key:'unsupported',className:'dgp-status'},t('local.libraryUnavailable')):null,
        h('div',{key:'items',className:'dgp-libraryItems','aria-label':t('local.library')},library.items.map(item=>{
          const active=value.activeModelId===item.id,showing=active&&value.visible&&value.view!=='keyboard'&&value.modelLoaded===true&&value.renderer==='live2d'
          return h('article',{key:item.id,className:'dgp-row dgp-libraryItem'+(active?' dgp-libraryActive':'')},[
            h('span',{key:'avatar',className:'dgp-libraryAvatar','aria-hidden':true},'🐾'),
            h('div',{key:'text',className:'dgp-text'},[
              h('span',{key:'name',className:'dgp-label'},item.name),
              h('span',{key:'status',className:'dgp-hint'},!item.available?t('local.libraryMissing'):active?t(showing?'local.libraryDisplaying':'local.libraryHidden'):item.entry??t('local.default')),
              active?h('span',{key:'badge',className:'dgp-libraryBadge'},t('local.libraryCurrent')):null,
            ]),
            h('div',{key:'actions',className:'dgp-localButtons'},[
              h('button',{key:'library-select-'+item.id,type:'button',className:'dgp-button',disabled:!ready||!value.enabled||!value.capabilities?.library||busy||!item.available||!!value.libraryError||showing,'aria-pressed':active,title:!value.enabled?t('local.disabled'):!item.available?t('local.libraryMissing'):undefined,onClick:()=>select(item)},t(showing?'local.libraryDisplaying':'local.libraryChoose')),
              !item.builtin?h('button',{key:'library-remove-'+item.id,type:'button',className:'dgp-button',disabled:!ready||busy||!!value.libraryError,onClick:()=>remove(item)},t('local.libraryRemove')):null,
            ]),
          ])
        })),
        h(LibraryCandidateControls,{key:'candidates',manager,state,value,t}),
        h('div',{key:'view',className:'dgp-row dgp-localButtons'},['model','keyboard'].map(view=>h('button',{key:'library-view-'+view,type:'button',className:'dgp-button','aria-pressed':value.view===view,disabled:!ready||!value.enabled||busy,onClick:()=>void manager.command({type:'setDisplayView',view,revision:value.revision})},t(view==='model'?'local.libraryModelView':'local.libraryKeyboardView')))),
        (value.loading||['selectLibraryModel','addLibraryModels','addLibraryFile','addLibraryFolder','show','retryDisplay'].includes(state.pending))?h('button',{key:'library-stop-load',type:'button',className:'dgp-button',disabled:!ready,onClick:()=>void manager.command('cancelLoad')},t('local.modelCancel')):null,
        value.libraryError?h('p',{key:'error',className:'dgp-status dgp-error',role:'alert'},value.libraryError):null,
        h('p',{key:'limit',className:'dgp-hint'},t('local.libraryLimit')),
      ])
    }
    function OverlayControls({manager,t}) {
      const state=React.useSyncExternalStore(manager.subscribe,manager.getSnapshot,manager.getSnapshot)
      const value=state.value??{},prefs=value.preferences??{},ready=state.status==='ready',supported=ready&&value.capabilities?.management
      const enabled=supported&&value.enabled,processing=Boolean(state.pending)||value.loading
      const command=action=>void manager.command(action),importUnavailable=modelImportUnavailable(state)
      const button=(action,disabled=false,reason)=>h('button',{key:action,type:'button',className:'dgp-button',disabled:!ready||disabled,title:reason?t(reason):undefined,onClick:()=>command(action)},t('local.'+action))
      const error=state.failure?.code==='adapter_unsaved'?t('local.adapterUnsaved'):state.failure?.code==='stale_adapter_catalog'?t('local.adapterStale'):state.failure?.code==='stale_model_catalog'?t('local.modelStale'):state.failure?.code==='stale_model_resources'?t('local.modelResourcesStale'):state.failure?.code==='stale_motion_catalog'?t('local.motionStale'):state.failure?.code==='library_conflict'?t('local.libraryConflict'):state.failure?.code==='preference_conflict'?t('local.conflict'):state.failure?.code==='unsafe_preview'?t('local.unsafe'):(typeof state.failure==='string'?state.failure:state.failure?.message)
      const file=(label,path,actions)=>h('div',{key:label,className:'dgp-row dgp-localFile'},[
        h('div',{key:'text',className:'dgp-text'},[h('span',{key:'label',className:'dgp-label'},t('local.'+label)),h('span',{key:'path',className:'dgp-path',title:path??''},path??t(label==='image'?'local.emptyImage':'local.default'))]),
        h('div',{key:'actions',className:'dgp-localButtons'},actions),
      ])
      return h('section',{className:'dgp-group','aria-label':t('local.title')},[
        h('h3',{key:'title',className:'dgp-groupTitle'},t('local.title')),
        h('p',{key:'hint',className:'dgp-hint'},t('local.hint')),
        h('div',{key:'body',className:'dgp-list'},[
          h('div',{key:'state',className:'dgp-row dgp-localStatus','aria-live':'polite'},[
            h('strong',{key:'phase'},ready?t('local.'+(value.phase??'not-started')):t('local.unavailable')),
            ready?h('span',{key:'renderer',className:'dgp-hint'},[value.renderer??'—',' · ',t(value.visible?'local.visible':'local.hidden')]):null,
            value.modelLoaded&&value.modelName?h('span',{key:'modelName',className:'dgp-hint',title:value.modelPath??''},value.modelName):null,
            value.previewing?h('span',{key:'preview',className:'dgp-hint'},t('local.preview')):null,
            value.stage?h('span',{key:'stage',className:'dgp-hint'},t('local.stage.'+value.stage)):null,
          ]),
          h(ModelLibraryControls,{key:'library',manager,state,value,t}),
          file('model',prefs.modelPath??value.modelPath,[button('importModelFile',Boolean(importUnavailable),importUnavailable),button('importModelFolder',Boolean(importUnavailable),importUnavailable)]),
          importUnavailable?h('p',{key:'importLimit',className:'dgp-status'},t(importUnavailable)):(!value.capabilities?.model?h('p',{key:'importRecovery',className:'dgp-hint'},t('local.importRecovery')):null),
          h(ModelCandidateControls,{key:'modelCandidates',manager,state,value,t}),
          file('profile',Object.keys(globalAdapter(value).bindings??{}).length?t('local.globalProfile'):prefs.profilePath,[button('importProfile',Boolean(importUnavailable),importUnavailable),button('clearProfile',!enabled||(!prefs.profilePath&&!Object.keys(globalAdapter(value).bindings??{}).length)||processing)]),
          h('details',{key:'advanced',className:'dgp-libraryAdvanced',open:false},[
          h('summary',{key:'summary',className:'dgp-label'},t('local.libraryAdvanced')),
          h(ModelAdapterControls,{key:'adapter',manager,state,value,t}),
          h(MotionControls,{key:'motions',manager,state,value,t}),
          file('image',prefs.keyboardImage,[button('importKeyboardImage',!enabled||processing),button('clearKeyboardImage',!enabled||!prefs.keyboardImage||processing)]),
          ...[{key:'widthDip',min:220,max:1000,fallback:420},{key:'keyboardWidthDip',min:450,max:1350,fallback:900},{key:'opacity',min:45,max:100,fallback:1}].map(spec=>h(LocalRange,{key:spec.key,manager,spec,value:prefs[spec.key]??spec.fallback,disabled:!supported||value.loading,t,resetToken:JSON.stringify(state.failure)})),
          ]),
          h('div',{key:'buttons',className:'dgp-row dgp-localButtons'},[
            button(value.visible?'hide':'show',!enabled||(processing&&!value.motion)),button(value.adjusting?'endAdjust':'beginAdjust',!enabled||processing),
            button('resetLayout',!supported||processing),button('reloadModel',!enabled||!value.capabilities?.model||processing),button('retryDisplay',!value.enabled||processing),
            button('preview',!value.enabled||!value.capabilities?.preview||processing),
            value.previewing&&!value.motion?button('stopPreview',false):null,value.loading?button('cancelLoad',false):null,
          ]),
        ]),
        !ready?h('p',{key:'unavailable',className:'dgp-status'},t('local.unavailable')):null,
        ready&&!value.enabled?h('p',{key:'disabled',className:'dgp-status'},t('local.disabled')):null,
        ready&&!supported?h('p',{key:'limit',className:'dgp-status'},t('local.runtimeLimit')):null,
        value.preferenceError||value.error?h('p',{key:'runtimeError',className:'dgp-status dgp-error',role:'alert'},value.preferenceError||value.error):null,
        error?h('p',{key:'error',className:'dgp-status dgp-error',role:'alert'},error):null,
        h('p',{key:'feedback',className:'dgp-status','aria-live':'polite'},state.pending?t('local.pending'):(state.feedback?t('local.'+state.feedback):'')),
      ])
    }

    const CSS = `
.dgp-button{font:inherit;font-size:12px;padding:6px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);cursor:pointer}.dgp-button:disabled{opacity:.5;cursor:default}.dgp-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dgp-localButtons{display:flex;flex-wrap:wrap;gap:8px}.dgp-path{font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-label-secondary)}.dgp-localFile{align-items:center;flex-wrap:wrap}.dgp-localFile .dgp-text{min-width:200px}.dgp-localRange{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;flex:1;min-width:240px}.dgp-localRange input[type=range]{flex:1;min-width:100px;max-width:280px;accent-color:var(--dsw-alias-brand-primary)}.dgp-localLabel{min-width:130px}.dgp-localStatus{align-items:center;flex-wrap:wrap}.dgp-adapterRow{flex-wrap:wrap}.dgp-adapterActions{flex-wrap:wrap;max-width:100%}.dgp-adapterActions select{max-width:400px;min-width:180px}.dgp-adapterActions select[multiple]{min-height:70px}.dgp-page{display:flex;flex-direction:column;gap:18px;max-width:960px;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.dgp-group{display:flex;flex-direction:column;gap:6px}
.dgp-library{padding:4px 0}.dgp-libraryItems{margin:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}.dgp-libraryItem{align-items:center;flex-wrap:wrap}.dgp-libraryActive{background:var(--dsw-alias-bg-layer-2)}.dgp-libraryAvatar{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:23px}.dgp-libraryBadge{font-size:11px;color:var(--dsw-alias-brand-primary)}.dgp-libraryCandidates{margin:12px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px}.dgp-libraryCandidate{display:flex;align-items:flex-start;gap:10px;margin:10px 0;overflow-wrap:anywhere}.dgp-libraryAdvanced{margin:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px}.dgp-libraryAdvanced>summary{padding:12px;cursor:pointer}.dgp-library h4,.dgp-library p{margin:0}.dgp-library>.dgp-hint{padding:6px 16px}.dgp-library .dgp-localButtons{flex-wrap:wrap}.dgp-groupTitle{font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:0}
.dgp-list{border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dgp-row{display:flex;align-items:flex-start;gap:16px;padding:14px 16px;box-sizing:border-box}
.dgp-row + .dgp-row{border-top:0.5px solid var(--dsw-alias-border-l1)}
.dgp-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.dgp-label{font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}
.dgp-hint{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dgp-actions{flex:none;display:flex;align-items:center;gap:10px;padding-top:2px}
.dgp-number{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dgp-fieldError{font-size:12px;line-height:16px;max-width:190px;text-align:right;color:var(--dsw-alias-state-error-primary)}
.dgp-switch{flex:none;appearance:none;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:999px;width:40px;height:22px;padding:2px;margin:0;cursor:pointer;display:inline-flex;align-items:center;transition:background .16s ease,border-color .16s ease;box-sizing:border-box}
.dgp-switch.dgp-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dgp-knob{width:17px;height:17px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(0,0,0,.24);transition:transform .16s ease;transform:translateX(0)}
.dgp-switch.dgp-on .dgp-knob{transform:translateX(18px)}
.dgp-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dgp-input,.dgp-select{font:inherit;font-size:13px;line-height:18px;padding:4px 8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;box-sizing:border-box}
.dgp-input{width:100px;text-align:right}
.dgp-select{width:150px;cursor:pointer}
.dgp-input:focus-visible,.dgp-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dgp-input.dgp-invalid{border-color:var(--dsw-alias-state-error-primary)}
.dgp-switch:disabled,.dgp-input:disabled,.dgp-select:disabled{opacity:.5;cursor:default}
.dgp-reset{font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:none;border:0;padding:0;margin:0;cursor:pointer;text-decoration:underline}
.dgp-reset:hover{color:var(--dsw-alias-label-primary)}
.dgp-reset:disabled{opacity:.5;cursor:default;text-decoration:none}
.dgp-status{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0}
.dgp-status.dgp-error{color:var(--dsw-alias-state-error-primary)}
.dgp-danger{display:flex;align-items:flex-start;gap:8px;padding:10px 14px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12.5px;line-height:18px}
`

    /** Subscribe to one namespace's shared configuration form. */
    function useConfigForm(controller) {
      return React.useSyncExternalStore(
        React.useCallback((listener) => controller.subscribe(listener), [controller]),
        () => controller.getSnapshot(),
      )
    }

    /** The value a control edits, falling back to the schema default. */
    function fieldValue(spec, values) {
      const value = values[spec.key]
      return value === undefined ? spec.fallback : value
    }

    /** Render a value into a control. */
    function formatValue(spec, value) {
      if (spec.kind === 'boolean') return value !== false
      if (spec.kind === 'enum') return value === undefined ? spec.fallback : value
      return String(value === undefined ? spec.fallback : value)
    }

    /**
     * Validate one text field against its declared range before the Host sees
     * it. The Host validates again against the plugin schema; this only keeps
     * an obvious typo from becoming a rejected write.
     * @param {object} spec - the field description from GROUPS.
     * @param {unknown} text - the control's raw value.
     * @returns {{ok: true, value: unknown} | {ok: false, message: string}}
     */
    function parseField(spec, text) {
      if (spec.kind === 'boolean') {
        if (typeof text === 'boolean') return { ok: true, value: text }
        if (text === 'true') return { ok: true, value: true }
        if (text === 'false') return { ok: true, value: false }
        return { ok: false, message: 'invalidChoice' }
      }
      if (spec.kind === 'enum') {
        return spec.values.includes(text) ? { ok: true, value: text } : { ok: false, message: 'invalidChoice' }
      }
      const raw = typeof text === 'string' ? text.trim() : text
      const message = spec.kind === 'integer' ? 'invalidInteger' : 'invalidNumber'
      if (raw === '' || raw === null || raw === undefined) return { ok: false, message }
      const value = Number(raw)
      if (!Number.isFinite(value)) return { ok: false, message }
      if (spec.kind === 'integer' && !Number.isInteger(value)) return { ok: false, message }
      if (value < spec.min || value > spec.max) return { ok: false, message: 'outOfRange' }
      return { ok: true, value }
    }

    /** One switch control. */
    function SwitchControl({ checked, disabled, labelId, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-labelledby': labelId,
        disabled,
        className: checked ? 'dgp-switch dgp-on' : 'dgp-switch',
        onClick: () => onChange(!checked),
      }, h('span', { className: 'dgp-knob' }))
    }

    /**
     * One number control: commits on blur or Enter, reverts on Escape.
     *
     * The draft only re-syncs when the committed value itself changes, so an
     * in-flight write never snaps the field back to the old number before the
     * Host answer arrives.
     */
    function NumberControl({ spec, value, disabled, labelId, t, onCommit }) {
      const [draft, setDraft] = React.useState(() => formatValue(spec, value))
      const [editing, setEditing] = React.useState(false)
      const [error, setError] = React.useState('')
      const lastValue = React.useRef(value)
      // Enter and Escape blur the field themselves; that blur must not commit a
      // second time (a duplicate write) or repeat the error they just handled.
      const skipBlur = React.useRef(false)
      React.useEffect(() => {
        if (editing || Object.is(lastValue.current, value)) return
        lastValue.current = value
        setDraft(formatValue(spec, value))
        setError('')
      }, [value, editing])

      const commit = () => {
        const parsed = parseField(spec, draft)
        if (!parsed.ok) { setError(t(parsed.message)); return false }
        setError('')
        if (parsed.value !== value) onCommit(parsed.value)
        return true
      }

      return h('div', { className: 'dgp-number' }, [
        h('input', {
          key: 'input',
          type: 'number',
          inputMode: 'numeric',
          className: error === '' ? 'dgp-input' : 'dgp-input dgp-invalid',
          min: spec.min,
          max: spec.max,
          step: spec.step ?? 1,
          value: draft,
          disabled,
          'aria-labelledby': labelId,
          'aria-invalid': error !== '',
          onChange: (event) => { setDraft(event.target.value); setError('') },
          onFocus: () => setEditing(true),
          onBlur: () => {
            setEditing(false)
            if (skipBlur.current) { skipBlur.current = false; return }
            commit()
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              skipBlur.current = true
              event.currentTarget.blur()
              commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              skipBlur.current = true
              event.currentTarget.blur()
              setDraft(formatValue(spec, value))
              setError('')
            }
          },
        }),
        error === '' ? null : h('span', { key: 'error', className: 'dgp-fieldError', role: 'alert' }, error),
      ])
    }

    /** One enumerated control: commits immediately. */
    function SelectControl({ spec, value, disabled, labelId, t, onCommit }) {
      return h('select', {
        className: 'dgp-select',
        value: formatValue(spec, value),
        disabled,
        'aria-labelledby': labelId,
        onChange: (event) => onCommit(event.target.value),
      }, spec.values.map((choice) => h('option', { key: choice, value: choice }, t(spec.key + '.' + choice))))
    }

    /** One editable row: label, hint, control, and a reset when it overrides. */
    function FieldRow({ spec, values, overrides, ready, writable, pendingKey, t, onSet, onReset }) {
      const labelId = React.useId()
      const value = fieldValue(spec, values)
      const disabled = !ready || !writable || pendingKey === spec.key
      const control = spec.kind === 'boolean'
        ? h(SwitchControl, { checked: value !== false, disabled, labelId, onChange: (next) => onSet(spec.key, next) })
        : spec.kind === 'enum'
          ? h(SelectControl, { spec, value, disabled, labelId, t, onCommit: (next) => onSet(spec.key, next) })
          : h(NumberControl, { spec, value, disabled, labelId, t, onCommit: (next) => onSet(spec.key, next) })

      return h('div', { className: 'dgp-row' }, [
        h('div', { className: 'dgp-text' }, [
          h('div', { className: 'dgp-label', id: labelId }, t('field.' + spec.key + '.label')),
          h('div', { className: 'dgp-hint' }, t('field.' + spec.key + '.hint')),
        ]),
        h('div', { className: 'dgp-actions' }, [
          control,
          overrides[spec.key] === undefined || disabled
            ? null
            : h('button', { key: 'reset', className: 'dgp-reset', type: 'button', onClick: () => onReset(spec.key) }, t('reset')),
          pendingKey === spec.key
            ? h('span', { key: 'pending', className: 'dgp-status' }, t('saving'))
            : null,
        ]),
      ])
    }

    /**
     * The settings form.
     *
     * `summary` is the one-liner the plugin-row page shows next to the row;
     * every other mount renders the editable page. The write path is the
     * Host-owned form: `set` queues a revision-checked mutation and folds the
     * answer back into the shared configuration snapshot.
     */
    function GamePlayerSettings(props) {
      const controller = props.controller
      const t = typeof props.t === 'function' ? props.t : key => key
      const state = useConfigForm(controller)
      const desktop=props.overlay?React.useSyncExternalStore(props.overlay.subscribe,props.overlay.getSnapshot,props.overlay.getSnapshot):null
      const [pendingKey, setPendingKey] = React.useState('')
      const [failure, setFailure] = React.useState(null)

      if (props.view === 'summary') return h('span', null, t('summary'))

      const ready = state.status === 'ready'
      const writable = state.writable !== false
      const rawValues = ready && state.value !== null && typeof state.value === 'object' ? state.value : {}
      const values=desktop?.value?{...rawValues,overlayView:desktop.value.view??desktop.value.preferences?.view??rawValues.overlayView}:rawValues
      const overrides = ready && state.user !== null && typeof state.user === 'object' ? state.user : {}

      const perform = async (key, task, restoring) => {
        setFailure(null)
        setPendingKey(key)
        try {
          const saved = await task()
          if (!saved) setFailure({ key, message: t(restoring ? 'resetFailed' : 'saveFailed') })
        } catch (error) {
          setFailure({ key, message: String(error?.message ?? error) })
        } finally {
          setPendingKey('')
        }
      }
      const set = (key, value) => perform(key, () => key==='overlayView'&&props.overlay&&value!=='auto'?props.overlay.command({type:'setDisplayView',view:value,revision:props.overlay.getSnapshot().value?.revision??0}):controller.set(key, value), false)
      const reset = (key) => perform(key, () => controller.unset(key), true)

      const groups = GROUPS.map((group) => h('section', { key: group.id, className: 'dgp-group' }, [
        h('h3', { key: 'title', className: 'dgp-groupTitle' }, t('group.' + group.id)),
        h('div', { key: 'list', className: 'dgp-list' }, group.fields.map((spec) => h(FieldRow, {
          key: spec.key,
          spec,
          values,
          overrides,
          ready,
          writable,
          pendingKey,
          t,
          onSet: set,
          onReset: reset,
        }))),
      ]))

      const dangerous = ready && values.requireApproval === false
      const status = !ready
        ? (state.status === 'unavailable' ? t('unavailable') : t('loading'))
        : (!writable ? t('readOnly') : (failure === null ? '' : failure.message))

      return h('div', { className: 'dgp-page' }, [
        h('style', { key: 'style' }, CSS),
        dangerous
          ? h('div', { key: 'danger', className: 'dgp-danger', role: 'alert' }, t('dangerBanner'))
          : null,
        groups[0],groups[1],
        props.overlay?h(OverlayControls,{key:'desktop-management',manager:props.overlay,t}):null,
        ...groups.slice(2),
        status === ''
          ? null
          : h('p', {
            key: 'status',
            className: failure === null ? 'dgp-status' : 'dgp-status dgp-error',
            role: failure === null ? undefined : 'alert',
          }, status),
      ])
    }

    return {
      // The field table, the dictionaries and the client-side validator are
      // exported so the test suite can cross-check them against the Host Config
      // schema without a browser; the module loader only reads `inject` and
      // `apply`.
      GROUPS,
      OverlayUIController,
      LocalRange,
      OverlayControls,
      modelImportUnavailable, MotionControls, ModelCandidateControls, ModelAdapterControls, ModelLibraryControls, LibraryCandidateControls,
      locales: { zh, en },
      parseField,
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }))
        const t = ctx.locale.bind(NS)
        // One form instance per namespace: the row page and the settings page
        // share the same values, revision and write queue.
        const controller = ctx.configForms.get(NS)
        const overlay = new OverlayUIController()
        const face = { controller, overlay }
        if (typeof ctx.inject === 'function') ctx.inject(['connection'], child => child.effect(() => overlay.attach(child.connection)))
        ctx.effect(() => () => overlay.detach())

        // Register only while the Host actually serves this namespace, so a
        // profile without the settings plugin (or with the row removed) shows
        // no dead page.
        ctx.effect(() => ctx.configForms.whileServed([NS], () => {
          const disposers = [
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section',
              id: NS,
              order: 25,
              label: () => t('sectionTitle'),
              locale: NS,
              inject: () => face,
            }, GamePlayerSettings)),
            ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
              name: 'plugins.row.config',
              key: ROW_KEY,
              locale: NS,
              inject: () => face,
            }, GamePlayerSettings)),
          ]
          return () => {
            for (const dispose of disposers) dispose?.()
          }
        }))
      },
    }
  },
})
