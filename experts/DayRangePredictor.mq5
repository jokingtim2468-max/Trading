//+------------------------------------------------------------------+
//| DayRangePredictor.mq5                                            |
//| Predicted daily HIGH / LOW lines + strict reversal signals for   |
//| US100 / NAS100 / USTEC and XAUUSD. Attach to any intraday chart. |
//|                                                                  |
//| Model (no repainting): for every past day                        |
//|   up-move   = (high - open) / ATR                                |
//|   down-move = (open - low)  / ATR                                |
//| where ATR = average daily true range of the prior N days.        |
//| Today's lines = today's open +/- a percentile of the last        |
//| Lookback days of those moves x today's ATR. Only data known at   |
//| the open is used, so lines never move during the day.            |
//|                                                                  |
//| The panel shows a walk-forward test: how often the day's high /  |
//| low really stayed inside the lines drawn that morning, plus the  |
//| win rate of the signals drawn on this chart.                      |
//|                                                                  |
//| This EA does NOT place trades. No indicator is 100% certain.     |
//| Not financial advice.                                            |
//+------------------------------------------------------------------+
#property copyright "Trading"
#property version   "1.00"
#property description "Predicted day high/low lines and high-confidence reversal signals for US100 and XAUUSD."

enum ENUM_DRP_SESSION
  {
   DRP_SESSION_AUTO   = 0, // Auto (Nasdaq or Gold by symbol name)
   DRP_SESSION_NASDAQ = 1, // Nasdaq cash 09:30-16:00 New York
   DRP_SESSION_GOLD   = 2, // Gold London+NY 03:00-12:00 New York
   DRP_SESSION_CUSTOM = 3, // Custom (New York time)
   DRP_SESSION_24H    = 4  // 24h (no session filter)
  };

input group "Trained presets"
input bool   InpUseTrained   = true;  // Use trained presets (US100 or gold picked by symbol)

input group "Predicted day high / low"
input int    InpLookbackDays = 250;   // Lookback days
input int    InpAtrDays      = 14;    // Daily ATR length
input double InpInnerPct     = 50.0;  // Likely line percentile
input double InpOuterPct     = 95.0;  // Max line percentile (higher = more accurate, wider)
input int    InpStatsDays    = 250;   // Accuracy test days
input int    InpHistoryDays  = 5;     // Previous days to keep on chart

input group "High-confidence signals"
input bool   InpShowSignals  = true;  // Show signals
input double InpZonePct      = 85.0;  // Reversal zone starts at percentile
input int    InpMinScore     = 5;     // Filters required (of 5)
input double InpZoneTolAtr   = 0.10;  // Zone tolerance (x daily ATR)
input double InpWickPct      = 40.0;  // Min rejection wick (% of bar)
input int    InpRsiPeriod    = 14;    // RSI period
input double InpRsiOB        = 70.0;  // RSI overbought
input double InpRsiOS        = 30.0;  // RSI oversold
input double InpVwapMult     = 2.0;   // VWAP band (std dev)
input ENUM_DRP_SESSION InpSession = DRP_SESSION_AUTO; // Session filter
input int    InpCustomStart  = 930;   // Custom session start (HHMM New York)
input int    InpCustomEnd    = 1600;  // Custom session end (HHMM New York)
input int    InpServerMinusNY = 99;   // Server time minus New York hours (99 = auto; set it, e.g. 7, in the Strategy Tester)
input double InpSlBufAtr     = 0.05;  // Stop beyond signal bar (x daily ATR)
input double InpRR           = 1.0;   // Target (R multiple)
input bool   InpOnePerSide   = true;  // Max one signal per side per day
input int    InpSignalDays   = 60;    // Days of chart history to scan for signals

input group "Alerts"
input bool   InpAlertPopup   = true;  // Popup alert on new signal
input bool   InpAlertPush    = false; // Push notification to MT5 mobile
input bool   InpAlertSound   = true;  // Sound

input group "Colors"
input color  InpColHigh   = C'242,54,69';   // Predicted high
input color  InpColLow    = C'8,153,129';   // Predicted low
input color  InpColOpen   = C'120,123,134'; // Day open
input color  InpColZoneHi = C'70,30,36';    // Sell zone fill
input color  InpColZoneLo = C'18,58,52';    // Buy zone fill
input color  InpColPanel  = C'19,23,34';    // Panel background
input color  InpColText   = C'209,212,220'; // Panel text

