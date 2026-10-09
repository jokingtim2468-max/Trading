//+------------------------------------------------------------------+
//| DayRangePredictor.mq5                                            |
//| Live predicted day HIGH (green), LOW (red) and BUILD-UP (yellow) |
//| lines, flow lines, max envelope and strict reversal signals for  |
//| US100 / NAS100 / USTEC and XAUUSD. Attach to an intraday chart.  |
//|                                                                  |
//| GREEN  = high so far + the extra move the day still usually      |
//|          makes, looked up by hour of the day and where price     |
//|          sits in its range (trained tables).                     |
//| RED    = low so far - the same downward.                         |
//| YELLOW = blend of the predicted midpoint and the price where     |
//|          the most trading has happened so far (build-up/support).|
//| Flow lines = projected path from price now to the predicted      |
//|          high/low at the hour they usually happen, then into     |
//|          the build-up level by the close.                        |
//| Dots   = bar where price reached the line predicted the bar      |
//|          before.                                                 |
//|                                                                  |
//| Every value on a bar uses only data up to that bar. Settings and |
//| tables are trained on recent Yahoo Finance data by               |
//| tools/train_drp.py. This EA does NOT place trades. No indicator  |
//| is 100% certain. Not financial advice.                           |
//+------------------------------------------------------------------+
#property copyright "Trading"
#property version   "2.00"
#property description "Live predicted day high/low/build-up lines, flow lines and reversal signals for US100 and XAUUSD."

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

input group "Live high / low / build-up"
input bool   InpShowLive     = false; // Show live (moving) predicted high, low and build-up
input bool   InpShowFlow     = false; // Show flow lines (projected path; replaced by AI TP/SL)
input bool   InpShowTouch    = true;  // Mark where price reached the line
input double InpTouchTolAtr  = 0.03;  // Reached = within (x daily ATR)
input int    InpLiveDays     = 1;     // Previous days of live lines to keep

enum ENUM_DRP_LOCK
  {
   DRP_LOCK_AUTO    = 0, // Auto (Nasdaq: regular + after-market, gold: full day)
   DRP_LOCK_DAY     = 1, // Full day (6 PM to 5 PM New York)
   DRP_LOCK_SESSION = 2, // Regular session + after-market (Nasdaq)
   DRP_LOCK_ALL     = 3  // All
  };

input group "Display"
input bool   InpShowPanel    = false; // Show the info panel (top right)

input group "Locked lines (set once per session, never moved)"
input ENUM_DRP_LOCK InpLockMode = DRP_LOCK_AUTO; // Sessions
input int    InpLockHist     = 0;     // Previous sessions to keep as short segments (0 = only the current lines)

input group "Short-term projection (next hour)"
input bool   InpShowBand     = true;  // Show the 80% band for the next hour
input bool   InpShowGhost    = true;  // Show projected candles (typical size, direction unknown)
input color  InpColBand      = C'79,195,247'; // Band colour

input group "AI quick-trade TP / SL"
input bool   InpShowAI       = true;  // Show AI TP (green) / SL (red) lines
input int    InpAIMaxAgeSec  = 300;   // Use the AI service file when newer than (seconds)
input int    InpAIBars       = 12;    // Draw TP/SL lines this many bars ahead

input group "Max envelope (day open lines)"
input bool   InpShowMax      = false; // Show max high / low lines
input int    InpLookbackDays = 250;   // Lookback days
input int    InpAtrDays      = 14;    // Daily ATR length
input double InpOuterPct     = 95.0;  // Max line percentile
input int    InpStatsDays    = 250;   // Accuracy test days
input int    InpHistoryDays  = 5;     // Previous days of max lines to keep

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
input ENUM_DRP_SESSION InpSession = DRP_SESSION_AUTO; // Session
input int    InpCustomStart  = 930;   // Custom session start (HHMM New York)
input int    InpCustomEnd    = 1600;  // Custom session end (HHMM New York)
input int    InpServerMinusNY = 99;   // Server time minus New York hours (99 = auto; set it, e.g. 7, in the Strategy Tester)
input double InpSlBufAtr     = 0.05;  // Stop beyond signal bar (x daily ATR)
input double InpRR           = 1.0;   // Target (R multiple)
input bool   InpOnePerSide   = true;  // Max one signal per side per day
input int    InpScanDays     = 60;    // Days of chart history to scan (signals and accuracy)

input group "Alerts"
input bool   InpAlertPopup   = true;  // Popup alert on new signal
input bool   InpAlertTouch   = false; // Also alert when price reaches the predicted high/low
input bool   InpAlertPush    = false; // Push notification to MT5 mobile
input bool   InpAlertSound   = true;  // Sound

input group "Colors"
input color  InpColHigh   = C'0,230,118';   // High (green)
input color  InpColLow    = C'255,82,82';   // Low (red)
input color  InpColBuild  = C'255,214,0';   // Build-up / midpoint (yellow)
input color  InpColOpen   = C'120,123,134'; // Day open
input color  InpColZoneHi = C'14,52,34';    // High zone fill
input color  InpColZoneLo = C'60,24,28';    // Low zone fill
input color  InpColPanel  = C'19,23,34';    // Panel background
input color  InpColText   = C'209,212,220'; // Panel text

#define PFX       "DRP_"
#define PROF_HALF 60      // profile bins each side of the open (bin = 0.05 x ATR, covers +/- 3 ATR)
#define PROF_STEP 0.05

// Per-day model output (oldest first)
datetime g_dayTime[];
double   g_open[], g_high[], g_low[], g_atr[];
double   g_upZn[], g_upOut[], g_dnZn[], g_dnOut[];
bool     g_valid[];
int      g_days = 0;

// Max-line accuracy and signal stats
int    g_nDays = 0, g_nHi = 0, g_nLo = 0;
int    g_nSig = 0, g_nWin = 0, g_nLoss = 0;
double g_sumR = 0.0;

// Live-line accuracy (prediction at the day open and at session start vs the real day)
double g_missOH = 0, g_missOL = 0, g_missSH = 0, g_missSL = 0, g_missSB = 0;
int    g_nOpenDays = 0, g_nSessDays = 0;

// Current values for the panel
double g_curHi = 0, g_curLo = 0, g_curBuild = 0;

// Quick-trade model (price only, used when the AI service isn't running)
double g_sMu[12], g_sSd[12], g_sCoef[13];
double g_sThr = 0.5, g_sTp = 1, g_sSl = 1, g_sWin = 0, g_sEv = 0, g_sEdge = 0;
double g_pLocal = -1, g_atr5 = 0;
string g_aiRow1 = "", g_aiRow2 = "", g_aiRow3 = "";
color  g_aiCol = clrGray;

int      g_rsiHandle = INVALID_HANDLE;
datetime g_lastBar = 0;
datetime g_lastAlertBar = 0;
datetime g_lastTouchAlert = 0;
bool     g_built = false;
bool     g_dirty = false;
bool     g_isGold = false;
bool     g_scanReady = false;
string   g_lastSignalText = "";
string   g_lastTouchText = "";

// === TRAINED PRESETS START (rewritten by tools/train_drp.py, don't edit by hand)
// trained 2026-10-09 on Yahoo Finance NQ=F / GC=F by tools/train_drp.py
const int    T_NQ_LOOKBACK = 180, T_NQ_ATR = 20, T_NQ_SCORE = 5;
const double T_NQ_INNER = 50.0, T_NQ_OUTER = 96.0, T_NQ_ZONE = 85.0, T_NQ_WICK = 40.0,
             T_NQ_OB = 70.0, T_NQ_OS = 30.0, T_NQ_RR = 1.0;
