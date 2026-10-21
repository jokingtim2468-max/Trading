//+------------------------------------------------------------------+
//| QuantBot · Exhaustion Engine (MQL5)                               |
//| The same logic as strategies/qb-exhaustion-engine.pine, on closed |
//| bars of the chart's timeframe (M1 or M5 gold):                    |
//|  - 4 red candles = buy, 4 green = sell (exhaustion)               |
//|  - or a rejection wick (>1.5x body and >0.8 ATR(7)) on the last   |
//|    bar plus a strong candle the other way                         |
//|  - or a momentum candle (>3x the 5-bar average body)              |
//|  - stop beyond the last two bars + 0.2 ATR, at least StopFloor    |
//|  - target = stop distance x TpRatio                               |
//|  - lots from RiskUsd and the stop distance                        |
//|  - per day: stop after DailyLossFloor, after DailyProfitCap, or   |
//|    after MaxLosses losing trades (the 2-strike kill switch)       |
//|                                                                    |
//| BACKTEST (QuantBot replica, XAUUSD M5 2004-2026, real spread):    |
//|  15,922 trades, win 34%, profit factor 0.87, net -1,549 R.        |
//|  It loses money as it is; test on a demo before any paid account. |
//+------------------------------------------------------------------+
#property copyright "QuantBot"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

enum FirmProfile { LUCID_FLEX = 0, LUCID_PRO = 1, FTMO_EVAL = 2, FTMO_FUNDED = 3, THE5ERS = 4, ALPHA_CAPITAL = 5, FUNDEDNEXT = 6 };

input FirmProfile Profile        = LUCID_FLEX; // Firm profile (shown on the chart; set the numbers below from QuantBot's preset)
input double      RiskUsd        = 75.0;       // Risk per trade ($)
input double      TpRatio        = 2.0;        // Take profit ratio (1:x)
input double      DailyProfitCap = 600.0;      // Stop for the day once up this much ($)
input double      DailyLossFloor = -200.0;     // Stop for the day once down this much ($, negative)
input int         MaxLosses      = 2;          // Losing trades per day before the kill switch
input double      StopFloor      = 1.5;        // Minimum stop distance (price points, e.g. $1.50 on gold)
input double      MaxLots        = 10.0;       // Hard cap on lots per trade
input ulong       Magic          = 26101901;   // Magic number
input int         SlippagePts    = 30;         // Max slippage (points)

CTrade   trade;
datetime lastBar = 0;
int      dayKey = -1;
double   dayPnl = 0.0;
int      dayLosses = 0;
int      atrHandle = INVALID_HANDLE;

int OnInit()
{
   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(SlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);
   atrHandle = iATR(_Symbol, _Period, 7);
   if(atrHandle == INVALID_HANDLE) { Print("Exhaustion Engine: ATR not available"); return INIT_FAILED; }
   if(RiskUsd <= 0 || TpRatio <= 0 || StopFloor <= 0) return INIT_PARAMETERS_INCORRECT;
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { if(atrHandle != INVALID_HANDLE) IndicatorRelease(atrHandle); Comment(""); }

// The day's closed P&L and losing trades from this EA's deals (server time), so a restart keeps the day's limits
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

bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == (long)Magic && PositionGetString(POSITION_SYMBOL) == _Symbol) return true;
   }
   return false;
}

// Lots so that hitting the stop loses about RiskUsd, rounded down to the symbol's lot step
double LotsFor(double stopDist)
{
   double tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickVal <= 0) tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickVal <= 0 || tickSize <= 0 || stopDist <= 0) return 0;
   double lossPerLot = stopDist / tickSize * tickVal;
   double lots = RiskUsd / lossPerLot;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = MathMin(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), MaxLots);
   if(step > 0) lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin) return 0;
   return MathMin(lots, vmax);
}

string ProfileName()
{
   switch(Profile)
   {
      case LUCID_FLEX:    return "Lucid Trading (LucidFlex)";
      case LUCID_PRO:     return "Lucid Trading (LucidPro)";
      case FTMO_EVAL:     return "FTMO (Evaluation)";
      case FTMO_FUNDED:   return "FTMO (Funded)";
      case THE5ERS:       return "The5ers";
      case ALPHA_CAPITAL: return "Alpha Capital";
      default:            return "FundedNext";
   }
}