#define PFX "DRP_"

// Per-day model output (oldest first)
datetime g_dayTime[];
double   g_open[], g_high[], g_low[], g_atr[];
double   g_upIn[], g_upZn[], g_upOut[], g_dnIn[], g_dnZn[], g_dnOut[];
bool     g_valid[];
int      g_days = 0;

// Stats
int    g_nDays = 0, g_nHi = 0, g_nLo = 0, g_nBoth = 0;
int    g_nSig = 0, g_nWin = 0, g_nLoss = 0;
double g_sumR = 0.0;

int      g_rsiHandle = INVALID_HANDLE;
datetime g_lastBar = 0;
datetime g_lastAlertBar = 0;
bool     g_built = false;
bool     g_isGold = false;
bool     g_scanReady = false;
string   g_lastSignalText = "";


// === TRAINED PRESETS START (rewritten by tools/train_drp.py, don't edit by hand)
// trained 2026-10-09 on Yahoo Finance NQ=F / GC=F by tools/train_drp.py
const int    T_NQ_LOOKBACK = 180, T_NQ_ATR = 20, T_NQ_SCORE = 5;
const double T_NQ_INNER = 50.0, T_NQ_OUTER = 96.0, T_NQ_ZONE = 85.0, T_NQ_WICK = 40.0,
             T_NQ_OB = 70.0, T_NQ_OS = 30.0, T_NQ_RR = 1.0;
const int    T_GC_LOOKBACK = 375, T_GC_ATR = 20, T_GC_SCORE = 5;
const double T_GC_INNER = 50.0, T_GC_OUTER = 95.5, T_GC_ZONE = 85.0, T_GC_WICK = 40.0,
             T_GC_OB = 70.0, T_GC_OS = 30.0, T_GC_RR = 1.0;
// === TRAINED PRESETS END ===

// Effective settings: trained presets for this symbol, or the inputs when presets are off
int    g_lookback, g_atrDays, g_minScore;
double g_innerPct, g_outerPct, g_zonePct, g_wickPct, g_rsiOB, g_rsiOS, g_rr;

void LoadSettings()
  {
   if(!InpUseTrained)
     {
      g_lookback = InpLookbackDays; g_atrDays = InpAtrDays; g_minScore = InpMinScore;
      g_innerPct = InpInnerPct; g_outerPct = InpOuterPct; g_zonePct = InpZonePct;
      g_wickPct = InpWickPct; g_rsiOB = InpRsiOB; g_rsiOS = InpRsiOS; g_rr = InpRR;
      return;
     }
   if(g_isGold)
     {
      g_lookback = T_GC_LOOKBACK; g_atrDays = T_GC_ATR; g_minScore = T_GC_SCORE;
      g_innerPct = T_GC_INNER; g_outerPct = T_GC_OUTER; g_zonePct = T_GC_ZONE;
      g_wickPct = T_GC_WICK; g_rsiOB = T_GC_OB; g_rsiOS = T_GC_OS; g_rr = T_GC_RR;
     }
   else
     {
      g_lookback = T_NQ_LOOKBACK; g_atrDays = T_NQ_ATR; g_minScore = T_NQ_SCORE;
      g_innerPct = T_NQ_INNER; g_outerPct = T_NQ_OUTER; g_zonePct = T_NQ_ZONE;
      g_wickPct = T_NQ_WICK; g_rsiOB = T_NQ_OB; g_rsiOS = T_NQ_OS; g_rr = T_NQ_RR;
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(PeriodSeconds(_Period) >= PeriodSeconds(PERIOD_D1))
     {
      Print("DayRangePredictor: attach to an intraday chart (M1-H4).");
      return(INIT_PARAMETERS_INCORRECT);
     }
   string s = _Symbol;
   StringToUpper(s);
   g_isGold = (StringFind(s, "XAU") >= 0 || StringFind(s, "GOLD") >= 0);
   LoadSettings();

   g_rsiHandle = iRSI(_Symbol, _Period, InpRsiPeriod, PRICE_CLOSE);
   if(g_rsiHandle == INVALID_HANDLE)
      return(INIT_FAILED);

   EventSetTimer(2);          // builds the chart even when the market is closed
   Rebuild();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_rsiHandle != INVALID_HANDLE)
      IndicatorRelease(g_rsiHandle);
   ObjectsDeleteAll(0, PFX);
   ChartRedraw();
  }

