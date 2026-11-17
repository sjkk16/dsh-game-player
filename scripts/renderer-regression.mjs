import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OverlayController } from '../src/overlay.js'
import { PREFERENCE_DEFAULTS } from '../src/overlay-preferences.js'
const root=dirname(dirname(fileURLToPath(import.meta.url)))
const read=name=>readFile(join(root,name),'utf8')
const [policy,guard,runtime,program,qa]=await Promise.all(['desktop/RendererLifecycle.cs','desktop/GuardedCompositionControl.cs','desktop/DisplayRuntime.cs','desktop/Program.cs','desktop/RendererLifecycleQa.cs'].map(read))
const recoverable=[...policy.matchAll(/"([A-Za-z]+ProcessExited)"/g)].map(m=>m[1])
assert.deepEqual(recoverable.sort(),['UtilityProcessExited','GpuProcessExited','SandboxHelperProcessExited','FrameRenderProcessExited','PpapiPluginProcessExited','PpapiBrokerProcessExited'].sort())
for(const text of ['_ => true','Clean(description, 256)','Char.IsControl'])assert.ok(policy.includes(text))
assert.ok(guard.indexOf('control.Retire()')<guard.indexOf('unsubscribe()'))
assert.ok(guard.indexOf('parent.Children.Remove(control)')<guard.indexOf('control.Dispose()'))
for(const text of ['if (retired) return','catch (NullReferenceException error) when (IsTextureCreationFailure(error))','Direct3DHelper.CreateD3D11Texture','Microsoft.Web.WebView2.Wpf.GraphicsItemD3DImage','Dispatcher.BeginInvoke'])assert.ok(guard.includes(text))
assert.ok(runtime.includes('if (RendererProcessFailurePolicy.IsFatal(kind)) RuntimeFailed'))
assert.ok(runtime.includes('else Warn(message + "; renderer retained")'))
for(const event of ['ProcessFailed','WebMessageReceived','NavigationCompleted','WebResourceRequested','NavigationStarting','DownloadStarting','NewWindowRequested','PermissionRequested'])assert.ok(runtime.includes('core.'+event+' -= '),'named unsubscribe for '+event)
assert.ok(!program.includes('core.ProcessFailed += (_, e)'))
assert.ok(!runtime.includes('web.Dispose()'),'normal and late initialization share surface cleanup')
assert.ok(qa.includes('if (!qa || !rendererSmoke || !qaInteractive)'))
const warnings=[]
const overlay=new OverlayController({preferences:{value:{...PREFERENCE_DEFAULTS}},warn:value=>warnings.push(value),spawn(){throw Error('Fixture cannot launch processes')}})
try{
 overlay.runtime={phase:'ready',renderer:'live2d',visible:true,modelLoaded:true,error:null};overlay.ready=true;overlay.dead=false
 const before=JSON.stringify(overlay.runtime)
 overlay.read(JSON.stringify({kind:'warning',message:'WebView2 process failed: kind=UtilityProcessExited; renderer retained'})+'\n')
 assert.equal(JSON.stringify(overlay.runtime),before);assert.equal(overlay.ready,true);assert.equal(overlay.dead,false);assert.equal(warnings.length,1)
}finally{clearInterval(overlay.adaptiveTimer);overlay.closed=true}
console.log('Renderer lifecycle regression passed: failure classification, teardown order, callback guards, narrow D3D filter, diagnostics and nonfatal Host warnings; no desktop process or real input.')