void OnTick()
{
   LoadDay();
   bool disabled = dayPnl <= DailyLossFloor || dayPnl >= DailyProfitCap || dayLosses >= MaxLosses;
   Comment(StringFormat("Exhaustion Engine · %s\nStatus: %s\nDaily P&L: %s$%.2f  ·  losses %d/%d",
      ProfileName(), disabled ? (dayPnl >= DailyProfitCap ? "TARGET REACHED" : "DAILY STOP LOCK") : (HasPosition() ? "IN A TRADE" : "ACTIVE"),
      dayPnl >= 0 ? "+" : "-", MathAbs(dayPnl), dayLosses, MaxLosses));

   // Signals on closed bars only (bar 1 = the bar that just closed, as Pine's barstate.isconfirmed)
   datetime bar = iTime(_Symbol, _Period, 0);
   if(bar == lastBar) return;
   lastBar = bar;
   if(disabled || HasPosition()) return;

   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 1, 10, r) < 10) return;   // r[0] = last closed bar
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(atrHandle, 0, 1, 2, atr) < 2) return;

   double body[6], top[6], bot[6];
   for(int i = 0; i < 6; i++)
   {
      body[i] = MathAbs(r[i].close - r[i].open);
      top[i]  = r[i].high - MathMax(r[i].close, r[i].open);
      bot[i]  = MathMin(r[i].close, r[i].open) - r[i].low;
   }
   double avg0 = (body[0] + body[1] + body[2] + body[3] + body[4]) / 5.0;
   double avg1 = (body[1] + body[2] + body[3] + body[4] + body[5]) / 5.0;
   bool red[4], green[4];
   for(int i = 0; i < 4; i++) { red[i] = r[i].close < r[i].open; green[i] = r[i].close > r[i].open; }

   bool exBuy  = red[0] && red[1] && red[2] && red[3];
   bool exSell = green[0] && green[1] && green[2] && green[3];
   bool topRej = top[1] > body[1] * 1.5 && top[1] > atr[1] * 0.8;
   bool botRej = bot[1] > body[1] * 1.5 && bot[1] > atr[1] * 0.8;
   bool strongBear = red[0] && body[0] > avg0 * 1.2 && body[0] > atr[0];
   bool strongBull = green[0] && body[0] > avg0 * 1.2 && body[0] > atr[0];
   bool momBuy  = green[0] && body[0] > avg1 * 3.0 && r[0].close > r[1].high && top[0] < body[0] * 0.2;
   bool momSell = red[0] && body[0] > avg1 * 3.0 && r[0].close < r[1].low && bot[0] < body[0] * 0.2;
   bool buy  = exBuy || (botRej && strongBull) || momBuy;
   bool sell = exSell || (topRej && strongBear) || momSell;
   if(!buy && !sell) return;

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(buy)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double dist = MathMax(r[0].close - (MathMin(r[0].low, r[1].low) - atr[0] * 0.2), StopFloor);
      double sl = NormalizeDouble(ask - dist, digits), tp = NormalizeDouble(ask + dist * TpRatio, digits);
      double lots = LotsFor(dist);
      if(lots <= 0) { Print("Exhaustion Engine: the smallest lot risks more than RiskUsd, buy skipped"); return; }
      if(!trade.Buy(lots, _Symbol, 0, sl, tp, "QB Exhaustion")) Print("Exhaustion Engine: buy rejected: ", trade.ResultRetcodeDescription());
   }
   else
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double dist = MathMax((MathMax(r[0].high, r[1].high) + atr[0] * 0.2) - r[0].close, StopFloor);
      double sl = NormalizeDouble(bid + dist, digits), tp = NormalizeDouble(bid - dist * TpRatio, digits);
      double lots = LotsFor(dist);
      if(lots <= 0) { Print("Exhaustion Engine: the smallest lot risks more than RiskUsd, sell skipped"); return; }
      if(!trade.Sell(lots, _Symbol, 0, sl, tp, "QB Exhaustion")) Print("Exhaustion Engine: sell rejected: ", trade.ResultRetcodeDescription());
   }
}