void OnTick()
  {
   datetime t = iTime(_Symbol, _Period, 0);
   if(t != g_lastBar || !g_built)
      Rebuild();
  }

void OnTimer()
  {
   if(!g_built)
      Rebuild();
  }

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
double Percentile(double &src[], int count, double p)
  {
   double tmp[];
   ArrayResize(tmp, count);
   ArrayCopy(tmp, src, 0, 0, count);
   ArraySort(tmp);
   double rank = p / 100.0 * (count - 1);
   int lo = (int)MathFloor(rank);
   int hi = (int)MathCeil(rank);
   if(hi >= count)
      hi = count - 1;
   return tmp[lo] + (tmp[hi] - tmp[lo]) * (rank - lo);
  }

// Second Sunday of March to first Sunday of November (US DST), approximated at 07:00 UTC
bool IsUsDst(datetime utc)
  {
   MqlDateTime d;
   TimeToStruct(utc, d);
   if(d.mon < 3 || d.mon > 11)
      return false;
   if(d.mon > 3 && d.mon < 11)
      return true;
   MqlDateTime f = d;
   f.day = 1; f.hour = 7; f.min = 0; f.sec = 0;
   datetime first = StructToTime(f);
   MqlDateTime fd;
   TimeToStruct(first, fd);
   int firstSunday = 1 + (7 - fd.day_of_week) % 7;
   if(d.mon == 3)
      return utc >= first + (firstSunday + 7 - 1) * 86400;
   return utc < first + (firstSunday - 1) * 86400;
  }

int ServerMinusNyHours()
  {
   if(InpServerMinusNY != 99)
      return InpServerMinusNY;
   datetime gmt = TimeGMT();
   int nyOff = IsUsDst(gmt) ? -4 : -5;
   datetime nyNow = gmt + nyOff * 3600;
   return (int)MathRound((double)(TimeTradeServer() - nyNow) / 3600.0);
  }

bool InSession(datetime serverTime, int serverMinusNy)
  {
   if(InpSession == DRP_SESSION_24H)
      return true;
   int startM = 0, endM = 0;
   ENUM_DRP_SESSION mode = InpSession;
   if(mode == DRP_SESSION_AUTO)
      mode = g_isGold ? DRP_SESSION_GOLD : DRP_SESSION_NASDAQ;
   if(mode == DRP_SESSION_NASDAQ)
     { startM = 9 * 60 + 30; endM = 16 * 60; }
   else if(mode == DRP_SESSION_GOLD)
     { startM = 3 * 60; endM = 12 * 60; }
   else
     {
      startM = (InpCustomStart / 100) * 60 + InpCustomStart % 100;
      endM   = (InpCustomEnd / 100) * 60 + InpCustomEnd % 100;
     }
   MqlDateTime ny;
   TimeToStruct(serverTime - serverMinusNy * 3600, ny);
   int m = ny.hour * 60 + ny.min;
   if(startM <= endM)
      return (m >= startM && m < endM);
   return (m >= startM || m < endM);
  }

int DayIndex(datetime t)
  {
   int lo = 0, hi = g_days - 1, ans = -1;
   while(lo <= hi)
     {
      int mid = (lo + hi) / 2;
      if(g_dayTime[mid] <= t)
        { ans = mid; lo = mid + 1; }
      else
         hi = mid - 1;
     }
   return ans;
  }