double T_NQ_SMU[12] = {0.007954, 0.025259, 0.141892, 0.676208, 0.021903, 0.693686, 0.043886, -0.000672, 0.055961, -0.0046, 0.374653, 0.421174};
double T_NQ_SSD[12] = {0.679085, 1.139551, 2.183074, 5.156321, 0.241412, 3.903219, 0.303331, 0.478573, 0.689588, 0.722073, 0.179581, 0.242149};
double T_NQ_SCOEF[13] = {0.073004, -0.007831, -0.008572, 0.050221, 0.11156, -0.115698, 0.071423, 0.039605, 0.001976, -0.065377, -0.005395, 0.127103, -0.080269};
const double T_NQ_STHR = 0.5;
const double T_NQ_STP = 3.0;
const double T_NQ_SSL = 2.0;
const double T_NQ_SWIN = 0.464;
const double T_NQ_SEV = 0.003;
const double T_NQ_SEDGE = 1.0;
double T_NQ_BANDRTH[36] = {-0.7553, 0.0135, 0.7894, -1.0254, 0.0266, 1.0723, -1.2639, 0.0422, 1.338, -1.459, 0.0263, 1.4959, -1.6128, 0.0191, 1.659, -1.7807, 0.0563, 1.8236, -1.9386, 0.0556, 1.9671, -1.9717, 0.0544, 2.0805, -2.0533, 0.0575, 2.1966, -2.1519, 0.0845, 2.3274, -2.1985, 0.0857, 2.4122, -2.25, 0.0741, 2.4664};
double T_NQ_BANDOFF[36] = {-0.8116, 0.0, 0.8281, -1.155, 0.0165, 1.1713, -1.4525, 0.0407, 1.4716, -1.6466, 0.0391, 1.6831, -1.8609, 0.0499, 1.8916, -2.0549, 0.0583, 2.1445, -2.2606, 0.0584, 2.3263, -2.4173, 0.0612, 2.5148, -2.5765, 0.0789, 2.6713, -2.7407, 0.0995, 2.8494, -2.873, 0.1043, 3.0039, -3.019, 0.1181, 3.1765};
double T_NQ_SHAPE[72] = {0.3311, 0.1803, 0.2018, 0.5049, 0.1979, 0.1969, 0.4323, 0.1887, 0.1978, 0.4076, 0.1951, 0.2156, 0.4205, 0.2069, 0.1896, 0.3803, 0.1742, 0.1899, 0.404, 0.1768, 0.2023, 0.4332, 0.2136, 0.2126, 0.4362, 0.1928, 0.2331, 0.4841, 0.2576, 0.2621, 0.384, 0.1828, 0.1882, 0.3507, 0.1686, 0.1877, 0.3626, 0.1704, 0.1742, 0.3374, 0.2115, 0.18, 0.3842, 0.2063, 0.2195, 0.4271, 0.2121, 0.2544, 0.2483, 0.1258, 0.1339, 0.0, 0.0, 0.0, 0.3134, 0.1991, 0.2014, 0.3486, 0.1982, 0.2164, 0.4801, 0.227, 0.2397, 0.423, 0.1683, 0.2279, 0.3767, 0.156, 0.1847, 0.3552, 0.1906, 0.1908};
double T_NQ_DAYUP[14] = {0.089527, 0.136896, -0.113073, 0.27997, 0.122335, 0.100114, -0.075293, -0.03056, -0.037067, 0.141976, -0.086927, 0.00318, 0.014354, -0.031031};
double T_NQ_DAYDN[14] = {0.217592, -0.20643, -0.140873, 0.082428, 0.046205, 0.059731, 0.210747, 0.236948, 0.020192, 0.12745, -0.068849, 0.002925, -0.070145, -0.028767};
double T_NQ_RTHUP[14] = {0.052677, -0.002677, -0.118568, 0.106759, 0.109282, 0.088568, 0.054195, 0.065587, -0.033362, 0.179636, -0.064753, -0.001576, 0.014124, -0.016889};
double T_NQ_RTHDN[14] = {0.189003, 0.078189, 0.002603, 0.081517, -0.107045, 0.026586, 0.000671, -0.017511, 0.221889, 0.184847, -0.064504, 0.003739, -0.072943, -0.040605};
const double T_NQ_AHUP = 0.2522;
const double T_NQ_AHDN = 0.2286;
double T_NQ_EXTUP[72] = {0.261, 0.323, 0.378, 0.241, 0.276, 0.353, 0.178, 0.184, 0.334, 0.101, 0.245, 0.349, 0.12, 0.213, 0.323, 0.12, 0.209, 0.296, 0.071, 0.242, 0.302, 0.079, 0.194, 0.309, 0.061, 0.185, 0.3, 0.007, 0.138, 0.299, 0.008, 0.121, 0.283, 0.0, 0.115, 0.283, 0.0, 0.082, 0.278, 0.0, 0.093, 0.237, 0.0, 0.088, 0.208, 0.0, 0.006, 0.17, 0.0, 0.0, 0.13, 0.0, 0.0, 0.079, 0.0, 0.0, 0.044, 0.0, 0.0, 0.017, 0.0, 0.0, 0.002, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
double T_NQ_EXTDN[72] = {0.341, 0.325, 0.267, 0.357, 0.3, 0.227, 0.342, 0.295, 0.156, 0.316, 0.267, 0.119, 0.33, 0.257, 0.124, 0.341, 0.244, 0.108, 0.371, 0.216, 0.096, 0.353, 0.163, 0.094, 0.325, 0.158, 0.069, 0.316, 0.197, 0.032, 0.279, 0.193, 0.0, 0.251, 0.204, 0.0, 0.244, 0.192, 0.0, 0.238, 0.133, 0.0, 0.143, 0.123, 0.0, 0.237, 0.0, 0.0, 0.131, 0.0, 0.0, 0.119, 0.0, 0.0, 0.097, 0.0, 0.0, 0.053, 0.0, 0.0, 0.009, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
double T_NQ_BUILDW[24] = {0.0, 0.1, 0.3, 0.35, 0.35, 0.5, 0.6, 0.7, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0};
double T_NQ_THI[24] = {16.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 18.5, 18.5, 18.5, 18.5, 19.5, 19.5, 20.5, 21.5, 21.5, 21.5, 21.5, 21.5, 22.5, 23.0, 23.5};
double T_NQ_TLO[24] = {16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 17.5, 17.5, 17.5, 18.5, 18.5, 18.5, 19.5, 20.5, 21.5, 21.5, 21.5, 22.5, 22.5, 23.0, 23.5};
const int    T_GC_LOOKBACK = 375, T_GC_ATR = 20, T_GC_SCORE = 5;
const double T_GC_INNER = 50.0, T_GC_OUTER = 95.5, T_GC_ZONE = 85.0, T_GC_WICK = 40.0,
             T_GC_OB = 70.0, T_GC_OS = 30.0, T_GC_RR = 1.0;
double T_GC_SMU[12] = {0.002926, 0.006919, 0.021483, 0.130953, 0.002725, 0.189188, 0.00803, -0.000694, 0.055594, -0.001667, 0.398393, 0.414271};
double T_GC_SSD[12] = {0.67542, 1.14534, 2.186624, 5.05477, 0.240564, 4.202209, 0.304832, 0.470372, 0.688532, 0.723121, 0.226974, 0.279608};
double T_GC_SCOEF[13] = {-0.007124, -0.014333, -0.005746, 0.109502, 0.000482, -0.131606, 0.012976, 0.099046, 0.040842, 0.002212, -0.008471, 0.049105, -0.039264};
const double T_GC_STHR = 0.55;
const double T_GC_STP = 3.0;
const double T_GC_SSL = 1.0;
const double T_GC_SWIN = 0.291;
const double T_GC_SEV = -0.219;
const double T_GC_SEDGE = 0.0;
double T_GC_BANDRTH[36] = {-0.7667, 0.0, 0.7368, -1.0621, -0.0149, 1.0175, -1.3116, -0.0189, 1.2062, -1.4997, -0.034, 1.4287, -1.6234, -0.0504, 1.5769, -1.767, -0.0605, 1.7037, -1.9195, -0.0583, 1.8239, -2.0131, -0.0828, 1.9355, -2.1321, -0.0689, 2.0626, -2.2111, -0.0644, 2.1688, -2.3131, -0.0724, 2.2309, -2.4444, -0.0665, 2.2822};
double T_GC_BANDOFF[36] = {-0.8288, 0.0, 0.853, -1.1819, 0.0, 1.2434, -1.4583, -0.0139, 1.5686, -1.6898, 0.0, 1.8298, -1.9294, 0.0, 2.0703, -2.1127, 0.0, 2.2683, -2.2978, 0.0197, 2.4606, -2.4843, 0.0134, 2.6502, -2.65, 0.0338, 2.8279, -2.8082, 0.022, 3.0546, -2.9757, 0.0338, 3.2193, -3.1151, 0.0283, 3.3984};
double T_GC_SHAPE[72] = {0.3565, 0.1839, 0.1943, 0.5715, 0.2319, 0.2434, 0.3685, 0.1649, 0.1846, 0.3925, 0.2233, 0.2029, 0.4253, 0.1969, 0.2029, 0.3903, 0.1922, 0.187, 0.404, 0.1892, 0.1987, 0.4366, 0.2191, 0.2264, 0.502, 0.228, 0.2606, 0.4235, 0.234, 0.2014, 0.384, 0.1853, 0.1851, 0.3858, 0.1923, 0.1805, 0.3456, 0.1707, 0.1622, 0.3552, 0.2114, 0.1828, 0.4255, 0.179, 0.1844, 0.3977, 0.1984, 0.2068, 0.3117, 0.1531, 0.154, 0.0, 0.0, 0.0, 0.3615, 0.2154, 0.1816, 0.4011, 0.2017, 0.2197, 0.5074, 0.208, 0.2413, 0.4549, 0.2117, 0.2164, 0.3895, 0.1621, 0.1799, 0.3368, 0.1564, 0.1625};
double T_GC_DAYUP[14] = {0.070614, -0.056609, -0.00668, -0.081058, -0.127883, 0.136338, 0.055917, 0.06767, 0.382608, 0.28732, -0.041411, 0.002432, -0.064543, 0.026655};
double T_GC_DAYDN[14] = {0.170732, -0.01836, 0.009956, -0.075268, -0.286886, 0.088179, 0.089454, 0.077625, 0.261585, 0.358765, 0.012598, 0.012223, 0.043821, -0.015953};
double T_GC_EXTUP[72] = {0.294, 0.312, 0.413, 0.239, 0.301, 0.365, 0.173, 0.301, 0.303, 0.013, 0.235, 0.329, 0.0, 0.227, 0.32, 0.0, 0.187, 0.294, 0.0, 0.162, 0.3, 0.0, 0.143, 0.304, 0.0, 0.11, 0.268, 0.0, 0.03, 0.259, 0.0, 0.008, 0.221, 0.0, 0.029, 0.204, 0.0, 0.018, 0.175, 0.0, 0.0, 0.165, 0.0, 0.0, 0.114, 0.0, 0.0, 0.078, 0.0, 0.0, 0.031, 0.0, 0.0, 0.004, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
double T_GC_EXTDN[72] = {0.301, 0.347, 0.236, 0.392, 0.232, 0.199, 0.342, 0.203, 0.074, 0.38, 0.125, 0.0, 0.338, 0.066, 0.0, 0.313, 0.09, 0.0, 0.307, 0.114, 0.0, 0.283, 0.059, 0.0, 0.276, 0.02, 0.0, 0.255, 0.067, 0.0, 0.245, 0.038, 0.0, 0.209, 0.0, 0.0, 0.207, 0.0, 0.0, 0.209, 0.0, 0.0, 0.163, 0.0, 0.0, 0.082, 0.0, 0.0, 0.036, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
double T_GC_BUILDW[24] = {0.1, 0.15, 0.15, 0.2, 0.2, 0.25, 0.45, 0.4, 0.5, 0.55, 0.55, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0};
double T_GC_THI[24] = {15.5, 15.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 17.5, 17.5, 17.5, 17.5, 17.5, 18.5, 19.5, 21.5, 21.5, 22.5, 22.5, 22.5, 23.0, 23.5};
double T_GC_TLO[24] = {14.5, 14.5, 15.5, 15.5, 15.5, 15.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 17.5, 17.5, 18.5, 19.5, 21.0, 21.5, 21.5, 21.5, 22.5, 23.0, 23.5};
// === TRAINED PRESETS END ===

// Effective settings: trained presets for this symbol, or the inputs when presets are off
int    g_lookback, g_atrDays, g_minScore;
double g_outerPct, g_zonePct, g_wickPct, g_rsiOB, g_rsiOS, g_rr;
double g_extUp[72], g_extDn[72], g_buildW[24], g_tHi[24], g_tLo[24];

void LoadSettings()
  {
   if(g_isGold)
     {
      ArrayCopy(g_extUp, T_GC_EXTUP); ArrayCopy(g_extDn, T_GC_EXTDN);
      ArrayCopy(g_sMu, T_GC_SMU); ArrayCopy(g_sSd, T_GC_SSD); ArrayCopy(g_sCoef, T_GC_SCOEF);
      g_sThr = T_GC_STHR; g_sTp = T_GC_STP; g_sSl = T_GC_SSL; g_sWin = T_GC_SWIN; g_sEv = T_GC_SEV; g_sEdge = T_GC_SEDGE;
      ArrayCopy(g_buildW, T_GC_BUILDW); ArrayCopy(g_tHi, T_GC_THI); ArrayCopy(g_tLo, T_GC_TLO);
     }
   else
     {
      ArrayCopy(g_extUp, T_NQ_EXTUP); ArrayCopy(g_extDn, T_NQ_EXTDN);
      ArrayCopy(g_sMu, T_NQ_SMU); ArrayCopy(g_sSd, T_NQ_SSD); ArrayCopy(g_sCoef, T_NQ_SCOEF);
      g_sThr = T_NQ_STHR; g_sTp = T_NQ_STP; g_sSl = T_NQ_SSL; g_sWin = T_NQ_SWIN; g_sEv = T_NQ_SEV; g_sEdge = T_NQ_SEDGE;
      ArrayCopy(g_buildW, T_NQ_BUILDW); ArrayCopy(g_tHi, T_NQ_THI); ArrayCopy(g_tLo, T_NQ_TLO);
     }
   if(!InpUseTrained)
     {
      g_lookback = InpLookbackDays; g_atrDays = InpAtrDays; g_minScore = InpMinScore;
      g_outerPct = InpOuterPct; g_zonePct = InpZonePct;
      g_wickPct = InpWickPct; g_rsiOB = InpRsiOB; g_rsiOS = InpRsiOS; g_rr = InpRR;
      return;
     }
   if(g_isGold)
     {
      g_lookback = T_GC_LOOKBACK; g_atrDays = T_GC_ATR; g_minScore = T_GC_SCORE;
      g_outerPct = T_GC_OUTER; g_zonePct = T_GC_ZONE;
      g_wickPct = T_GC_WICK; g_rsiOB = T_GC_OB; g_rsiOS = T_GC_OS; g_rr = T_GC_RR;
     }
   else
     {
      g_lookback = T_NQ_LOOKBACK; g_atrDays = T_NQ_ATR; g_minScore = T_NQ_SCORE;
      g_outerPct = T_NQ_OUTER; g_zonePct = T_NQ_ZONE;
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

   EventSetTimer(2);          // first build when the market is closed, and live label/flow refresh
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
   else
      g_dirty = true;         // refresh the forming bar's lines on the next timer tick
  }

int g_timerTicks = 0;

void OnTimer()
  {
   g_timerTicks++;
   bool aiRefresh = InpShowAI && g_timerTicks % 15 == 0;     // pick up a new AI file every ~30 s
   if(!g_built || g_dirty || aiRefresh)
     {
      g_dirty = false;
      Rebuild();
     }
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

datetime DayEnd(int di)
  {
   if(di < g_days - 1)
      return g_dayTime[di + 1];
   return g_dayTime[di] + PeriodSeconds(PERIOD_D1);
  }

//+------------------------------------------------------------------+
//| Daily model (max envelope and signal zones)                      |
//+------------------------------------------------------------------+
bool BuildDaily()
  {
   int want = g_lookback + g_atrDays + MathMax(InpStatsDays, MathMax(InpScanDays, InpHistoryDays)) + 5;
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
   ArrayResize(g_atr, n); ArrayResize(g_upZn, n); ArrayResize(g_upOut, n);
   ArrayResize(g_dnZn, n); ArrayResize(g_dnOut, n); ArrayResize(g_valid, n);

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
      g_upZn[i]  = Percentile(bufU, c, g_zonePct);
      g_upOut[i] = Percentile(bufU, c, g_outerPct);
      g_dnZn[i]  = Percentile(bufD, c, g_zonePct);
      g_dnOut[i] = Percentile(bufD, c, g_outerPct);
      g_valid[i] = true;
     }

   // Max-line accuracy on completed days (exclude today, index n-1)
   g_nDays = g_nHi = g_nLo = 0;
   for(int i = n - 2; i >= 0 && i >= n - 1 - InpStatsDays; i--)
     {
      if(!g_valid[i])
         continue;
      g_nDays++;
      if(g_high[i] <= g_open[i] + g_upOut[i] * g_atr[i]) g_nHi++;
      if(g_low[i]  >= g_open[i] - g_dnOut[i] * g_atr[i]) g_nLo++;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Drawing helpers                                                  |
//+------------------------------------------------------------------+
void Seg(string name, datetime t1, double p1, datetime t2, double p2, color c, ENUM_LINE_STYLE st, int w)
  {
   ObjectCreate(0, name, OBJ_TREND, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_STYLE, st);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, w);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
  }

void Arrowed(string name, datetime t1, double p1, datetime t2, double p2, color c)
  {
   ObjectCreate(0, name, OBJ_ARROWED_LINE, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DOT);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
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
   ObjectSetString(0, name, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
  }

void Dot(string name, datetime t, double price, color c, bool above)
  {
   ObjectCreate(0, name, OBJ_ARROW, 0, t, price);
   ObjectSetInteger(0, name, OBJPROP_ARROWCODE, 159);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, above ? ANCHOR_BOTTOM : ANCHOR_TOP);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
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
   ObjectSetInteger(0, l, OBJPROP_XDISTANCE, 330);
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
   ObjectSetString(0, r, OBJPROP_TEXT, right == "" ? " " : right);   // an empty label shows "Label" in MT5
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

string Miss(double total, int n)
  {
   if(n <= 0)
      return "n/a";
   return "±" + DoubleToString(total / n, _Digits);
  }

void DrawMaxLevels()
  {
   if(!InpShowMax)
      return;
   int last = g_days - 1;
   for(int i = last; i >= 0 && i >= last - InpHistoryDays; i--)
     {
      if(!g_valid[i])
         continue;
      datetime t1 = g_dayTime[i];
      datetime t2 = DayEnd(i);
      string id = IntegerToString((long)t1);
      double hiZn  = g_open[i] + g_upZn[i]  * g_atr[i];
      double hiOut = g_open[i] + g_upOut[i] * g_atr[i];
      double loZn  = g_open[i] - g_dnZn[i]  * g_atr[i];
      double loOut = g_open[i] - g_dnOut[i] * g_atr[i];
      Zone(PFX + "zh" + id, t1, t2, hiZn, hiOut, InpColZoneHi);
      Zone(PFX + "zl" + id, t1, t2, loOut, loZn, InpColZoneLo);
      Seg(PFX + "op" + id, t1, g_open[i], t2, g_open[i], InpColOpen, STYLE_DOT, 1);
      Seg(PFX + "ho" + id, t1, hiOut, t2, hiOut, InpColHigh, STYLE_DASH, 1);
      Seg(PFX + "lo" + id, t1, loOut, t2, loOut, InpColLow, STYLE_DASH, 1);
      if(i == last)
        {
         Text(PFX + "tho", t2, hiOut, "Max HIGH P" + DoubleToString(g_outerPct, 1) + "  " + Px(hiOut), InpColHigh, ANCHOR_RIGHT_LOWER);
         Text(PFX + "tlo", t2, loOut, "Max LOW P" + DoubleToString(g_outerPct, 1) + "  " + Px(loOut), InpColLow, ANCHOR_RIGHT_UPPER);
        }
     }
  }

// Draw one live series as step segments, merging bars with the same value
void DrawSeries(string tag, datetime &t[], double &v[], int &day[], int from, int to, color c, int width)
  {
   int i = from;
   while(i <= to)
     {
      if(v[i] == EMPTY_VALUE)
        { i++; continue; }
      int j = i;
      while(j + 1 <= to && day[j + 1] == day[i] && v[j + 1] != EMPTY_VALUE && MathAbs(v[j + 1] - v[i]) < _Point * 0.5)
         j++;
      bool more = (j + 1 <= to && day[j + 1] == day[i] && v[j + 1] != EMPTY_VALUE);
      datetime t2 = more ? t[j + 1] : t[j] + PeriodSeconds(_Period);
      Seg(PFX + tag + IntegerToString((long)t[i]), t[i], v[i], t2, v[i], c, STYLE_SOLID, width);
      if(more)    // vertical step to the next value on the same day
         Seg(PFX + tag + "v" + IntegerToString((long)t[j + 1]), t2, v[i], t2, v[j + 1], c, STYLE_SOLID, width);
      i = j + 1;
     }
  }

//+------------------------------------------------------------------+
//| Scan chart bars: live lines, touches, signals, accuracy          |
//+------------------------------------------------------------------+
datetime ScanBars()
  {
   g_nSig = g_nWin = g_nLoss = 0;
   g_sumR = 0.0;
   g_missOH = g_missOL = g_missSH = g_missSL = g_missSB = 0;
   g_nOpenDays = g_nSessDays = 0;
   g_lastTouchText = "";
   g_scanReady = true;
   datetime lastSignalBar = 0;
   if(g_days < 2)
      return 0;

   int firstDay = MathMax(0, g_days - 1 - InpScanDays);
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
   int nr = CopyRates(_Symbol, _Period, 0, bars, r);        // includes the forming bar (last)
   int ni = CopyBuffer(g_rsiHandle, 0, 0, bars, rsi);
   if(nr <= 3 || ni != nr)
      return 0;

   datetime bt[];
   double liveHi[], liveLo[], build[];
   int dayOf[];
   ArrayResize(bt, nr); ArrayResize(liveHi, nr); ArrayResize(liveLo, nr); ArrayResize(build, nr); ArrayResize(dayOf, nr);

   int srvNy = ServerMinusNyHours();
   int curDay = -1;
   datetime dStart = 0;
   double hs = 0, ls = 0, pBase = 0, pStep = 0, poc = 0, lastPoc = 0;
   double prof[];
   ArrayResize(prof, 2 * PROF_HALF + 1);
   double sumV = 0, sumPV = 0, sumP2V = 0;
   bool soldToday = false, boughtToday = false, sessSeen = false, hiReached = false, loReached = false;
   double oHi = EMPTY_VALUE, oLo = 0, sHi = EMPTY_VALUE, sLo = 0, sBu = 0;
   int tDir = 0;
   double tSL = 0, tTP = 0;
   int liveFromDay = g_days - 1 - InpLiveDays;

   for(int i = 0; i < nr; i++)
     {
      bt[i] = r[i].time;
      liveHi[i] = EMPTY_VALUE; liveLo[i] = EMPTY_VALUE; build[i] = EMPTY_VALUE;
      int di = DayIndex(r[i].time);
      dayOf[i] = di;
      if(di < 0)
         continue;
      double atr = g_atr[di];
      bool newDay = (di != curDay);
      if(newDay)
        {
         // score the finished day against what was predicted
         if(curDay >= 0 && oHi != EMPTY_VALUE)
           { g_missOH += MathAbs(oHi - hs); g_missOL += MathAbs(oLo - ls); g_nOpenDays++; }
         if(curDay >= 0 && sHi != EMPTY_VALUE)
           { g_missSH += MathAbs(sHi - hs); g_missSL += MathAbs(sLo - ls); g_missSB += MathAbs(sBu - lastPoc); g_nSessDays++; }
         curDay = di;
         dStart = r[i].time;
         hs = r[i].high; ls = r[i].low;
         pStep = atr * PROF_STEP;
         pBase = r[i].open - PROF_HALF * pStep;
         ArrayInitialize(prof, 0.0);
         sumV = 0; sumPV = 0; sumP2V = 0;
         soldToday = false; boughtToday = false; sessSeen = false; hiReached = false; loReached = false;
         oHi = EMPTY_VALUE; sHi = EMPTY_VALUE;
        }
      double prevLiveHi = (i > 0 && !newDay) ? liveHi[i - 1] : EMPTY_VALUE;
      double prevLiveLo = (i > 0 && !newDay) ? liveLo[i - 1] : EMPTY_VALUE;
      double prevHs = hs, prevLs = ls;
      hs = MathMax(hs, r[i].high);
      ls = MathMin(ls, r[i].low);

      // time-at-price profile and build-up so far
      poc = (hs + ls) / 2.0;
      if(pStep > 0)
        {
         int b0 = MathMax(0, (int)MathFloor((r[i].low - pBase) / pStep));
         int b1 = MathMin(2 * PROF_HALF, (int)MathFloor((r[i].high - pBase) / pStep));
         for(int b = b0; b <= b1; b++)
            prof[b] += 1.0;
         int best = ArrayMaximum(prof);
         if(best >= 0 && prof[best] > 0)
            poc = pBase + (best + 0.5) * pStep;
        }
      lastPoc = poc;

      // live predicted high / low / build-up
      bool sess = InSession(r[i].time, srvNy);
      if(atr > 0)
        {
         int hr = (int)MathMin(23, MathMax(0, (r[i].time - dStart) / 3600));
         int pos = (hs > ls) ? (int)MathMin(2, MathMax(0, MathFloor((r[i].close - ls) / (hs - ls) * 3.0))) : 1;
         liveHi[i] = hs + g_extUp[hr * 3 + pos] * atr;
         liveLo[i] = ls - g_extDn[hr * 3 + pos] * atr;
         double w = g_buildW[hr];
         build[i] = (liveHi[i] + liveLo[i]) / 2.0 * (1.0 - w) + poc * w;
         if(oHi == EMPTY_VALUE)
           { oHi = liveHi[i]; oLo = liveLo[i]; }
         if(sess && !sessSeen)
           { sessSeen = true; sHi = liveHi[i]; sLo = liveLo[i]; sBu = build[i]; }

         // price reached the line predicted on the bar before (once per side per day)
         double tol = InpTouchTolAtr * atr;
         if(!hiReached && prevLiveHi != EMPTY_VALUE && prevLiveHi - prevHs > tol && r[i].high >= prevLiveHi - tol)
           {
            hiReached = true;
            if(InpShowTouch && di >= liveFromDay)
               Dot(PFX + "th" + IntegerToString((long)r[i].time), r[i].time, r[i].high, InpColHigh, true);
            if(i == nr - 2)
               g_lastTouchText = "reached predicted HIGH " + Px(prevLiveHi);
           }
         if(!loReached && prevLiveLo != EMPTY_VALUE && prevLs - prevLiveLo > tol && r[i].low <= prevLiveLo + tol)
           {
            loReached = true;
            if(InpShowTouch && di >= liveFromDay)
               Dot(PFX + "tl" + IntegerToString((long)r[i].time), r[i].time, r[i].low, InpColLow, false);
            if(i == nr - 2)
               g_lastTouchText = "reached predicted LOW " + Px(prevLiveLo);
           }
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

      // quick-trade model on the last closed bar (same features as ai/short_model.py)
      if(i == nr - 2 && i >= 49 && atr > 0 && liveHi[i] != EMPTY_VALUE)
         g_pLocal = QuickProb(r, rsi, i, vw, hs, ls, liveHi[i], liveLo[i], atr, srvNy);

      // signals use closed bars only
      if(i == nr - 1 || !InpShowSignals)
         continue;

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

      double hiZn = g_open[di] + g_upZn[di] * atr;
      double hiOut= g_open[di] + g_upOut[di] * atr;
      double loZn = g_open[di] - g_dnZn[di] * atr;
      double loOut= g_open[di] - g_dnOut[di] * atr;
      double rng  = r[i].high - r[i].low;
      if(rng <= 0)
         continue;
      double rMax = MathMax(rsi[i], MathMax(rsi[i - 1], rsi[i - 2]));
      double rMin = MathMin(rsi[i], MathMin(rsi[i - 1], rsi[i - 2]));

      // SELL: fade the predicted high zone
      bool s1 = r[i].high >= hiZn - InpZoneTolAtr * atr;
      bool s2 = r[i].close < r[i].open && (r[i].high - MathMax(r[i].open, r[i].close)) >= g_wickPct / 100.0 * rng && r[i].close < hiOut;
      bool s3 = rMax >= g_rsiOB && rsi[i] < rsi[i - 1];
      bool s4 = r[i].high >= extU;
      int  sScore = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0) + (s4 ? 1 : 0) + (sess ? 1 : 0);

      // BUY: fade the predicted low zone
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
      double y = dir < 0 ? r[i].high : r[i].low;
      color sc = dir < 0 ? InpColHigh : InpColLow;
      string arrow = PFX + "sa" + id;
      ObjectCreate(0, arrow, OBJ_ARROW, 0, r[i].time, y);
      ObjectSetInteger(0, arrow, OBJPROP_ARROWCODE, dir < 0 ? 234 : 233);
      ObjectSetInteger(0, arrow, OBJPROP_ANCHOR, dir < 0 ? ANCHOR_BOTTOM : ANCHOR_TOP);
      ObjectSetInteger(0, arrow, OBJPROP_COLOR, sc);
      ObjectSetInteger(0, arrow, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, arrow, OBJPROP_SELECTABLE, false);
      string txt = (dir < 0 ? "SELL " : "BUY ") + IntegerToString(score) + "/5  SL " + Px(tSL) + "  TP " + Px(tTP);
      Text(PFX + "st" + id, r[i].time, y, txt, sc, dir < 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      if(i == nr - 2)
         g_lastSignalText = txt;
     }

   // live lines for today (+ InpLiveDays before)
   int last = nr - 1;
   g_curHi = liveHi[last]; g_curLo = liveLo[last]; g_curBuild = build[last];
   if(InpShowLive)
     {
      int start = last;
      while(start > 0 && dayOf[start - 1] >= liveFromDay)
         start--;
      DrawSeries("lh", bt, liveHi, dayOf, start, last, InpColHigh, 2);
      DrawSeries("ll", bt, liveLo, dayOf, start, last, InpColLow, 2);
      DrawSeries("lb", bt, build, dayOf, start, last, InpColBuild, 2);
      DrawNow(r[last], dayOf[last], dStart, hs, ls, liveHi[last], liveLo[last], build[last]);
     }
   return lastSignalBar;
  }

// Probability that price is higher in 12 bars, from the trained logistic model (price only)
double QuickProb(MqlRates &r[], double &rsi[], int i, double vw, double hs, double ls, double lh, double ll, double datr, int srvNy)
  {
   double s = 0;
   for(int k = i - 13; k <= i; k++)
      s += MathMax(r[k].high, r[k - 1].close) - MathMin(r[k].low, r[k - 1].close);
   double a5 = s / 14.0;
   if(a5 <= 0)
      return -1;
   g_atr5 = a5;
   double c = r[i].close;
   MqlDateTime ny;
   TimeToStruct(r[i].time - srvNy * 3600, ny);
   double mins = ny.hour * 60 + ny.min;
   double x[12];
   x[0] = (c - r[i - 1].close) / a5;
   x[1] = (c - r[i - 3].close) / a5;
   x[2] = (c - r[i - 12].close) / a5;
   x[3] = (c - r[i - 48].close) / a5;
   x[4] = (rsi[i] - 50.0) / 50.0;
   x[5] = (c - vw) / a5;
   x[6] = (hs > ls) ? (c - ls) / (hs - ls) - 0.5 : 0.0;
   x[7] = (r[i].high - r[i].low) / a5 - 1.0;
   x[8] = MathSin(2.0 * M_PI * mins / 1440.0);
   x[9] = MathCos(2.0 * M_PI * mins / 1440.0);
   x[10] = (lh - c) / datr;
   x[11] = (c - ll) / datr;
   double z = g_sCoef[0];
   for(int k = 0; k < 12; k++)
      z += g_sCoef[k + 1] * (x[k] - g_sMu[k]) / g_sSd[k];
   return 1.0 / (1.0 + MathExp(-z));
  }

// Read the AI service file (MT5 Common\Files\DRP_AI_NQ.txt or _GC.txt) into key/value arrays
bool ReadAIFile(string &keys[], string &vals[])
  {
   string fn = g_isGold ? "DRP_AI_GC.txt" : "DRP_AI_NQ.txt";
   int h = FileOpen(fn, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ | FILE_SHARE_WRITE, 0, CP_UTF8);
   if(h == INVALID_HANDLE)
      return false;
   ArrayResize(keys, 0);
   ArrayResize(vals, 0);
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      int eq = StringFind(line, "=");
      if(eq <= 0)
         continue;
      int n = ArraySize(keys);
      ArrayResize(keys, n + 1);
      ArrayResize(vals, n + 1);
      keys[n] = StringSubstr(line, 0, eq);
      vals[n] = StringSubstr(line, eq + 1);
     }
   FileClose(h);
   return true;
  }

string KV(string &keys[], string &vals[], string key)
  {
   for(int i = 0; i < ArraySize(keys); i++)
      if(keys[i] == key)
         return vals[i];
   return "";
  }

// Green TP and red SL lines for the side the AI leans to, drawn ahead of the current bar
void DrawAI()
  {
   g_aiRow1 = ""; g_aiRow2 = ""; g_aiRow3 = "";
   if(!InpShowAI)
      return;
   string keys[], vals[];
   string dir = "", evt = "", head = "";
   double conf = 0, tpD = 0, slD = 0, newsS = 0;
   bool setup = false, live = false, llm = false;
   if(ReadAIFile(keys, vals))
     {
      long epoch = StringToInteger(KV(keys, vals, "epoch"));
      if(epoch > 0 && (long)TimeGMT() - epoch <= InpAIMaxAgeSec)
        {
         live = true;
         dir = KV(keys, vals, "dir");
         conf = StringToDouble(KV(keys, vals, "conf"));
         setup = StringToInteger(KV(keys, vals, "setup")) == 1;
         tpD = StringToDouble(KV(keys, vals, "tp_dist"));
         slD = StringToDouble(KV(keys, vals, "sl_dist"));
         newsS = StringToDouble(KV(keys, vals, "news"));
         llm = StringToInteger(KV(keys, vals, "llm")) == 1;
         evt = KV(keys, vals, "event");
         head = KV(keys, vals, "headline1");
        }
     }
   if(!live)
     {
      if(g_pLocal < 0 || g_atr5 <= 0)
         return;
      dir = g_pLocal >= 0.5 ? "LONG" : "SHORT";
      conf = MathMax(g_pLocal, 1.0 - g_pLocal);
      setup = conf >= g_sThr;
      tpD = g_sTp * g_atr5;
      slD = g_sSl * g_atr5;
     }
   int d = (dir == "LONG") ? 1 : -1;
   double entry = (d > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(entry <= 0)
      entry = iClose(_Symbol, _Period, 0);
   double tp = entry + d * tpD, sl = entry - d * slD;
   int ps = PeriodSeconds(_Period);
   datetime t1 = iTime(_Symbol, _Period, 0), t2 = t1 + InpAIBars * ps;
   ENUM_LINE_STYLE st = setup ? STYLE_SOLID : STYLE_DOT;
   Seg(PFX + "aiE", t1, entry, t2, entry, InpColOpen, STYLE_DOT, 1);
   Seg(PFX + "aiT", t1, tp, t2, tp, InpColHigh, st, setup ? 3 : 1);
   Seg(PFX + "aiS", t1, sl, t2, sl, InpColLow, st, setup ? 3 : 1);
   Text(PFX + "aiTt", t2, tp, " TP " + Px(tp) + " (" + (d > 0 ? "+" : "-") + DoubleToString(tpD, _Digits) + ")", InpColHigh, ANCHOR_LEFT);
   Text(PFX + "aiSt", t2, sl, " SL " + Px(sl) + " (" + (d > 0 ? "-" : "+") + DoubleToString(slD, _Digits) + ")", InpColLow, ANCHOR_LEFT);
   string what = "AI " + dir + " " + DoubleToString(conf * 100, 0) + "%" + (setup ? "" : " (low confidence)");
   Text(PFX + "aiH", t1, MathMax(tp, sl), what, setup ? (d > 0 ? InpColHigh : InpColLow) : InpColText, ANCHOR_LEFT_LOWER);

   g_aiCol = setup ? (d > 0 ? InpColHigh : InpColLow) : InpColText;
   g_aiRow1 = what + "  TP " + Px(tp) + "  SL " + Px(sl);
   string edge = (g_sEdge > 0) ? "tested edge" : "no proven edge";
   g_aiRow2 = (live ? (llm ? "price + news " + DoubleToString(newsS, 2) : "price only (Ollama off)") : "service offline: price only")
              + " · past win " + DoubleToString(g_sWin * 100, 0) + "% · " + edge;
   g_aiRow3 = evt != "" ? "Event risk: " + evt : StringSubstr(head, 0, 60);
  }

// Labels at the right of today's live lines and the flow lines from the current bar
void DrawNow(MqlRates &bar, int di, datetime dStart, double hs, double ls, double hi, double lo, double bu)
  {
   if(di < 0 || hi == EMPTY_VALUE)
      return;
   int ps = PeriodSeconds(_Period);
   datetime lblT = bar.time + 3 * ps;
   int hr = (int)MathMin(23, MathMax(0, (bar.time - dStart) / 3600));
   bool hiSet = (hi - hs) <= _Point;           // no extra move expected: the high is probably in
   bool loSet = (ls - lo) <= _Point;
   Text(PFX + "nh", lblT, hi, "▲ HIGH " + Px(hi) + (hiSet ? "  (likely set)" : ""), InpColHigh, ANCHOR_LEFT);
   Text(PFX + "nb", lblT, bu, "◆ BUILD-UP " + Px(bu), InpColBuild, ANCHOR_LEFT);
   Text(PFX + "nl", lblT, lo, "▼ LOW " + Px(lo) + (loSet ? "  (likely set)" : ""), InpColLow, ANCHOR_LEFT);
   if(!InpShowFlow)
      return;
   datetime endT = (datetime)MathMax((long)DayEnd(di), (long)bar.time + 4 * ps);
   long hiAt = (long)dStart + (long)(g_tHi[hr] * 3600.0);
   long loAt = (long)dStart + (long)(g_tLo[hr] * 3600.0);
   datetime tHi = (datetime)MathMin((long)endT - ps, MathMax((long)bar.time + 2 * ps, hiAt));
   datetime tLo = (datetime)MathMin((long)endT - ps, MathMax((long)bar.time + 2 * ps, loAt));
   if(!hiSet)
     {
      Arrowed(PFX + "fh", bar.time, bar.close, tHi, hi, InpColHigh);
      Seg(PFX + "fhb", tHi, hi, endT, bu, InpColBuild, STYLE_DOT, 1);
     }
   if(!loSet)
     {
      Arrowed(PFX + "fl", bar.time, bar.close, tLo, lo, InpColLow);
      Seg(PFX + "flb", tLo, lo, endT, bu, InpColBuild, STYLE_DOT, 1);
     }
  }

void DrawPanel()
  {
   string bg = PFX + "panel";
   ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, 340);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, 20);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, 330);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, InpShowAI ? 237 : 186);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, InpColPanel);
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR, C'54,58,69');
   ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);

   int i = g_days - 1;
   PanelRow(0, "Day Range Predictor", _Symbol, InpColText);
   if(!InpShowLive && g_lkName != "")
     {
      PanelRow(1, "▲ Locked HIGH (" + g_lkName + ")", Px(g_lkHi), InpColHigh);
      PanelRow(2, "Lines never move after they lock", "", InpColText);
      PanelRow(3, "▼ Locked LOW (" + g_lkName + ")", Px(g_lkLo), InpColLow);
     }
   else if(g_curHi != EMPTY_VALUE && g_curHi != 0)
     {
      PanelRow(1, "▲ Predicted HIGH", Px(g_curHi), InpColHigh);
      PanelRow(2, "◆ Build-up / support", Px(g_curBuild), InpColBuild);
      PanelRow(3, "▼ Predicted LOW", Px(g_curLo), InpColLow);
     }
   else
      PanelRow(1, "Loading history...", "", InpColText);
   if(i >= 0 && g_valid[i])
      PanelRow(4, "Max high / low (P" + DoubleToString(g_outerPct, 1) + ")",
               Px(g_open[i] + g_upOut[i] * g_atr[i]) + " / " + Px(g_open[i] - g_dnOut[i] * g_atr[i]), InpColText);
   PanelRow(5, "Avg miss at day open (" + IntegerToString(g_nOpenDays) + "d)",
            "H " + Miss(g_missOH, g_nOpenDays) + "  L " + Miss(g_missOL, g_nOpenDays), InpColText);
   PanelRow(6, "Avg miss at session start (" + IntegerToString(g_nSessDays) + "d)",
            "H " + Miss(g_missSH, g_nSessDays) + "  L " + Miss(g_missSL, g_nSessDays) + "  B " + Miss(g_missSB, g_nSessDays), InpColText);
   PanelRow(7, "Max lines held (" + IntegerToString(g_nDays) + "d)", "H " + Pct(g_nHi, g_nDays) + "  L " + Pct(g_nLo, g_nDays), InpColText);
   int closed = g_nWin + g_nLoss;
   PanelRow(8, "Signals last " + IntegerToString(InpScanDays) + "d (" + IntegerToString(g_nSig) + ")",
            "win " + Pct(g_nWin, closed) + "  " + (g_sumR >= 0 ? "+" : "") + DoubleToString(g_sumR, 1) + "R",
            g_sumR >= 0 ? InpColHigh : InpColLow);
   int row = 9;
   if(InpShowAI && g_aiRow1 != "")
     {
      PanelRow(9, g_aiRow1, "", g_aiCol);
      PanelRow(10, g_aiRow2, "", InpColText);
      PanelRow(11, g_aiRow3, "", C'160,164,176');
      row = 12;
     }
   PanelRow(row, "Not 100% - past results, not a promise", "", C'120,123,134');
  }

void SendAlert(string text)
  {
   string msg = "DayRangePredictor " + _Symbol + " " + EnumToString(_Period) + ": " + text;
   if(InpAlertPopup) Alert(msg);
   if(InpAlertPush)  SendNotification(msg);
   if(InpAlertSound) PlaySound("alert.wav");
  }


//+------------------------------------------------------------------+
//| Locked lines: set once when a session starts, never moved         |
//|  Full day     locked at the day open (6 PM NY), 10-year model    |
//|  Regular      locked at 9:30 NY until 4 PM, 10-year ^NDX model   |
//|  After-market locked at 4 PM NY until 9 AM, median of 250 nights |
//+------------------------------------------------------------------+
double g_lkHi = 0, g_lkLo = 0;
string g_lkName = "";

// Features of ai/fixed_model.py for bar i of a daily-like series (oldest first). false if not enough history.
bool LockFeatures(double &o[], double &h[], double &l[], double &c[], int &dow[], int i, double &x[], double &atr)
  {
   if(i < 61)
      return false;
   double tr[];
   ArrayResize(tr, i + 1);
   for(int k = 1; k <= i; k++)
      tr[k] = MathMax(h[k], c[k - 1]) - MathMin(l[k], c[k - 1]);
   double s20 = 0, s5 = 0, s60 = 0;
   for(int k = i - 20; k < i; k++) s20 += tr[k];
   for(int k = i - 5; k < i; k++)  s5 += tr[k];
   for(int k = i - 60; k < i; k++) s60 += tr[k];
   atr = s20 / 20.0;
   if(atr <= 0)
      return false;
   // up/down moves of the previous days, each with that day's own ATR
   double up[6], dn[6];
   for(int j = 1; j <= 5; j++)
     {
      double a = 0;
      for(int k = i - j - 20; k < i - j; k++) a += tr[k];
      a /= 20.0;
      up[j] = (h[i - j] - o[i - j]) / a;
      dn[j] = (o[i - j] - l[i - j]) / a;
     }
   double rng = h[i - 1] - l[i - 1];
   ArrayResize(x, 14);
   x[0] = 1;
   x[1] = tr[i - 1] / atr;
   x[2] = (o[i] - c[i - 1]) / atr;
   x[3] = MathAbs(o[i] - c[i - 1]) / atr;
   x[4] = s5 / 5.0 / atr;
   x[5] = s60 / 60.0 / atr;
   x[6] = up[1];
   x[7] = dn[1];
   x[8] = (up[1] + up[2] + up[3] + up[4] + up[5]) / 5.0;
   x[9] = (dn[1] + dn[2] + dn[3] + dn[4] + dn[5]) / 5.0;
   x[10] = rng > 0 ? (c[i - 1] - l[i - 1]) / rng : 0.5;
   x[11] = (o[i] - c[i - 20]) / atr;
   x[12] = dow[i] == 1 ? 1.0 : 0.0;     // Monday
   x[13] = dow[i] == 5 ? 1.0 : 0.0;     // Friday
   return true;
  }

double LockDot(double &coef[], double &x[])
  {
   double z = 0;
   for(int k = 0; k < 14; k++)
      z += coef[k] * x[k];
   return MathMax(0.0, z);
  }

// Current session: horizontal lines across the whole chart. Older sessions: short segments.
void HLineFull(string name, double price, color c, string text)
  {
   ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_SOLID);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, text);
  }

