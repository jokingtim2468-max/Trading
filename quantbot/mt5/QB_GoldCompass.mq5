//+------------------------------------------------------------------+
//| QuantBot · Gold Compass EA (MQL5) for a $25,000 account           |
//| Same rules as strategies/qb-gold-compass.pine, on closed bars:     |
//|  - trend: daily close > EMA50, 4h EMA50 > EMA200, 1h EMA20 > EMA50 |
//|  - pullback: RSI(2) of the previous bar under 20, then the bar     |
//|    closes above the previous high (long; shorts off by default)    |
//|  - only 14:00-20:00 server time (London close + New York)          |
//|  - stop 2 x ATR14, target 3 x stop, lots from the $ risk           |
//|  - per day: stop after 2 losses or -2% of the account              |
//|  - account guard: stops trading at 8% below the start balance      |
//|  - watches YOUR manual trades on this symbol: shows the $ risk of  |
//|    the lot you picked, and can add the Compass stop / target       |
//|                                                                    |
//| REPLAY (QuantBot, XAUUSD 2004-2026, real spread, $25k, $62.50/R):  |
//|  M15: 1,219 trades, +$2,494 in 22 years, worst drawdown $3,959,    |
//|       a 10% max-loss rule would have been hit in Sept 2015.        |
//|       2023 +$629, 2024 +$1,461, 2025 +$2,480, 2026 so far -$455.   |
//|  M5:  loses in 19 of 23 years (-$25k at 0.25%). Do not run on M5.  |
//| It follows gold's trend: good in bull years, a slow bleed in       |
//| sideways years. Run it on a demo first. Use MT5's Strategy Tester  |
//| (Visual mode, "Every tick based on real ticks") to replay it.      |
//+------------------------------------------------------------------+
#property copyright "QuantBot"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input double AccountStart   = 25000.0;  // Account start balance ($), sets the limits below
input double RiskPct        = 0.25;     // Risk per trade (% of the start balance) = $62.50 on $25k
input double FixedLots      = 0.0;      // Fixed lot size (0 = size from RiskPct); capped to RiskPct x 2
input double StopAtr        = 2.0;      // Stop (x ATR14)
input double TargetR        = 3.0;      // Target (x stop)
input int    RsiDepth       = 20;       // Pullback: RSI(2) under this
input bool   AllowShorts    = false;    // Shorts (lost money in most years)
input int    StartHour      = 14;       // Trading starts (server hour)
input int    EndHour        = 20;       // Trading ends (server hour)
input int    MaxLossesDay   = 2;        // Losing trades per day before stopping
input double DayLossPct     = 2.0;      // Stop for the day at this % loss
input double GuardPct       = 8.0;      // Stop the EA at this % below the start balance (before a 10% max loss)
input bool   ManageManual   = true;     // Watch my manual trades on this symbol
input bool   AddManualStops = false;    // Add the Compass stop / target to my manual trades that have none
input double MaxLots        = 5.0;      // Hard cap on lots per trade
input ulong  Magic          = 26102301; // Magic number
input int    SlippagePts    = 30;       // Max slippage (points)

CTrade   trade;
datetime lastBar = 0;
int      dayKey = -1;
double   dayPnl = 0.0;
int      dayLosses = 0;
int hAtr = INVALID_HANDLE, hRsi = INVALID_HANDLE, hD50 = INVALID_HANDLE, hH4F = INVALID_HANDLE, hH4S = INVALID_HANDLE, hH1F = INVALID_HANDLE, hH1S = INVALID_HANDLE;

int OnInit()
{
   if(_Period != PERIOD_M15 && _Period != PERIOD_M5) { Alert("Gold Compass: attach it to an M15 chart (M5 lost money in the replay)"); return INIT_PARAMETERS_INCORRECT; }
   if(_Period == PERIOD_M5) Print("Gold Compass: WARNING, M5 lost money in 19 of 23 years of replay. M15 is the tested timeframe.");
   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(SlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);
   hAtr = iATR(_Symbol, _Period, 14);
   hRsi = iRSI(_Symbol, _Period, 2, PRICE_CLOSE);
   hD50 = iMA(_Symbol, PERIOD_D1, 50, 0, MODE_EMA, PRICE_CLOSE);
   hH4F = iMA(_Symbol, PERIOD_H4, 50, 0, MODE_EMA, PRICE_CLOSE);
   hH4S = iMA(_Symbol, PERIOD_H4, 200, 0, MODE_EMA, PRICE_CLOSE);
   hH1F = iMA(_Symbol, PERIOD_H1, 20, 0, MODE_EMA, PRICE_CLOSE);
   hH1S = iMA(_Symbol, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE);
   if(hAtr == INVALID_HANDLE || hRsi == INVALID_HANDLE || hD50 == INVALID_HANDLE || hH4F == INVALID_HANDLE || hH4S == INVALID_HANDLE || hH1F == INVALID_HANDLE || hH1S == INVALID_HANDLE)
      { Print("Gold Compass: indicators not available"); return INIT_FAILED; }
   if(RiskPct <= 0 || StopAtr <= 0 || TargetR <= 0 || AccountStart <= 0) return INIT_PARAMETERS_INCORRECT;
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   int h[] = {hAtr, hRsi, hD50, hH4F, hH4S, hH1F, hH1S};
   for(int i = 0; i < ArraySize(h); i++) if(h[i] != INVALID_HANDLE) IndicatorRelease(h[i]);
   ObjectsDeleteAll(0, "QBC_");
   Comment("");
}