//+------------------------------------------------------------------+
//| Daily model                                                      |
//+------------------------------------------------------------------+
bool BuildDaily()
  {
   int want = g_lookback + g_atrDays + MathMax(InpStatsDays, MathMax(InpSignalDays, InpHistoryDays)) + 5;
   MqlRates d[];
   ArraySetAsSeries(d, false);
   int n = CopyRates(_Symbol, PERIOD_D1, 0, want, d);
   if(n < g_atrDays + 60)
     {
      Print("DayRangePredictor: waiting for daily history (", n, " days loaded).");
      return false;
     }
   g_days = n;
   ArrayResize(g_dayTime, n); ArrayResize(g_open, n); ArrayResize(g_high, n); ArrayResize(g_low, n);
   ArrayResize(g_atr, n); ArrayResize(g_upIn, n); ArrayResize(g_upZn, n); ArrayResize(g_upOut, n);
   ArrayResize(g_dnIn, n); ArrayResize(g_dnZn, n); ArrayResize(g_dnOut, n); ArrayResize(g_valid, n);

   double tr[], upR[], dnR[];
   ArrayResize(tr, n); ArrayResize(upR, n); ArrayResize(dnR, n);
   for(int i = 0; i < n; i++)
     {
      g_dayTime[i] = d[i].time;
      g_open[i] = d[i].open; g_high[i] = d[i].high; g_low[i] = d[i].low;
      tr[i] = (i == 0) ? d[i].high - d[i].low
              : MathMax(d[i].high, d[i - 1].close) - MathMin(d[i].low, d[i - 1].close);
      g_atr[i] = 0.0;
      if(i > g_atrDays)
        {
         double s = 0.0;
         for(int k = i - g_atrDays; k < i; k++)
            s += tr[k];
         g_atr[i] = s / g_atrDays;
        }
      upR[i] = g_atr[i] > 0 ? (d[i].high - d[i].open) / g_atr[i] : EMPTY_VALUE;
      dnR[i] = g_atr[i] > 0 ? (d[i].open - d[i].low) / g_atr[i] : EMPTY_VALUE;
     }

   // Walk-forward percentiles: day i uses only days before i
   double bufU[], bufD[];
   ArrayResize(bufU, g_lookback);
   ArrayResize(bufD, g_lookback);
   int minHist = MathMin(g_lookback, 100);
   for(int i = 0; i < n; i++)
     {
      g_valid[i] = false;
      int c = 0;
      for(int k = i - 1; k >= 0 && c < g_lookback; k--)
        {
         if(upR[k] == EMPTY_VALUE)
            break;
         bufU[c] = upR[k];
         bufD[c] = dnR[k];
         c++;
        }
      if(c < minHist || g_atr[i] <= 0)
         continue;
      g_upIn[i]  = Percentile(bufU, c, g_innerPct);
      g_upZn[i]  = Percentile(bufU, c, g_zonePct);
      g_upOut[i] = Percentile(bufU, c, g_outerPct);
      g_dnIn[i]  = Percentile(bufD, c, g_innerPct);
      g_dnZn[i]  = Percentile(bufD, c, g_zonePct);
      g_dnOut[i] = Percentile(bufD, c, g_outerPct);
      g_valid[i] = true;
     }

   // Accuracy on completed days (exclude today, index n-1)
   g_nDays = g_nHi = g_nLo = g_nBoth = 0;
   for(int i = n - 2; i >= 0 && i >= n - 1 - InpStatsDays; i--)
     {
      if(!g_valid[i])
         continue;
      bool hiOk = g_high[i] <= g_open[i] + g_upOut[i] * g_atr[i];
      bool loOk = g_low[i]  >= g_open[i] - g_dnOut[i] * g_atr[i];
      g_nDays++;
      if(hiOk) g_nHi++;
      if(loOk) g_nLo++;
      if(hiOk && loOk) g_nBoth++;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Drawing                                                          |
//+------------------------------------------------------------------+
void HLine(string name, datetime t1, datetime t2, double price, color c, ENUM_LINE_STYLE st, int w)
  {
   ObjectCreate(0, name, OBJ_TREND, 0, t1, price, t2, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_STYLE, st);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, w);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
  }

void Zone(string name, datetime t1, datetime t2, double p1, double p2, color c)
  {
   ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_FILL, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
  }

void Text(string name, datetime t, double price, string txt, color c, ENUM_ANCHOR_POINT anchor)
  {
   ObjectCreate(0, name, OBJ_TEXT, 0, t, price);
   ObjectSetString(0, name, OBJPROP_TEXT, txt);
   ObjectSetString(0, name, OBJPROP_FONT, "Segoe UI");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
  }

void PanelRow(int row, string left, string right, color c)
  {
   int y = 28 + row * 17;
   string l = PFX + "pl" + IntegerToString(row);
   string r = PFX + "pr" + IntegerToString(row);
   ObjectCreate(0, l, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, l, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, l, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, l, OBJPROP_XDISTANCE, 300);
   ObjectSetInteger(0, l, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, l, OBJPROP_TEXT, left);
   ObjectSetString(0, l, OBJPROP_FONT, "Segoe UI");
   ObjectSetInteger(0, l, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, l, OBJPROP_COLOR, c);
   ObjectSetInteger(0, l, OBJPROP_SELECTABLE, false);
   ObjectCreate(0, r, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, r, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, r, OBJPROP_ANCHOR, ANCHOR_RIGHT_UPPER);
   ObjectSetInteger(0, r, OBJPROP_XDISTANCE, 18);
   ObjectSetInteger(0, r, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, r, OBJPROP_TEXT, right);
   ObjectSetString(0, r, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, r, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, r, OBJPROP_COLOR, c);
   ObjectSetInteger(0, r, OBJPROP_SELECTABLE, false);
  }

string Pct(int a, int b)
  {
   if(b <= 0)
      return "n/a";
   return DoubleToString(100.0 * a / b, 1) + "%";
  }

string Px(double p) { return DoubleToString(p, _Digits); }

void DrawLevels()
  {
   int last = g_days - 1;
   int dayLen = PeriodSeconds(PERIOD_D1);
   for(int i = last; i >= 0 && i >= last - InpHistoryDays; i--)
     {
      if(!g_valid[i])
         continue;
      datetime t1 = g_dayTime[i];
      datetime t2 = (i < last) ? g_dayTime[i + 1] : t1 + dayLen;
      string id = IntegerToString((long)t1);
      double hiIn  = g_open[i] + g_upIn[i]  * g_atr[i];
      double hiZn  = g_open[i] + g_upZn[i]  * g_atr[i];
      double hiOut = g_open[i] + g_upOut[i] * g_atr[i];
      double loIn  = g_open[i] - g_dnIn[i]  * g_atr[i];
      double loZn  = g_open[i] - g_dnZn[i]  * g_atr[i];
      double loOut = g_open[i] - g_dnOut[i] * g_atr[i];
      Zone(PFX + "zh" + id, t1, t2, hiZn, hiOut, InpColZoneHi);
      Zone(PFX + "zl" + id, t1, t2, loOut, loZn, InpColZoneLo);
      HLine(PFX + "op" + id, t1, t2, g_open[i], InpColOpen, STYLE_DOT, 1);
      HLine(PFX + "hi" + id, t1, t2, hiIn, InpColHigh, STYLE_DASH, 1);
      HLine(PFX + "ho" + id, t1, t2, hiOut, InpColHigh, STYLE_SOLID, 2);
      HLine(PFX + "li" + id, t1, t2, loIn, InpColLow, STYLE_DASH, 1);
      HLine(PFX + "lo" + id, t1, t2, loOut, InpColLow, STYLE_SOLID, 2);
      if(i == last)
        {
         Text(PFX + "tho", t2, hiOut, "Max HIGH P" + DoubleToString(g_outerPct, 0) + "  " + Px(hiOut), InpColHigh, ANCHOR_RIGHT_LOWER);
         Text(PFX + "thi", t2, hiIn, "Likely HIGH P" + DoubleToString(g_innerPct, 0) + "  " + Px(hiIn), InpColHigh, ANCHOR_RIGHT_LOWER);
         Text(PFX + "tli", t2, loIn, "Likely LOW P" + DoubleToString(g_innerPct, 0) + "  " + Px(loIn), InpColLow, ANCHOR_RIGHT_UPPER);
         Text(PFX + "tlo", t2, loOut, "Max LOW P" + DoubleToString(g_outerPct, 0) + "  " + Px(loOut), InpColLow, ANCHOR_RIGHT_UPPER);
        }
     }
  }

//+------------------------------------------------------------------+
//| Signals: scan closed chart bars, track outcomes                   |
//+------------------------------------------------------------------+
datetime ScanSignals()
  {
   g_nSig = g_nWin = g_nLoss = 0;
   g_sumR = 0.0;
   g_scanReady = true;
   datetime lastSignalBar = 0;
   if(!InpShowSignals || g_days < 2)
      return 0;

   int firstDay = MathMax(0, g_days - 1 - InpSignalDays);
   datetime from = g_dayTime[firstDay];
   int bars = Bars(_Symbol, _Period, from, TimeCurrent());
   bars = MathMin(bars + 5, Bars(_Symbol, _Period));
   if(bars < InpRsiPeriod + 5)
      return 0;
   if(BarsCalculated(g_rsiHandle) < bars)
     {
      g_scanReady = false;     // RSI still loading, timer will retry
      return 0;
     }

   MqlRates r[];
   double rsi[];
   ArraySetAsSeries(r, false);
   ArraySetAsSeries(rsi, false);
   int nr = CopyRates(_Symbol, _Period, 1, bars, r);        // closed bars only
   int ni = CopyBuffer(g_rsiHandle, 0, 1, bars, rsi);
   if(nr <= 3 || ni != nr)
      return 0;

   int srvNy = ServerMinusNyHours();
   int curDay = -1;
   double sumV = 0, sumPV = 0, sumP2V = 0;
   bool soldToday = false, boughtToday = false;
   int tDir = 0;
   double tSL = 0, tTP = 0;

   for(int i = 0; i < nr; i++)
     {
      int di = DayIndex(r[i].time);
      if(di < 0)
         continue;
      if(di != curDay)
        {
         curDay = di;
         sumV = sumPV = sumP2V = 0;
         soldToday = boughtToday = false;
        }
      // anchored VWAP with std-dev bands (tick volume)
      double tp = (r[i].high + r[i].low + r[i].close) / 3.0;
      double v = (double)(r[i].real_volume > 0 ? r[i].real_volume : r[i].tick_volume);
      if(v <= 0) v = 1;
      sumV += v; sumPV += tp * v; sumP2V += tp * tp * v;
      double vw = sumPV / sumV;
      double sd = MathSqrt(MathMax(0.0, sumP2V / sumV - vw * vw));
      double extU = vw + InpVwapMult * sd;
      double extL = vw - InpVwapMult * sd;

      // manage open signal (stop checked first = conservative)
      if(tDir != 0)
        {
         bool hitSL = (tDir < 0) ? r[i].high >= tSL : r[i].low <= tSL;
         bool hitTP = (tDir < 0) ? r[i].low <= tTP : r[i].high >= tTP;
         if(hitSL)      { g_nLoss++; g_sumR -= 1.0; tDir = 0; }
         else if(hitTP) { g_nWin++;  g_sumR += g_rr; tDir = 0; }
        }

      if(i < 3 || !g_valid[di] || tDir != 0)
         continue;

      double atr  = g_atr[di];
      double hiZn = g_open[di] + g_upZn[di] * atr;
      double hiOut= g_open[di] + g_upOut[di] * atr;
      double loZn = g_open[di] - g_dnZn[di] * atr;
      double loOut= g_open[di] - g_dnOut[di] * atr;
      double rng  = r[i].high - r[i].low;
      if(rng <= 0)
         continue;
      bool sess = InSession(r[i].time, srvNy);
      double rMax = MathMax(rsi[i], MathMax(rsi[i - 1], rsi[i - 2]));
      double rMin = MathMin(rsi[i], MathMin(rsi[i - 1], rsi[i - 2]));

      // SELL: fade the predicted high
      bool s1 = r[i].high >= hiZn - InpZoneTolAtr * atr;
      bool s2 = r[i].close < r[i].open && (r[i].high - MathMax(r[i].open, r[i].close)) >= g_wickPct / 100.0 * rng && r[i].close < hiOut;
      bool s3 = rMax >= g_rsiOB && rsi[i] < rsi[i - 1];
      bool s4 = r[i].high >= extU;
      int  sScore = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0) + (s4 ? 1 : 0) + (sess ? 1 : 0);

      // BUY: fade the predicted low
      bool b1 = r[i].low <= loZn + InpZoneTolAtr * atr;
      bool b2 = r[i].close > r[i].open && (MathMin(r[i].open, r[i].close) - r[i].low) >= g_wickPct / 100.0 * rng && r[i].close > loOut;
      bool b3 = rMin <= g_rsiOS && rsi[i] > rsi[i - 1];
      bool b4 = r[i].low <= extL;
      int  bScore = (b1 ? 1 : 0) + (b2 ? 1 : 0) + (b3 ? 1 : 0) + (b4 ? 1 : 0) + (sess ? 1 : 0);

      int dir = 0, score = 0;
      if(s1 && sScore >= g_minScore && !(InpOnePerSide && soldToday))
        { dir = -1; score = sScore; }
      else if(b1 && bScore >= g_minScore && !(InpOnePerSide && boughtToday))
        { dir = 1; score = bScore; }
      if(dir == 0)
         continue;

      double entry = r[i].close;
      if(dir < 0)
        {
         tSL = r[i].high + InpSlBufAtr * atr;
         tTP = entry - g_rr * (tSL - entry);
         soldToday = true;
        }
      else
        {
         tSL = r[i].low - InpSlBufAtr * atr;
         tTP = entry + g_rr * (entry - tSL);
         boughtToday = true;
        }
      tDir = dir;
      g_nSig++;
      lastSignalBar = r[i].time;

      string id = IntegerToString((long)r[i].time);
      string arrow = PFX + "sa" + id;
      double y = dir < 0 ? r[i].high : r[i].low;
      ObjectCreate(0, arrow, OBJ_ARROW, 0, r[i].time, y);
      ObjectSetInteger(0, arrow, OBJPROP_ARROWCODE, dir < 0 ? 234 : 233);
      ObjectSetInteger(0, arrow, OBJPROP_ANCHOR, dir < 0 ? ANCHOR_BOTTOM : ANCHOR_TOP);
      ObjectSetInteger(0, arrow, OBJPROP_COLOR, dir < 0 ? InpColHigh : InpColLow);
      ObjectSetInteger(0, arrow, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, arrow, OBJPROP_SELECTABLE, false);
      string txt = (dir < 0 ? "SELL " : "BUY ") + IntegerToString(score) + "/5  SL " + Px(tSL) + "  TP " + Px(tTP);
      Text(PFX + "st" + id, r[i].time, y, txt, dir < 0 ? InpColHigh : InpColLow, dir < 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);

      if(i == nr - 1)
         g_lastSignalText = txt;
     }
   return lastSignalBar;
  }