void LockDraw(string id, datetime t1, datetime t2, double hi, double lo, string name, bool current)
  {
   if(current)
     {
      // fixed names: the most recent session drawn wins (e.g. the 4 PM lines replace the 9:30 lines)
      HLineFull(PFX + "KH", hi, InpColHigh, name + " locked HIGH " + Px(hi));
      HLineFull(PFX + "KL", lo, InpColLow, name + " locked LOW " + Px(lo));
      datetime tx = iTime(_Symbol, _Period, 0) + 2 * PeriodSeconds(_Period);
      Text(PFX + "KHT", tx, hi, "▲ " + name + " HIGH " + Px(hi), InpColHigh, ANCHOR_LEFT_LOWER);
      Text(PFX + "KLT", tx, lo, "▼ " + name + " LOW " + Px(lo), InpColLow, ANCHOR_LEFT_UPPER);
     }
   else
     {
      Seg(PFX + "kh" + id, t1, hi, t2, hi, InpColHigh, STYLE_SOLID, 1);
      Seg(PFX + "kl" + id, t1, lo, t2, lo, InpColLow, STYLE_SOLID, 1);
     }
   if(current)
     { g_lkHi = hi; g_lkLo = lo; g_lkName = name; }
  }

void DrawLocked()
  {
   bool wantDay = InpLockMode == DRP_LOCK_DAY || InpLockMode == DRP_LOCK_ALL || (InpLockMode == DRP_LOCK_AUTO && g_isGold);
   bool wantSes = !g_isGold && (InpLockMode != DRP_LOCK_DAY);
   int srvNy = ServerMinusNyHours();
   g_lkName = "";

   // ---- full day, from D1 bars (the broker's own day open)
   if(wantDay)
     {
      MqlRates d[];
      ArraySetAsSeries(d, false);
      int n = CopyRates(_Symbol, PERIOD_D1, 0, 120, d);
      if(n > 62)
        {
         double o[], h[], l[], c[], x[], cu[], cd[];
         datetime t[];
         int dw[];
         ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(t, n); ArrayResize(dw, n);
         for(int k = 0; k < n; k++)
           {
            o[k] = d[k].open; h[k] = d[k].high; l[k] = d[k].low; c[k] = d[k].close; t[k] = d[k].time;
            MqlDateTime sd;
            TimeToStruct(d[k].time, sd);          // a D1 bar's server date is the CME trade date
            dw[k] = sd.day_of_week;
           }
         if(g_isGold) { ArrayCopy(cu, T_GC_DAYUP); ArrayCopy(cd, T_GC_DAYDN); }
         else         { ArrayCopy(cu, T_NQ_DAYUP); ArrayCopy(cd, T_NQ_DAYDN); }
         for(int i = MathMax(61, n - 1 - InpLockHist); i < n; i++)
           {
            double atr;
            if(!LockFeatures(o, h, l, c, dw, i, x, atr))
               continue;
            double u = LockDot(cu, x), v = LockDot(cd, x);
            datetime t2 = (i < n - 1) ? t[i + 1] : t[i] + PeriodSeconds(PERIOD_D1);
            LockDraw("d" + IntegerToString((long)t[i]), t[i], t2, o[i] + u * atr, o[i] - v * atr, "DAY", i == n - 1);
           }
        }
     }
   if(!wantSes)
      return;

   // ---- regular session (9:30-16:00 NY) and after-market (16:00-9:00), from M30 bars
   MqlRates b[];
   ArraySetAsSeries(b, false);
   int nb = CopyRates(_Symbol, PERIOD_M30, 0, 48 * 110, b);
   if(nb < 48 * 70)
      return;
   double ro[], rh[], rl[], rc[];
   datetime rt[], rEnd[];
   int rdw[];
   int nr = 0, cur = -1;
   for(int k = 0; k < nb; k++)
     {
      MqlDateTime ny;
      TimeToStruct(b[k].time - srvNy * 3600, ny);
      int hm = ny.hour * 60 + ny.min;
      if(ny.day_of_week == 0 || ny.day_of_week == 6 || hm < 570 || hm >= 960)
         continue;
      int key = ny.year * 10000 + ny.mon * 100 + ny.day;
      if(key != cur)
        {
         cur = key;
         nr++;
         ArrayResize(ro, nr); ArrayResize(rh, nr); ArrayResize(rl, nr); ArrayResize(rc, nr); ArrayResize(rt, nr); ArrayResize(rEnd, nr);
         ArrayResize(rdw, nr);
         rdw[nr - 1] = ny.day_of_week;
         ro[nr - 1] = b[k].open; rh[nr - 1] = b[k].high; rl[nr - 1] = b[k].low; rt[nr - 1] = b[k].time;
        }
      rh[nr - 1] = MathMax(rh[nr - 1], b[k].high);
      rl[nr - 1] = MathMin(rl[nr - 1], b[k].low);
      rc[nr - 1] = b[k].close;
      rEnd[nr - 1] = b[k].time + 1800;
     }
   double x[];
   for(int i = MathMax(61, nr - 1 - InpLockHist); i < nr; i++)
     {
      double atr;
      if(!LockFeatures(ro, rh, rl, rc, rdw, i, x, atr))
         continue;
      double u = LockDot(T_NQ_RTHUP, x), v = LockDot(T_NQ_RTHDN, x);
      datetime t2 = rt[i] + 390 * 60;                               // 9:30 + 6.5 h = 16:00
      LockDraw("r" + IntegerToString((long)rt[i]), rt[i], t2, ro[i] + u * atr, ro[i] - v * atr, "9:30", i == nr - 1);
      // after-market: from the 16:00 bar, until 9:00 the next weekday
      int k16 = iBarShift(_Symbol, PERIOD_M30, t2, true);
      if(k16 < 0)
         continue;
      double o16 = iOpen(_Symbol, PERIOD_M30, k16);
      int di = DayIndex(t2);
      double datr = (di >= 0) ? g_atr[di] : atr;
      MqlDateTime ny16;
      TimeToStruct(t2 - srvNy * 3600, ny16);
      datetime tEnd = t2 + (ny16.day_of_week == 5 ? 65 : 17) * 3600;
      LockDraw("a" + IntegerToString((long)t2), t2, tEnd, o16 + T_NQ_AHUP * datr, o16 - T_NQ_AHDN * datr, "4 PM", i == nr - 1);
     }
  }


