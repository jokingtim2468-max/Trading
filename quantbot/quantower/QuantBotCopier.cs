// QuantBot Copier for Quantower: places the trades QuantBot copies to this account.
// It asks QuantBot every second for orders (the same plain-text protocol as the MT5 Copier EA) and reports each fill.
//   poll -> one order per line: id|action|symbol|side|qty|sl|tp|tag|ticket   (action open / modify / close / close_part)
//   ack  <- one line per order:  id|ok|ticket|price|message
// Build: Quantower > Algo (Visual Studio extension) > new Strategy project, replace the code with this file, build, then
// run it from Quantower's Strategies Manager on the account, with the Copier address from QuantBot.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using TradingPlatform.BusinessLayer;

namespace QuantBotCopier
{
    public class QuantBotCopier : Strategy
    {
        [InputParameter("Copier address (from QuantBot)", 0)]
        public string Url = "http://127.0.0.1:5174/mt5/PASTE_KEY/PASTE_ACCOUNT";

        [InputParameter("Account", 1)]
        public Account Account;

        [InputParameter("Symbol map (QuantBot=Quantower, comma separated)", 2)]
        public string SymbolMap = "MGC1!=MGC, MNQ1!=MNQ";

        [InputParameter("Poll every (ms)", 3, 250, 10000)]
        public int PollMs = 1000;

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        private Timer timer;
        private int busy;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public QuantBotCopier() : base()
        {
            Name = "QuantBot Copier";
            Description = "Places the trades QuantBot copies to this account";
        }

        protected override void OnRun()
        {
            if (Account == null) { Log("Pick the account first", StrategyLoggingLevel.Error); Stop(); return; }
            timer = new Timer(_ => Tick(), null, 0, Math.Max(250, PollMs));
            Log($"Polling {Url} for {Account.Name}", StrategyLoggingLevel.Info);
        }

        protected override void OnStop() { timer?.Dispose(); timer = null; }

        private void Tick()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;   // never overlap two polls
            try
            {
                string text = Http.GetStringAsync(Url.TrimEnd('/') + "/poll").Result;
                var acks = new List<string>();
                foreach (var raw in text.Split('\n'))
                {
                    var line = raw.Trim();
                    if (line.Length == 0) continue;
                    acks.Add(Handle(line.Split('|')));
                }
                if (acks.Count > 0)
                    Http.PostAsync(Url.TrimEnd('/') + "/ack", new StringContent(string.Join("\n", acks), Encoding.UTF8, "text/plain")).Wait();
            }
            catch (Exception e) { Log("QuantBot not reachable: " + e.GetBaseException().Message, StrategyLoggingLevel.Error); }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        private string MapSymbol(string name)
        {
            foreach (var pair in SymbolMap.Split(','))
            {
                var kv = pair.Split('=');
                if (kv.Length == 2 && kv[0].Trim().Equals(name, StringComparison.OrdinalIgnoreCase)) return kv[1].Trim();
            }
            return name;
        }

        private Symbol FindSymbol(string name)
        {
            var want = MapSymbol(name);
            return Core.Instance.Symbols.FirstOrDefault(s => s.Connection == Account.Connection && (s.Name.Equals(want, StringComparison.OrdinalIgnoreCase) || s.Name.StartsWith(want, StringComparison.OrdinalIgnoreCase)));
        }

        private Position FindPosition(string ticket, string tag, Symbol symbol)
        {
            return Core.Instance.Positions.FirstOrDefault(p => p.Account == Account && (p.Id == ticket || (symbol != null && p.Symbol == symbol)));
        }

        // f: id|action|symbol|side|qty|sl|tp|tag|ticket
        private string Handle(string[] f)
        {
            if (f.Length < 9) return $"{f[0]}|0|||bad order line";
            string id = f[0], action = f[1], sym = f[2], side = f[3], tag = f[7], ticket = f[8];
            double qty = double.Parse(f[4], Inv), sl = double.Parse(f[5], Inv), tp = double.Parse(f[6], Inv);
            var symbol = FindSymbol(sym);
            if (symbol == null) return $"{id}|0|||no symbol {MapSymbol(sym)} on this connection (fix the symbol map)";
            try
            {
                if (action == "open")
                {
                    var p = new PlaceOrderRequestParameters
                    {
                        Account = Account, Symbol = symbol, Side = side == "long" ? Side.Buy : Side.Sell,
                        Quantity = Math.Max(1, Math.Floor(qty)), OrderTypeId = OrderType.Market, Comment = tag,
                    };
                    if (sl > 0) p.StopLoss = SlTpHolder.CreateSL(sl, PriceMeasurement.Absolute);
                    if (tp > 0) p.TakeProfit = SlTpHolder.CreateTP(tp, PriceMeasurement.Absolute);
                    var r = Core.Instance.PlaceOrder(p);
                    if (r.Status != TradingOperationResultStatus.Success) return $"{id}|0|||{r.Message}";
                    Thread.Sleep(300);
                    var pos = FindPosition(null, tag, symbol);
                    return $"{id}|1|{pos?.Id ?? r.OrderId}|{(pos?.OpenPrice ?? 0).ToString(Inv)}|";
                }
                var position = FindPosition(ticket, tag, symbol);
                if (position == null) return $"{id}|0|||no open position for {symbol.Name}";
                if (action == "close")
                {
                    var r = position.Close();
                    return r.Status == TradingOperationResultStatus.Success ? $"{id}|1|{position.Id}|{symbol.Last.ToString(Inv)}|" : $"{id}|0|||{r.Message}";
                }
                if (action == "close_part")
                {
                    var r = position.Close(Math.Max(1, Math.Floor(qty)));
                    return r.Status == TradingOperationResultStatus.Success ? $"{id}|1|{position.Id}|{symbol.Last.ToString(Inv)}|" : $"{id}|0|||{r.Message}";
                }
                if (action == "modify")
                {
                    // Move the protective stop / target orders that belong to this position
                    foreach (var o in Core.Instance.Orders.Where(o => o.Account == Account && o.Symbol == symbol && o.PositionId == position.Id))
                    {
                        if (sl > 0 && o.OrderTypeId == OrderType.Stop) Core.Instance.ModifyOrder(o, triggerPrice: sl);
                        if (tp > 0 && o.OrderTypeId == OrderType.Limit) Core.Instance.ModifyOrder(o, price: tp);
                    }
                    return $"{id}|1|{position.Id}|0|";
                }
                return $"{id}|0|||unknown action {action}";
            }
            catch (Exception e) { return $"{id}|0|||{e.GetBaseException().Message.Replace('|', '/').Replace('\n', ' ')}"; }
        }
    }
}
