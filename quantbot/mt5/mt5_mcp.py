"""QuantBot's built-in MT5 MCP server: gives the local model the MetaTrader 5 terminal as tools (MCP over stdio).

Reads work on any account: account, positions, pending orders, symbol prices, bars, trade history.
Trading tools (place / modify / close / cancel) work ONLY when the logged-in account is a DEMO account
(MT5 reports trade_mode DEMO); on a real or contest account they refuse. MT5_ALLOW_LIVE=1 does not exist on
purpose: live trading by the model is not offered.

Needs Windows, a running MT5 terminal (logged in, Algo Trading on for orders) and: pip install MetaTrader5
Optional env MT5_TERMINAL: path to terminal64.exe when several terminals are installed.
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

try:
    import MetaTrader5 as mt5
except Exception as e:  # not installed / not Windows: every tool says why
    mt5 = None
    IMPORT_ERROR = str(e)

PROTOCOL = "2025-06-18"
MAX_BARS = 500
DEMO = 0  # mt5.ACCOUNT_TRADE_MODE_DEMO

TF = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 16385, "H4": 16388, "D1": 16408, "W1": 32769}


def _connect():
    if mt5 is None:
        raise RuntimeError(f"The MetaTrader5 Python package is missing ({IMPORT_ERROR}). Run: pip install MetaTrader5 (Windows only).")
    path = os.environ.get("MT5_TERMINAL")
    ok = mt5.initialize(path) if path else mt5.initialize()
    if not ok:
        raise RuntimeError(f"Can't reach the MT5 terminal: {mt5.last_error()}. Open MT5 and log in.")


def _d(x):
    return x._asdict() if hasattr(x, "_asdict") else dict(vars(x)) if hasattr(x, "__dict__") else x


def _demo_only():
    a = mt5.account_info()
    if a is None:
        raise RuntimeError("No account is logged in to MT5.")
    if getattr(a, "trade_mode", None) != DEMO:
        raise RuntimeError(f"Account {a.login} is not a demo account: trading tools only work on demo accounts.")
    return a


def _result(r):
    if r is None:
        return {"ok": False, "error": str(mt5.last_error())}
    d = _d(r)
    d.pop("request", None)
    ok = d.get("retcode") in (10008, 10009, 10010)  # placed / done / done partially
    return {"ok": ok, **{k: d[k] for k in ("retcode", "comment", "order", "deal", "price", "volume") if k in d}}


# ---------- tools ----------
def account_info(_):
    a = _d(mt5.account_info())
    keep = ("login", "server", "company", "currency", "balance", "equity", "margin", "margin_free", "profit", "leverage", "trade_mode", "trade_allowed")
    out = {k: a.get(k) for k in keep}
    out["is_demo"] = a.get("trade_mode") == DEMO
    out["trading_tools"] = "enabled (demo account)" if out["is_demo"] else "disabled: not a demo account"
    return out


def positions(args):
    rows = mt5.positions_get(symbol=args["symbol"]) if args.get("symbol") else mt5.positions_get()
    keep = ("ticket", "symbol", "type", "volume", "price_open", "sl", "tp", "price_current", "profit", "swap", "comment", "time")
    return [{**{k: _d(p).get(k) for k in keep}, "side": "buy" if _d(p).get("type") == 0 else "sell"} for p in (rows or [])]


def pending_orders(args):
    rows = mt5.orders_get(symbol=args["symbol"]) if args.get("symbol") else mt5.orders_get()
    keep = ("ticket", "symbol", "type", "volume_current", "price_open", "sl", "tp", "comment", "time_setup")
    return [{k: _d(o).get(k) for k in keep} for o in (rows or [])]


def symbol_info(args):
    s = args["symbol"]
    mt5.symbol_select(s, True)
    i, t = mt5.symbol_info(s), mt5.symbol_info_tick(s)
    if i is None:
        raise RuntimeError(f"No symbol {s} in this terminal (check Market Watch for the exact name, e.g. XAUUSD or GOLD).")
    i = _d(i)
    keep = ("name", "description", "digits", "point", "spread", "trade_contract_size", "trade_tick_value", "trade_tick_size", "volume_min", "volume_max", "volume_step", "currency_profit")
    return {**{k: i.get(k) for k in keep}, "bid": getattr(t, "bid", None), "ask": getattr(t, "ask", None), "time": getattr(t, "time", None)}


def bars(args):
    tf = TF.get(str(args.get("timeframe", "H1")).upper())
    if tf is None:
        raise RuntimeError(f"timeframe must be one of {', '.join(TF)}")
    n = max(1, min(int(args.get("count", 100)), MAX_BARS))
    mt5.symbol_select(args["symbol"], True)
    r = mt5.copy_rates_from_pos(args["symbol"], tf, 0, n)
    if r is None:
        raise RuntimeError(str(mt5.last_error()))
    return [{"time": int(x["time"]), "open": float(x["open"]), "high": float(x["high"]), "low": float(x["low"]), "close": float(x["close"]), "tick_volume": int(x["tick_volume"])} for x in r]


def trade_history(args):
    days = max(1, min(int(args.get("days", 7)), 365))
    to = datetime.now(timezone.utc) + timedelta(days=1)
    rows = mt5.history_deals_get(to - timedelta(days=days + 1), to) or []
    keep = ("ticket", "order", "position_id", "symbol", "type", "entry", "volume", "price", "profit", "commission", "swap", "comment", "time")
    return [{k: _d(d).get(k) for k in keep} for d in rows][-200:]


def place_order(args):
    _demo_only()
    s = args["symbol"]
    mt5.symbol_select(s, True)
    t = mt5.symbol_info_tick(s)
    if t is None:
        raise RuntimeError(f"No price for {s}")
    buy = str(args["side"]).lower() in ("buy", "long")
    kind = str(args.get("type", "market")).lower()
    req = {"symbol": s, "volume": float(args["volume"]), "sl": float(args.get("sl") or 0), "tp": float(args.get("tp") or 0),
           "deviation": 50, "magic": 26032027, "comment": str(args.get("comment") or "QuantBot model")[:30], "type_time": 0, "type_filling": 1}
    if kind == "market":
        req.update(action=1, type=0 if buy else 1, price=t.ask if buy else t.bid)  # TRADE_ACTION_DEAL
    else:
        price = float(args["price"])
        types = {("limit", True): 2, ("limit", False): 3, ("stop", True): 4, ("stop", False): 5}
        if (kind, buy) not in types:
            raise RuntimeError("type must be market, limit or stop")
        req.update(action=5, type=types[(kind, buy)], price=price)  # TRADE_ACTION_PENDING
    return _result(mt5.order_send(req))


def modify_position(args):
    _demo_only()
    p = mt5.positions_get(ticket=int(args["ticket"]))
    if not p:
        raise RuntimeError(f"No open position {args['ticket']}")
    p = p[0]
    return _result(mt5.order_send({"action": 6, "position": p.ticket, "symbol": p.symbol,  # TRADE_ACTION_SLTP
                                   "sl": float(args.get("sl", p.sl) or 0), "tp": float(args.get("tp", p.tp) or 0)}))


def close_position(args):
    _demo_only()
    p = mt5.positions_get(ticket=int(args["ticket"]))
    if not p:
        raise RuntimeError(f"No open position {args['ticket']}")
    p = p[0]
    t = mt5.symbol_info_tick(p.symbol)
    vol = float(args.get("volume") or p.volume)
    buy_pos = p.type == 0
    return _result(mt5.order_send({"action": 1, "position": p.ticket, "symbol": p.symbol, "volume": vol, "type": 1 if buy_pos else 0,
                                   "price": t.bid if buy_pos else t.ask, "deviation": 50, "magic": 26032027, "comment": "QuantBot close", "type_filling": 1}))


def cancel_order(args):
    _demo_only()
    return _result(mt5.order_send({"action": 8, "order": int(args["ticket"])}))  # TRADE_ACTION_REMOVE


S = lambda **p: {"type": "object", "properties": p, "required": [k for k, v in p.items() if v.pop("_req", False)]}
TOOLS = {
    "account_info": (account_info, "The MT5 account: login, server, balance, equity, margin, profit, and whether it is a demo (trading tools work only on demo).", S()),
    "positions": (positions, "Open positions (optionally one symbol): ticket, side, volume, open price, SL, TP, current price, profit.", S(symbol={"type": "string"})),
    "pending_orders": (pending_orders, "Pending limit / stop orders (optionally one symbol).", S(symbol={"type": "string"})),
    "symbol_info": (symbol_info, "A symbol's live bid / ask, spread, digits, contract size, tick value and lot limits (e.g. XAUUSD).", S(symbol={"type": "string", "_req": True})),
    "bars": (bars, f"Latest bars of a symbol from MT5 (newest last), at most {MAX_BARS}. timeframe: {', '.join(TF)}.", S(symbol={"type": "string", "_req": True}, timeframe={"type": "string"}, count={"type": "integer"})),
    "trade_history": (trade_history, "Closed deals of the last N days (default 7): entries, exits, profit, commission.", S(days={"type": "integer"})),
    "place_order": (place_order, "DEMO ONLY. Open a trade: side buy/sell, volume in lots, type market/limit/stop (price for limit/stop), optional sl and tp.",
                    S(symbol={"type": "string", "_req": True}, side={"type": "string", "_req": True}, volume={"type": "number", "_req": True}, type={"type": "string"}, price={"type": "number"}, sl={"type": "number"}, tp={"type": "number"}, comment={"type": "string"})),
    "modify_position": (modify_position, "DEMO ONLY. Change an open position's SL and/or TP.", S(ticket={"type": "integer", "_req": True}, sl={"type": "number"}, tp={"type": "number"})),
    "close_position": (close_position, "DEMO ONLY. Close an open position (all, or part with volume).", S(ticket={"type": "integer", "_req": True}, volume={"type": "number"})),
    "cancel_order": (cancel_order, "DEMO ONLY. Cancel a pending order.", S(ticket={"type": "integer", "_req": True})),
}


def handle(msg):
    method, params = msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion", PROTOCOL), "capabilities": {"tools": {}}, "serverInfo": {"name": "quantbot-mt5", "version": "1.0"}}
    if method == "tools/list":
        return {"tools": [{"name": n, "description": d, "inputSchema": s} for n, (_, d, s) in TOOLS.items()]}
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in TOOLS:
            return {"content": [{"type": "text", "text": f"Unknown tool {name}"}], "isError": True}
        try:
            _connect()
            out = TOOLS[name][0](args)
            return {"content": [{"type": "text", "text": json.dumps(out, default=str)}]}
        except Exception as e:
            return {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
    if method == "ping":
        return {}
    raise KeyError(method)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("id") is None:
            continue  # notifications
        try:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "result": handle(msg)}
        except KeyError:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "no such method"}}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
