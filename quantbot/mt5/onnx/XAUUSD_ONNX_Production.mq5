//+------------------------------------------------------------------+
//| XAUUSD ONNX Production: trades gold_model.onnx on XAUUSD H1       |
//| The model is trained by train_gold_model.py on the 2004-2026      |
//| XAUUSD M5 export. Put gold_model.onnx next to this file, compile   |
//| (F7) and attach to any XAUUSD chart: it always works on H1 bars.  |
//| Features() must match features() in train_gold_model.py.          |
//| Unseen test 2023-2026 at 0.5% risk: 457 trades, PF 1.07, +9.8%,   |
//| max drawdown 9.3%. A thin edge: forward-test on demo first.       |
//+------------------------------------------------------------------+
#property copyright "QuantBot"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
#resource "gold_model.onnx" as uchar ExtModel[]

input group "Model"
input double InpThreshold    = 0.40;     // Min model probability to trade (picked on 2020-2022)
input group "Risk"
input double InpRiskPercent  = 0.5;      // Base risk per trade, % of equity
input double InpMinRisk      = 0.1;      // Risk floor after the confidence multiplier, %
input double InpMaxRisk      = 1.0;      // Risk cap after the confidence multiplier, %
input double InpMaxDailyDD   = 1.5;      // Daily loss kill switch, % of the day's starting balance/equity
input double InpSlAtr        = 1.5;      // Stop loss, x ATR(14)
input double InpTpAtr        = 3.0;      // Take profit, x ATR(14)
input int    InpMaxBars      = 48;       // Close after this many H1 bars
input group "Execution"
input double InpMaxSpread    = 0.50;     // Max spread in $ (price), not points: works on 2- and 3-digit quotes
input int    InpSlippagePts  = 50;       // Max slippage in points
input ulong  InpMagic        = 88882026; // Magic number

#define N_FEATURES 12
#define N_CLASSES  3
#define HISTORY    130
const ENUM_TIMEFRAMES TF = PERIOD_H1;

CTrade   trade;
long     g_model = INVALID_HANDLE;
datetime g_lastBar = 0;
int      g_day = -1;
double   g_dayStart = 0;
bool     g_halted = false;

int OnInit()
{
   if(StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
      Print("Warning: the model was trained on XAUUSD, this chart is ", _Symbol);
   g_model = OnnxCreateFromBuffer(ExtModel, ONNX_DEFAULT);
   if(g_model == INVALID_HANDLE) { Print("ONNX model failed to load: ", GetLastError()); return INIT_FAILED; }
   const long inShape[] = {1, N_FEATURES};
   const long labelShape[] = {1};
   const long probShape[] = {1, N_CLASSES};
   if(!OnnxSetInputShape(g_model, 0, inShape) || !OnnxSetOutputShape(g_model, 0, labelShape) || !OnnxSetOutputShape(g_model, 1, probShape))
   {
      Print("ONNX shapes don't match the model (expects [1,12] in, label + [1,3] out): ", GetLastError());
      return INIT_FAILED;
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);
   Print("XAUUSD ONNX EA ready on ", _Symbol, " H1, threshold ", DoubleToString(InpThreshold, 2));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(g_model != INVALID_HANDLE) { OnnxRelease(g_model); g_model = INVALID_HANDLE; }
}

void OnTick()
{
   if(DailyKillSwitch()) return;
   ManageOpenPosition();
   datetime bar = iTime(_Symbol, TF, 0);
   if(bar == 0 || bar == g_lastBar) return;
   g_lastBar = bar; // one decision per H1 bar, taken or not
   if(HasPosition()) return;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask - bid > InpMaxSpread) { Print("Skipped: spread $", DoubleToString(ask - bid, 2), " over $", DoubleToString(InpMaxSpread, 2)); return; }

   float x[N_FEATURES];
   double atr;
   if(!Features(x, atr)) return;
   float p[N_CLASSES];
   if(!Predict(x, p)) return;
   int side = 0;
   double conf = 0;
   if(p[1] > InpThreshold && p[1] >= p[2]) { side = 1; conf = p[1]; }
   else if(p[2] > InpThreshold) { side = -1; conf = p[2]; }
   if(side == 0) return;
   Open(side, conf, atr, ask, bid);
}