//+------------------------------------------------------------------+
//| 80% band + projected candles for the next 12 five-minute bars    |
//| Band = 10th..90th percentile of past moves in 5-minute ATRs      |
//| (tested: price 1 hour later landed inside it ~80% of the time).  |
//| Candles = typical body/wick size for that hour, on the median    |
//| path. Colour = price-model lean only (~52%), not a call.         |
//+------------------------------------------------------------------+
void DrawBand()
  {
   if(!InpShowBand && !InpShowGhost)
      return;
   MqlRates m[];
   ArraySetAsSeries(m, false);
   if(CopyRates(_Symbol, PERIOD_M5, 0, 16, m) < 16)
      return;
   double s = 0;
   for(int k = 1; k < 15; k++)
      s += MathMax(m[k].high, m[k - 1].close) - MathMin(m[k].low, m[k - 1].close);
   double atr = s / 14.0;
   if(atr <= 0)
      return;
   int srvNy = ServerMinusNyHours();
   datetime now = m[15].time;
   double c = m[15].close;
   MqlDateTime ny;
   TimeToStruct(now - srvNy * 3600, ny);
   int hm = ny.hour * 60 + ny.min;
   bool rth = hm >= 570 && hm < 960;
   double band[], shape[];
   if(g_isGold) { if(rth) ArrayCopy(band, T_GC_BANDRTH); else ArrayCopy(band, T_GC_BANDOFF); ArrayCopy(shape, T_GC_SHAPE); }
   else         { if(rth) ArrayCopy(band, T_NQ_BANDRTH); else ArrayCopy(band, T_NQ_BANDOFF); ArrayCopy(shape, T_NQ_SHAPE); }
   color lean = (g_pLocal < 0) ? clrSilver : (g_pLocal >= 0.5 ? InpColHigh : InpColLow);
   double prevLo = c, prevHi = c;
   for(int h = 1; h <= 12; h++)
     {
      datetime t0 = now + (h - 1) * 300, t1 = now + h * 300;
      double lo = c + band[(h - 1) * 3] * atr, mid = c + band[(h - 1) * 3 + 1] * atr, hi = c + band[(h - 1) * 3 + 2] * atr;
      if(InpShowBand)
        {
         Seg(PFX + "bh" + IntegerToString(h), t0, prevHi, t1, hi, InpColBand, STYLE_SOLID, 1);
         Seg(PFX + "bl" + IntegerToString(h), t0, prevLo, t1, lo, InpColBand, STYLE_SOLID, 1);
        }
      prevLo = lo; prevHi = hi;
      if(InpShowGhost)
        {
         MqlDateTime gt;
         TimeToStruct(t1 - srvNy * 3600, gt);
         double body = shape[gt.hour * 3] * atr, top = shape[gt.hour * 3 + 1] * atr, bot = shape[gt.hour * 3 + 2] * atr;
         string id = IntegerToString(h);
         ObjectCreate(0, PFX + "gb" + id, OBJ_RECTANGLE, 0, t1 - 100, mid + body / 2, t1 + 100, mid - body / 2);
         ObjectSetInteger(0, PFX + "gb" + id, OBJPROP_COLOR, lean);
         ObjectSetInteger(0, PFX + "gb" + id, OBJPROP_STYLE, STYLE_DOT);
         ObjectSetInteger(0, PFX + "gb" + id, OBJPROP_FILL, false);
         ObjectSetInteger(0, PFX + "gb" + id, OBJPROP_SELECTABLE, false);
         Seg(PFX + "gw" + id, t1, mid + body / 2 + top, t1, mid - body / 2 - bot, C'159,168,218', STYLE_DOT, 1);
        }
     }
   if(InpShowBand)
     {
      Text(PFX + "bth", now + 12 * 300, prevHi, " 80% band " + Px(prevHi), InpColBand, ANCHOR_LEFT_LOWER);
      Text(PFX + "btl", now + 12 * 300, prevLo, " " + Px(prevLo), InpColBand, ANCHOR_LEFT_UPPER);
     }
  }

