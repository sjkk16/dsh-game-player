#nullable enable
using System;
using System.Text.Json;
namespace GamePlayer.Desktop;
internal static class AdaptiveControlQa {
    internal static int Run(){
        int checks=0;void Check(bool condition){checks++;if(!condition)throw new InvalidOperationException("Adaptive native fixture "+checks+" failed.");}
        Check(HumanInputObserver.Source(true,0,0)=="human");Check(HumanInputObserver.Source(true,0x10,0)=="external");Check(HumanInputObserver.Source(true,0x12,0x44534847)=="own");Check(HumanInputObserver.Source(true,0,0x44534847)=="human");
        Check(HumanInputObserver.Source(false,0,0)=="human");Check(HumanInputObserver.Source(false,1,0)=="external");Check(HumanInputObserver.Source(false,3,0x44534847)=="own");
        Check(HumanInputObserver.KeyCode(13,28,1)==256);Check(HumanInputObserver.KeyCode(13,28,0)==13);Check(HumanInputObserver.KeyCode(16,0x36,0)==161);Check(HumanInputObserver.KeyCode(17,0,1)==163);Check(HumanInputObserver.KeyCode(18,0,0)==164);
        Check(AdaptiveObservationRules.CanObserve(false,false,true,false,"adaptive",true,false,false));
        Check(!AdaptiveObservationRules.CanObserve(true,false,true,false,"adaptive",true,false,false));
        Check(!AdaptiveObservationRules.CanObserve(false,true,true,false,"adaptive",true,false,false));
        Check(!AdaptiveObservationRules.CanObserve(false,false,false,false,"adaptive",true,false,false));
        Check(!AdaptiveObservationRules.CanObserve(false,false,true,true,"adaptive",true,false,false));
        Check(!AdaptiveObservationRules.CanObserve(false,false,true,false,"ai-only",true,false,false));
        Check(!AdaptiveObservationRules.CanObserve(false,false,true,false,"adaptive",false,false,false));
        Check(!AdaptiveObservationRules.CanObserve(false,false,true,false,"adaptive",true,true,false));
        Check(!AdaptiveObservationRules.CanObserve(false,false,true,false,"adaptive",true,false,true));
        var defaults=OverlaySettings.FromJson("{}");Check(defaults.ControlMode=="ai-only"&&defaults.ModelInfoVisible);
        var updated=OverlaySettings.FromJson("{\"controlMode\":\"adaptive\",\"modelInfoVisible\":false}");Check(updated.ControlMode=="adaptive"&&!updated.ModelInfoVisible);
        bool rejected=false;try{OverlaySettings.FromJson("{\"controlMode\":\"invalid\"}");}catch{rejected=true;}Check(rejected);
        rejected=false;try{OverlaySettings.FromJson("{\"modelInfoVisible\":\"false\"}");}catch{rejected=true;}Check(rejected);
        Console.WriteLine(JsonSerializer.Serialize(new{ok=true,checks,hooksInstalled=false,inputInjected=false}));return 0;
    }
}
