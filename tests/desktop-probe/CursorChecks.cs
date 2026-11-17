using GamePlayer.Desktop;
internal static class CursorChecks {
 internal static void Run(Action<bool,string> check){
  check(CursorGazeRules.Normalize(0,0,0,0,1921,1081)==new CursorGazeValue(true,-1,1),"Cursor top-left maps to left/up");
  check(CursorGazeRules.Normalize(1920,1080,0,0,1921,1081)==new CursorGazeValue(true,1,-1),"Cursor bottom-right maps to right/down");
  check(CursorGazeRules.Normalize(960,540,0,0,1921,1081)==new CursorGazeValue(true,0,0),"Desktop center is neutral gaze");
  check(CursorGazeRules.Normalize(-1920,-1080,-1920,-1080,3841,2161)==new CursorGazeValue(true,-1,1),"Negative multi-monitor origin is retained");
  check(CursorGazeRules.Normalize(0,0,-1920,-1080,3841,2161)==new CursorGazeValue(true,0,0),"Mixed DPI mapping uses physical desktop pixels, not DIP");
  check(!CursorGazeRules.Normalize(0,0,0,0,1,100).Valid&&!CursorGazeRules.Normalize(0,0,0,0,100,-1).Valid,"Invalid display bounds produce invalid gaze");
  check(CursorGazeRules.Normalize(int.MaxValue,int.MinValue,int.MinValue,int.MaxValue,100,100)==new CursorGazeValue(true,1,1),"Out-of-range/overflow coordinates clamp safely");
  bool Gate(bool qa=false,bool alive=true,bool ready=true,bool modelReady=true,bool loading=false,bool visible=true,bool nativeVisible=true,bool adjusting=false,bool modelView=true,bool sessionAvailable=true)=>CursorGazeRules.CanSample(qa,alive,ready,modelReady,loading,visible,nativeVisible,adjusting,modelView,sessionAvailable);
  check(Gate(),"Only a ready actually-visible model can sample");
  check(!Gate(qa:true),"Private QA never samples the real system cursor");
  check(!Gate(alive:false)&&!Gate(ready:false),"Disposed/context failure stops pointer sampling");
  check(!Gate(modelReady:false)&&!Gate(loading:true),"Unloaded/loading models do not sample");
  check(!Gate(visible:false)&&!Gate(nativeVisible:false),"Hidden/native-invisible windows do not sample");
  check(!Gate(adjusting:true)&&!Gate(modelView:false),"Adjustment and keyboard view do not sample");
  check(!Gate(sessionAvailable:false),"Locked/disconnected/unregistered sessions do not sample");
  var channel=new CursorGazeChannel();check(channel.Offer(new(true,1,0))==null,"Inactive channel queues no targets");channel.Begin("first");
  var first=channel.Offer(new(true,1,0))!.Value;check(channel.InFlight&&channel.Queued==0,"One cursor packet may be in flight");
  for(int i=0;i<100000;i++)channel.Offer(new(true,-i/100000.0,1));check(channel.Queued==1,"Blocked renderer retains only the latest pending target");
  check(channel.Complete("other",first.Sequence)==null&&channel.Complete("first",first.Sequence-1)==null&&channel.InFlight,"Expired/incorrect acknowledgements cannot release the queue");
  var latest=channel.Complete("first",first.Sequence)!.Value;check(latest.Value.X==-.99999&&channel.Queued==0&&channel.InFlight,"Acknowledgement publishes the newest coalesced target");
  channel.Offer(latest.Value);check(channel.Queued==0,"Repeated targets do not grow the queue");channel.Complete("first",latest.Sequence);
  check(channel.Offer(latest.Value)==null,"Stationary cursor does not send duplicate targets");
  var failure=channel.Offer(new(false))!.Value;check(!failure.Value.Valid,"Cursor read failure publishes invalid rather than fabricated coordinates");
  var paused=channel.Suspend()!.Value;check(!paused.Value.Valid&&!channel.InFlight&&channel.Queued==0&&channel.Token==null,"Hide/lock clears the pending channel and sends invalidation");
  check(channel.Suspend()==null&&channel.Complete("first",failure.Sequence)==null,"Repeated pause and late acknowledgements are harmless");
  channel.Begin("second");var next=channel.Offer(new(true,0,1))!.Value;check(next.Token=="second"&&next.Sequence>paused.Sequence,"Replacement model has independent token and monotonic sequence");
  check(channel.Complete("first",next.Sequence)==null,"Prior model acknowledgement cannot affect the new model");
  double clock=0;var recovery=new CursorGazeChannel(()=>clock){DiagnosticsEnabled=true};recovery.Begin("r");var lost=recovery.Offer(new(true,1,0))!.Value;
  recovery.Offer(new(true,-1,0));clock=249;check(recovery.Progress("r",0,1)==null&&recovery.InFlight,"Progress before 250ms never retransmits");
  clock=251;check(recovery.Progress("old",0,2)==null&&recovery.Progress("r",0,1)==null,"Wrong token and repeated progress cannot recover a slot");
  var renewed=recovery.Progress("r",0,2)!.Value;check(renewed.Sequence>lost.Sequence&&renewed.Value.X==-1,"Fresh progress recovers only the newest target");
  check(recovery.Complete("r",lost.Sequence)==null&&recovery.InFlight,"Late acknowledgment cannot release a replacement");
  recovery.Offer(new(true,0,1));var caught=recovery.Progress("r",renewed.Sequence,3)!.Value;check(caught.Value.Y==1&&recovery.AckRecoveries==1,"Progress repairs a dropped ordinary receipt");
  check(recovery.TargetRecoveries==1&&recovery.Queued==0,"Recovery is bounded to one in-flight packet");
  clock=10000;for(int i=0;i<100000;i++)recovery.Offer(new(true,.5,.5));check(recovery.TargetRecoveries==1&&recovery.Queued==1,"Time and sampling alone cannot retransmit without renderer progress");
  check(recovery.Progress("r",long.MaxValue,4)==null,"Impossible received sequences are rejected");
  var stop=recovery.Suspend()!.Value;check(recovery.Progress("r",caught.Sequence,5)==null,"Suspended channel cannot be revived by progress");
  recovery.Begin("r");var resume=recovery.Offer(new(true,.5,.5))!.Value;clock+=300;
  check(recovery.Progress("r",caught.Sequence,6)==null,"Late same-model progress predating suspend is rejected");
  check(recovery.Progress("r",stop.Sequence,7)!.Value.Value.X==.5,"Resume fence permits recovery if the first resumed target is lost");
  var stationary=new CursorGazeChannel(()=>clock);stationary.Begin("s");stationary.Offer(new(true,.7,0));stationary.Offer(new(true,.7,0));clock+=300;
  check(stationary.Progress("s",0,1)!.Value.Value.X==.7,"A lost stationary target is retained even with no pending change");
  var cadence=new CursorSampleCadence();cadence.Reset(0);check(cadence.Due(0)&&!cadence.Due(10),"Sampling starts immediately but never exceeds the deadline");
  check(cadence.Due(3000)&&!cadence.Due(3000)&&cadence.Remaining(3000)>30,"Long dispatch delays skip samples without a catch-up burst");

 }
}