double Buf(int handle, int shift)
{
   double v[];
   if(CopyBuffer(handle, 0, shift, 1, v) < 1) return EMPTY_VALUE;
   return v[0];
}

// Trend of a timeframe from closed bars only (shift 1): +1 up, -1 down, 0 unknown
int TrendD1()
{
   double e = Buf(hD50, 1), c = iClose(_Symbol, PERIOD_D1, 1);
   if(e == EMPTY_VALUE || c == 0) return 0;
   return c > e ? 1 : c < e ? -1 : 0;
}
int TrendPair(int fast, int slow)
{
   double f = Buf(fast, 1), s = Buf(slow, 1);
   if(f == EMPTY_VALUE || s == EMPTY_VALUE) return 0;
   return f > s ? 1 : f < s ? -1 : 0;
}

// The day's closed P&L and losing trades from this EA's deals, so a restart keeps the day's limits
void LoadDay()
{
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   int key = t.year * 1000 + t.day_of_year;
   if(key == dayKey) return;
   dayKey = key; dayPnl = 0.0; dayLosses = 0;
   datetime from = StringToTime(StringFormat("%04d.%02d.%02d 00:00", t.year, t.mon, t.day));
   if(!HistorySelect(from, TimeCurrent() + 60)) return;
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(d, DEAL_MAGIC) != (long)Magic || HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      double p = HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_COMMISSION);
      dayPnl += p;
      if(p < 0) dayLosses++;
   }
}

// A closed trade of this EA updates the day straight away
void OnTradeTransaction(const MqlTradeTransaction &tx, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tx.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(tx.deal)) return;
   if(HistoryDealGetInteger(tx.deal, DEAL_MAGIC) != (long)Magic || HistoryDealGetInteger(tx.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   double p = HistoryDealGetDouble(tx.deal, DEAL_PROFIT) + HistoryDealGetDouble(tx.deal, DEAL_SWAP) + HistoryDealGetDouble(tx.deal, DEAL_COMMISSION);
   dayPnl += p;
   if(p < 0) dayLosses++;
}

double LossPerLot(double dist)
{
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS), ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tv <= 0) tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tv <= 0 || ts <= 0) return 0;
   return dist / ts * tv;
}

double RiskUsd() { return AccountStart * RiskPct / 100.0; }

// Lots for a stop distance: FixedLots if set (never more than 2x the risk), else RiskPct; rounded down to the lot step
double LotsFor(double dist)
{
   double lpl = LossPerLot(dist);
   if(lpl <= 0) return 0;
   double lots = FixedLots > 0 ? MathMin(FixedLots, 2.0 * RiskUsd() / lpl) : RiskUsd() / lpl;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = MathMin(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), MaxLots);
   if(step > 0) lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin) return 0;
   return MathMin(lots, vmax);
}

bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == (long)Magic && PositionGetString(POSITION_SYMBOL) == _Symbol) return true;
   }
   return false;
}

// Manual trades (magic 0) on this symbol: the $ risk of the lot you picked, and optionally the Compass stop / target
string WatchManual(double atr)
{
   if(!ManageManual) return "";
   string out = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      double lots = PositionGetDouble(POSITION_VOLUME), open = PositionGetDouble(POSITION_PRICE_OPEN), sl = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP);
      bool buy = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      double dist = sl > 0 ? MathAbs(open - sl) : StopAtr * atr;
      double risk = LossPerLot(dist) * lots;
      double fit = LotsFor(dist);
      out += StringFormat("\nYour %s %.2f lot: risk $%.0f%s%s", buy ? "buy" : "sell", lots, risk, sl > 0 ? "" : " (no stop: Compass stop used)",
                          risk > RiskUsd() * 1.05 ? StringFormat("  OVER $%.0f, %.2f lot fits", RiskUsd(), fit) : "");
      if(AddManualStops && sl == 0 && atr > 0)
      {
         int dg = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
         double nsl = NormalizeDouble(buy ? open - StopAtr * atr : open + StopAtr * atr, dg);
         double ntp = tp > 0 ? tp : NormalizeDouble(buy ? open + TargetR * StopAtr * atr : open - TargetR * StopAtr * atr, dg);
         if(!trade.PositionModify(t, nsl, ntp)) Print("Gold Compass: could not add a stop to your trade: ", trade.ResultRetcodeDescription());
      }
   }
   return out;
}

