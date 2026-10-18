//+------------------------------------------------------------------+
//| QuantBot Copier: places QuantBot's copied trades on this account  |
//| Attach to any one chart of the account's MT5 terminal.            |
//| 1. In QuantBot: the account > MT5 > copy "Copier address".        |
//| 2. MT5: Tools > Options > Expert Advisors > Allow WebRequest for   |
//|    listed URL: add the http://127.0.0.1:<port> part of it.        |
//| 3. Paste the address in QuantBotUrl and allow Algo Trading.       |
//+------------------------------------------------------------------+
#property copyright "QuantBot"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input string QuantBotUrl = "http://127.0.0.1:5174/mt5/PASTE_KEY/PASTE_ACCOUNT"; // Copier address from QuantBot
input int    PollMs      = 1000;     // How often to ask QuantBot for orders (ms)
input ulong  Magic       = 26032026; // Magic number of QuantBot's trades
input int    SlippagePts = 50;       // Max slippage in points

CTrade trade;
datetime lastWarn = 0;

int OnInit()
{
   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(SlippagePts);
   trade.SetTypeFillingBySymbol(Symbol());
   if(StringFind(QuantBotUrl, "PASTE_") >= 0)
   {
      Alert("QuantBot Copier: paste the Copier address from QuantBot into QuantBotUrl.");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetMillisecondTimer(MathMax(250, PollMs));
   Print("QuantBot Copier started for ", AccountInfoString(ACCOUNT_NAME), " #", AccountInfoInteger(ACCOUNT_LOGIN));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() { Poll(); }

// One HTTP call to QuantBot; "" on failure (printed at most once a minute)
string Http(const string method, const string path, const string body)
{
   char data[];
   char result[];
   string headers;
   if(StringLen(body) > 0) StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   ResetLastError();
   int code = WebRequest(method, QuantBotUrl + path, "Content-Type: text/plain\r\n", 5000, data, result, headers);
   if(code != 200)
   {
      if(TimeCurrent() - lastWarn > 60)
      {
         lastWarn = TimeCurrent();
         if(code == -1) PrintFormat("QuantBot Copier: can't reach QuantBot (error %d). Add the address's http://127.0.0.1:<port> part under Tools > Options > Expert Advisors > Allow WebRequest, and keep QuantBot open.", GetLastError());
         else PrintFormat("QuantBot Copier: QuantBot answered %d. Check the Copier address.", code);
      }
      return "";
   }
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
}

// Volume rounded to the symbol's lot step and limits
double Lots(const string sym, double lots)
{
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step > 0) lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin) return 0;
   return MathMin(lots, vmax);
}

double Price(const string sym, double p)
{
   if(p <= 0) return 0;
   return NormalizeDouble(p, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
}

// The open position of a QuantBot trade: by ticket, else by its comment tag
ulong FindPosition(const string tag, const ulong ticket)
{
   if(ticket > 0 && PositionSelectByTicket(ticket)) return ticket;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == (long)Magic && PositionGetString(POSITION_COMMENT) == tag) return t;
   }
   return 0;
}

string Ack(const string id, const bool ok, const ulong ticket, const double price, const string msg)
{
   string clean = msg;
   StringReplace(clean, "|", "/");
   StringReplace(clean, "\n", " ");
   return id + "|" + (ok ? "1" : "0") + "|" + (string)ticket + "|" + DoubleToString(price, 5) + "|" + clean + "\n";
}

void Poll()
{
   string text = Http("GET", "/poll", "");
   if(StringLen(text) == 0) return;
   string lines[];
   int n = StringSplit(text, '\n', lines);
   string acks = "";
   for(int i = 0; i < n; i++)
   {
      string f[];
      if(StringSplit(lines[i], '|', f) < 9) continue;
      string id = f[0], action = f[1], sym = f[2], side = f[3], tag = f[7];
      double lots = StringToDouble(f[4]), sl = StringToDouble(f[5]), tp = StringToDouble(f[6]);
      ulong ticket = (ulong)StringToInteger(f[8]);
      acks += Execute(id, action, sym, side, lots, sl, tp, tag, ticket);
   }
   if(StringLen(acks) > 0) Http("POST", "/ack", acks);
}

string Execute(const string id, const string action, const string sym, const string side, double lots, double sl, double tp, const string tag, const ulong ticket)
{
   if(!SymbolSelect(sym, true)) return Ack(id, false, 0, 0, "symbol " + sym + " not found on this account (set the symbol map in QuantBot)");
   ulong pos = FindPosition(tag, ticket);
   if(action == "open")
   {
      if(pos > 0) return Ack(id, true, pos, PositionGetDouble(POSITION_PRICE_OPEN), "already open");
      double v = Lots(sym, lots);
      if(v <= 0) return Ack(id, false, 0, 0, "volume " + DoubleToString(lots, 2) + " is under the minimum lot");
      bool ok = side == "long" ? trade.Buy(v, sym, 0, Price(sym, sl), Price(sym, tp), tag) : trade.Sell(v, sym, 0, Price(sym, sl), Price(sym, tp), tag);
      uint rc = trade.ResultRetcode();
      if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_PLACED && rc != TRADE_RETCODE_DONE_PARTIAL))
         return Ack(id, false, 0, 0, "order rejected: " + trade.ResultRetcodeDescription());
      ulong opened = FindPosition(tag, 0);
      return Ack(id, true, opened > 0 ? opened : trade.ResultOrder(), trade.ResultPrice(), "");
   }
   if(pos == 0) return Ack(id, true, 0, 0, "no open position (already closed)");
   if(action == "modify")
   {
      double cur_sl = PositionGetDouble(POSITION_SL), cur_tp = PositionGetDouble(POSITION_TP);
      if(!trade.PositionModify(pos, sl > 0 ? Price(sym, sl) : cur_sl, tp > 0 ? Price(sym, tp) : cur_tp))
         return Ack(id, false, pos, 0, "modify rejected: " + trade.ResultRetcodeDescription());
      return Ack(id, true, pos, 0, "");
   }
   if(action == "close")
   {
      if(!trade.PositionClose(pos)) return Ack(id, false, pos, 0, "close rejected: " + trade.ResultRetcodeDescription());
      return Ack(id, true, pos, trade.ResultPrice(), "");
   }
   if(action == "close_part")
   {
      double v = Lots(sym, lots);
      if(v <= 0 || v >= PositionGetDouble(POSITION_VOLUME)) { if(!trade.PositionClose(pos)) return Ack(id, false, pos, 0, "close rejected: " + trade.ResultRetcodeDescription()); }
      else if(!trade.PositionClosePartial(pos, v)) return Ack(id, false, pos, 0, "partial close rejected: " + trade.ResultRetcodeDescription());
      return Ack(id, true, pos, trade.ResultPrice(), "");
   }
   return Ack(id, false, 0, 0, "unknown action " + action);
}
