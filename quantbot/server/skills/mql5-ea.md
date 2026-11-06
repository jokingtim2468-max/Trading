---
name: mql5-ea
description: Load when writing an MT5 Expert Advisor or indicator in MQL5 - structure, CTrade, risk sizing, new-bar logic, common mistakes
---

# MQL5 Expert Advisors

```mql5
#property strict
#include <Trade/Trade.mqh>
input double RiskUsd = 100;   input double StopAtr = 1.5;  input ulong Magic = 26110601;
CTrade trade; int hAtr; datetime lastBar = 0;
int OnInit(){ trade.SetExpertMagicNumber(Magic); hAtr = iATR(_Symbol, _Period, 14); return hAtr==INVALID_HANDLE ? INIT_FAILED : INIT_SUCCEEDED; }
void OnDeinit(const int r){ IndicatorRelease(hAtr); }
void OnTick(){
   datetime t = iTime(_Symbol, _Period, 0); if(t == lastBar) return; lastBar = t;   // closed-bar logic only
   double atr[]; if(CopyBuffer(hAtr, 0, 1, 1, atr) < 1) return;
   // signal on bar 1 (the bar that just closed), then size and send
}
double LotsFor(double dist){
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS), ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double lots = RiskUsd / (dist / ts * tv), step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   lots = MathFloor(lots / step) * step;
   return lots < SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN) ? 0 : MathMin(lots, SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX));
}
```
- Strict MQL5 only: never MQL4 (Ask, Bid, OrderSend with 11 args, MarketInfo). Use SymbolInfoDouble, CTrade, CopyBuffer.
- Every trade sets SL and TP at entry; check `trade.ResultRetcode()`; respect stops level and freeze level.
- One position per symbol per magic; no martingale, grid or averaging down.
- MT5's Strategy Tester ("Every tick based on real ticks", visual mode) is the replay; the trader runs it, you cannot.