//+------------------------------------------------------------------+
void Rebuild()
  {
   if(!BuildDaily())
      return;
   ObjectsDeleteAll(0, PFX);
   g_lastSignalText = "";
   g_curHi = 0; g_curLo = 0; g_curBuild = 0;
   DrawMaxLevels();
   DrawLocked();
   g_pLocal = -1;
   datetime lastSig = ScanBars();
   DrawAI();
   DrawBand();
   if(InpShowPanel)
      DrawPanel();
   ChartRedraw();
   datetime newBar = iTime(_Symbol, _Period, 0);
   bool barClosed = (newBar != g_lastBar);
   g_lastBar = newBar;

   // Alerts only for the bar that just closed, once
   datetime justClosed = iTime(_Symbol, _Period, 1);
   if(g_built && lastSig != 0 && lastSig == justClosed && lastSig != g_lastAlertBar)
     {
      g_lastAlertBar = lastSig;
      SendAlert(g_lastSignalText);
     }
   if(g_built && barClosed && InpAlertTouch && g_lastTouchText != "" && justClosed != g_lastTouchAlert)
     {
      g_lastTouchAlert = justClosed;
      SendAlert(g_lastTouchText);
     }
   if(!g_built)
     {
      g_lastAlertBar = lastSig;     // don't alert old signals on first load
      g_lastTouchAlert = justClosed;
     }
   g_built = g_scanReady;
  }
//+------------------------------------------------------------------+