void DrawPanel()
  {
   string bg = PFX + "panel";
   ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, 310);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, 20);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, 300);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, 186);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, InpColPanel);
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR, C'54,58,69');
   ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);

   int i = g_days - 1;
   PanelRow(0, "Day Range Predictor", _Symbol, InpColText);
   if(i >= 0 && g_valid[i])
     {
      double a = g_atr[i];
      PanelRow(1, "Max HIGH (P" + DoubleToString(g_outerPct, 0) + ")", Px(g_open[i] + g_upOut[i] * a), InpColHigh);
      PanelRow(2, "Likely HIGH (P" + DoubleToString(g_innerPct, 0) + ")", Px(g_open[i] + g_upIn[i] * a), InpColHigh);
      PanelRow(3, "Likely LOW (P" + DoubleToString(g_innerPct, 0) + ")", Px(g_open[i] - g_dnIn[i] * a), InpColLow);
      PanelRow(4, "Max LOW (P" + DoubleToString(g_outerPct, 0) + ")", Px(g_open[i] - g_dnOut[i] * a), InpColLow);
     }
   else
      PanelRow(1, "Not enough daily history yet", "", InpColHigh);
   PanelRow(5, "High stayed under max line", Pct(g_nHi, g_nDays) + " of " + IntegerToString(g_nDays) + "d", InpColText);
   PanelRow(6, "Low stayed above max line", Pct(g_nLo, g_nDays) + " of " + IntegerToString(g_nDays) + "d", InpColText);
   PanelRow(7, "Both lines held", Pct(g_nBoth, g_nDays), InpColText);
   int closed = g_nWin + g_nLoss;
   PanelRow(8, "Signals last " + IntegerToString(InpSignalDays) + "d (" + IntegerToString(g_nSig) + ")",
            "win " + Pct(g_nWin, closed) + "  " + (g_sumR >= 0 ? "+" : "") + DoubleToString(g_sumR, 1) + "R",
            g_sumR >= 0 ? InpColLow : InpColHigh);
   PanelRow(9, "Not 100% - past results, not a promise", "", C'120,123,134');
  }

//+------------------------------------------------------------------+
void Rebuild()
  {
   if(!BuildDaily())
      return;
   ObjectsDeleteAll(0, PFX);
   g_lastSignalText = "";
   DrawLevels();
   datetime lastSig = ScanSignals();
   DrawPanel();
   ChartRedraw();
   g_lastBar = iTime(_Symbol, _Period, 0);

   // Alert only for a signal on the bar that just closed, once
   datetime justClosed = iTime(_Symbol, _Period, 1);
   if(g_built && lastSig != 0 && lastSig == justClosed && lastSig != g_lastAlertBar)
     {
      g_lastAlertBar = lastSig;
      string msg = "DayRangePredictor " + _Symbol + " " + EnumToString(_Period) + ": " + g_lastSignalText;
      if(InpAlertPopup) Alert(msg);
      if(InpAlertPush)  SendNotification(msg);
      if(InpAlertSound) PlaySound("alert.wav");
     }
   if(!g_built)
      g_lastAlertBar = lastSig;   // don't alert old signals on first load
   g_built = g_scanReady;
  }
//+------------------------------------------------------------------+