//--- The 12 model inputs from the last closed H1 bars (index 1 = last closed), same formulas as train_gold_model.py
bool Features(float &x[], double &atr14)
{
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, TF, 1, HISTORY, r) < HISTORY) { Print("Not enough H1 history yet"); return false; }
   double tr[];
   ArrayResize(tr, HISTORY - 1);
   for(int k = 0; k < HISTORY - 1; k++)
      tr[k] = MathMax(r[k].high - r[k].low, MathMax(MathAbs(r[k].high - r[k + 1].close), MathAbs(r[k].low - r[k + 1].close)));
   double s14 = 0, s100 = 0;
   for(int k = 0; k < 100; k++) { if(k < 14) s14 += tr[k]; s100 += tr[k]; }
   atr14 = s14 / 14.0;
   double atr100 = s100 / 100.0;
   if(atr14 <= 0 || atr100 <= 0) return false;
   double c = r[0].close;
   const int lags[] = {1, 2, 4, 8, 24};
   for(int j = 0; j < 5; j++) x[j] = (float)((c - r[lags[j]].close) / atr14);
   x[5] = (float)Position(r, 24, c);
   x[6] = (float)Position(r, 120, c);
   x[7] = (float)(atr14 / atr100);
   x[8] = (float)((c - r[0].open) / atr14);
   x[9] = (float)((r[0].high - r[0].low) / atr14);
   MqlDateTime t;
   TimeToStruct(r[0].time, t);
   x[10] = (float)MathSin(2 * M_PI * t.hour / 24.0);
   x[11] = (float)MathCos(2 * M_PI * t.hour / 24.0);
   return true;
}

double Position(const MqlRates &r[], int n, double c)
{
   double hh = r[0].high, ll = r[0].low;
   for(int k = 1; k < n; k++) { hh = MathMax(hh, r[k].high); ll = MathMin(ll, r[k].low); }
   return (c - ll) / MathMax(hh - ll, 1e-9);
}

//--- Probabilities [none, long, short]
bool Predict(const float &x[], float &p[])
{
   long label[1];
   if(!OnnxRun(g_model, ONNX_NO_CONVERSION, x, label, p)) { Print("ONNX run failed: ", GetLastError()); return false; }
   return true;
}

void Open(int side, double conf, double atr, double ask, double bid)
{
   double price = side > 0 ? ask : bid;
   double slDist = InpSlAtr * atr;
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double minDist = (SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) + 1) * point;
   if(slDist < minDist) { Print("Skipped: stop closer than the broker allows"); return; }
   double sl = NormalizeDouble(price - side * slDist, digits);
   double tp = NormalizeDouble(price + side * InpTpAtr * atr, digits);

   // Confidence sizing: base risk x (probability / threshold), kept inside the floor and the cap
   double mult = MathMax(0.5, MathMin(2.0, conf / InpThreshold));
   double riskPct = MathMax(InpMinRisk, MathMin(InpMaxRisk, InpRiskPercent * mult));
   double riskMoney = AccountInfoDouble(ACCOUNT_EQUITY) * riskPct / 100.0;
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickValue <= 0) { Print("Skipped: no tick value from the broker"); return; }
   double lossPerLot = slDist / tickSize * tickValue;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lots = MathFloor(riskMoney / lossPerLot / step) * step;
   lots = MathMin(lots, SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX));
   // Never round up to the minimum lot: that would risk more than asked
   if(lots < SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN)) { Print("Skipped: account too small for ", DoubleToString(riskPct, 2), "% risk at this stop"); return; }

   string note = StringFormat("ONNX p=%.2f risk %.2f%%", conf, riskPct);
   bool ok = side > 0 ? trade.Buy(lots, _Symbol, 0, sl, tp, note) : trade.Sell(lots, _Symbol, 0, sl, tp, note);
   if(!ok || (trade.ResultRetcode() != TRADE_RETCODE_DONE && trade.ResultRetcode() != TRADE_RETCODE_PLACED))
      Print("Order failed: ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
   else
      Print(side > 0 ? "BUY " : "SELL ", DoubleToString(lots, 2), " lots, SL ", DoubleToString(sl, digits), " TP ", DoubleToString(tp, digits), ", ", note);
}

bool HasPosition()
{
   for(int k = PositionsTotal() - 1; k >= 0; k--)
      if(PositionGetSymbol(k) == _Symbol && PositionGetInteger(POSITION_MAGIC) == (long)InpMagic) return true;
   return false;
}

//--- Time stop: out after InpMaxBars H1 bars
void ManageOpenPosition()
{
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      if(PositionGetSymbol(k) != _Symbol || PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      if(iBarShift(_Symbol, TF, opened) >= InpMaxBars) trade.PositionClose(PositionGetInteger(POSITION_TICKET));
   }
}

void CloseAll()
{
   for(int k = PositionsTotal() - 1; k >= 0; k--)
      if(PositionGetSymbol(k) == _Symbol && PositionGetInteger(POSITION_MAGIC) == (long)InpMagic)
         trade.PositionClose(PositionGetInteger(POSITION_TICKET));
}

//--- Kill switch: equity InpMaxDailyDD% under the higher of the day's starting balance and equity (the way FTMO
//--- measures it) closes this EA's trades and stops new ones until the next broker day
bool DailyKillSwitch()
{
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   if(t.day_of_year != g_day)
   {
      g_day = t.day_of_year;
      g_dayStart = MathMax(AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY));
      g_halted = false;
   }
   if(g_halted) return true;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_dayStart > 0 && (g_dayStart - eq) / g_dayStart * 100.0 >= InpMaxDailyDD)
   {
      g_halted = true;
      CloseAll();
      Print("Daily loss limit ", DoubleToString(InpMaxDailyDD, 1), "% hit: trades closed, no new ones until the next broker day");
      return true;
   }
   return false;
}