void Line(string name, double price, color c, ENUM_LINE_STYLE st)
{
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_STYLE, st);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void Arrow(datetime t, double price, bool buy)
{
   string n = StringFormat("QBC_sig_%I64d", (long)t);
   ObjectCreate(0, n, OBJ_ARROW, 0, t, price);
   ObjectSetInteger(0, n, OBJPROP_ARROWCODE, buy ? 233 : 234);
   ObjectSetInteger(0, n, OBJPROP_COLOR, buy ? clrLimeGreen : clrTomato);
   ObjectSetInteger(0, n, OBJPROP_WIDTH, 2);
}

void OnTick()
{
   LoadDay();
   double atr = Buf(hAtr, 1);
   int tD = TrendD1(), tH4 = TrendPair(hH4F, hH4S), tH1 = TrendPair(hH1F, hH1S);
   double bal = AccountInfoDouble(ACCOUNT_EQUITY);
   bool guard = bal <= AccountStart * (1.0 - GuardPct / 100.0);
   bool dayLock = dayLosses >= MaxLossesDay || dayPnl <= -AccountStart * DayLossPct / 100.0;
   MqlDateTime now; TimeToStruct(TimeCurrent(), now);
   bool inHours = now.hour >= StartHour && now.hour < EndHour;

   // Visuals: prior day high / low and the daily ATR band from today's open
   double dOpen = iOpen(_Symbol, PERIOD_D1, 0), pdh = iHigh(_Symbol, PERIOD_D1, 1), pdl = iLow(_Symbol, PERIOD_D1, 1);
   double rangeD = 0; for(int i = 1; i <= 14; i++) rangeD += iHigh(_Symbol, PERIOD_D1, i) - iLow(_Symbol, PERIOD_D1, i); rangeD /= 14.0;
   Line("QBC_pdh", pdh, clrDodgerBlue, STYLE_SOLID);
   Line("QBC_pdl", pdl, clrDodgerBlue, STYLE_SOLID);
   Line("QBC_up", dOpen + rangeD, clrSeaGreen, STYLE_DOT);
   Line("QBC_dn", dOpen - rangeD, clrIndianRed, STYLE_DOT);

   string tr = StringFormat("D1 %s · H4 %s · H1 %s", tD > 0 ? "Up" : tD < 0 ? "Down" : "-", tH4 > 0 ? "Up" : tH4 < 0 ? "Down" : "-", tH1 > 0 ? "Up" : tH1 < 0 ? "Down" : "-");
   string status = guard ? "STOPPED: account guard (" + DoubleToString(GuardPct, 0) + "% down)" : dayLock ? "DAY LOCKED" : HasPosition() ? "IN A TRADE" : !inHours ? "WAITING FOR 14:00-20:00" : "WATCHING";
   double lots = atr > 0 ? LotsFor(StopAtr * atr) : 0;
   Comment(StringFormat("QB Gold Compass · $%.0f account · %s\nTrend: %s\nStatus: %s\nDay: %s$%.0f · losses %d/%d\nNext trade: %.2f lot, risk $%.0f, target $%.0f%s",
      AccountStart, EnumToString(_Period), tr, status, dayPnl >= 0 ? "+" : "-", MathAbs(dayPnl), dayLosses, MaxLossesDay,
      lots, atr > 0 ? LossPerLot(StopAtr * atr) * lots : 0, atr > 0 ? LossPerLot(StopAtr * atr) * lots * TargetR : 0, WatchManual(atr)));

   // Signals on closed bars only
   datetime bar = iTime(_Symbol, _Period, 0);
   if(bar == lastBar) return;
   lastBar = bar;
   if(guard || dayLock || !inHours || HasPosition() || atr == EMPTY_VALUE || atr <= 0) return;

   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 1, 3, r) < 3) return;   // r[0] = the bar that just closed
   double rsiPrev = Buf(hRsi, 2);
   if(rsiPrev == EMPTY_VALUE) return;
   bool up = tD == 1 && tH4 == 1 && tH1 == 1, dn = tD == -1 && tH4 == -1 && tH1 == -1;
   bool buy = up && rsiPrev < RsiDepth && r[0].close > r[1].high;
   bool sell = AllowShorts && dn && rsiPrev > 100 - RsiDepth && r[0].close < r[1].low;
   if(!buy && !sell) return;

   double dist = StopAtr * atr;
   lots = LotsFor(dist);
   if(lots <= 0) { Print("Gold Compass: the smallest lot risks more than allowed, signal skipped"); return; }
   int dg = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(buy)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      Arrow(r[0].time, r[0].low - atr * 0.3, true);
      if(!trade.Buy(lots, _Symbol, 0, NormalizeDouble(ask - dist, dg), NormalizeDouble(ask + dist * TargetR, dg), "QB Compass"))
         Print("Gold Compass: buy rejected: ", trade.ResultRetcodeDescription());
   }
   else
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      Arrow(r[0].time, r[0].high + atr * 0.3, false);
      if(!trade.Sell(lots, _Symbol, 0, NormalizeDouble(bid + dist, dg), NormalizeDouble(bid - dist * TargetR, dg), "QB Compass"))
         Print("Gold Compass: sell rejected: ", trade.ResultRetcodeDescription());
   }
}
