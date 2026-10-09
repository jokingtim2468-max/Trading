"""Local HTTP bridge between the web chart UI and a running MetaTrader 5 terminal.

Run on the same Windows machine as MT5:
    pip install -r requirements.txt
    python mt5_bridge.py            # listens on 127.0.0.1:8765

Only binds to localhost. Uses the official MetaTrader5 Python package.
"""
import base64
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import MetaTrader5 as mt5
except ImportError:  # allows importing on non-Windows for tests
    mt5 = None

HOST, PORT = "127.0.0.1", int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
ALLOWED_ORIGINS = os.environ.get("MT5_BRIDGE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
EA_NAME = re.compile(r"^[\w\- .]+\.(mq5|ex5|mqh)$", re.I)

TF = {}
if mt5:
    for n in ["M1", "M2", "M3", "M4", "M5", "M6", "M10", "M12", "M15", "M20", "M30",
              "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"]:
        TF[n] = getattr(mt5, "TIMEFRAME_" + n)


def group_of(path):
    p = path.lower()
    for key, name in (("metal", "Metals"), ("crypto", "Crypto"), ("ind", "Indices"), ("energ", "Energies"),
                      ("oil", "Energies"), ("stock", "Stocks"), ("share", "Stocks"), ("forex", "Forex")):
        if key in p:
            return name
    return path.split("\\")[0] or "Other"


def experts_dir():
    info = mt5.terminal_info()
    if not info:
        raise RuntimeError("terminal not initialised")
    return os.path.join(info.data_path, "MQL5", "Experts")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, obj):
        body = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _route(self, method):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        fn = getattr(self, f"{method}_{u.path.strip('/') or 'root'}", None)
        if not fn:
            return self._send(404, {"error": "not found"})
        try:
            self._send(200, fn(q))
        except Exception as e:  # report errors to the UI
            self._send(400, {"error": str(e)})

    def do_GET(self):
        self._route("get")

    def do_POST(self):
        self._route("post")

    def do_DELETE(self):
        self._route("delete")

    def log_message(self, *a):
        pass

    # ---- endpoints ----
    def get_status(self, q):
        acc = mt5.account_info() if mt5 else None
        return {"connected": bool(acc), "login": acc.login if acc else None, "server": acc.server if acc else None}

    def post_login(self, q):
        b = self._body()
        kw = {}
        if b.get("path"):
            kw["path"] = b["path"]
        if b.get("login"):
            kw.update(login=int(b["login"]), password=b.get("password", ""), server=b.get("server", ""))
        if not mt5.initialize(**kw):
            raise RuntimeError(f"initialize failed: {mt5.last_error()}")
        return self.get_status(q)

    def get_symbols(self, q):
        out = []
        for s in mt5.symbols_get() or []:
            if s.visible or q.get("all"):
                out.append({"name": s.name, "desc": s.description, "group": group_of(s.path), "digits": s.digits})
        return sorted(out, key=lambda s: (s["group"], s["name"]))

    def get_rates(self, q):
        sym = q["symbol"]
        mt5.symbol_select(sym, True)
        rates = mt5.copy_rates_from_pos(sym, TF[q.get("timeframe", "H1")], 0, int(q.get("count", 1000)))
        if rates is None:
            raise RuntimeError(f"no data: {mt5.last_error()}")
        return [{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]),
                 "close": float(r["close"]), "volume": int(r["tick_volume"])} for r in rates]

    def get_tick(self, q):
        t = mt5.symbol_info_tick(q["symbol"])
        return {"time": t.time, "bid": t.bid, "ask": t.ask, "last": t.last}

    def get_account(self, q):
        return mt5.account_info()._asdict()

    def get_positions(self, q):
        return [{**p._asdict(), "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL"} for p in mt5.positions_get() or []]

    def get_orders(self, q):
        return [o._asdict() for o in mt5.orders_get() or []]

    def get_history(self, q):
        import time
        deals = mt5.history_deals_get(time.time() - 30 * 86400, time.time() + 86400) or []
        return [{"time": d.time, "ticket": d.ticket, "symbol": d.symbol, "type": "BUY" if d.type == 0 else "SELL",
                 "volume": d.volume, "price": d.price, "profit": d.profit} for d in deals if d.symbol][::-1]

    def post_order(self, q):
        b = self._body()
        sym, side = b["symbol"], b["side"]
        info, tick = mt5.symbol_info(sym), mt5.symbol_info_tick(sym)
        price = tick.ask if side == "BUY" else tick.bid
        sign = 1 if side == "BUY" else -1
        fill = {"Fill or Kill": mt5.ORDER_FILLING_FOK, "Immediate or Cancel": mt5.ORDER_FILLING_IOC,
                "Return": mt5.ORDER_FILLING_RETURN}.get(b.get("filling"), mt5.ORDER_FILLING_IOC)
        req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": sym, "volume": float(b["volume"]),
               "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL, "price": price,
               "deviation": int(b.get("deviation", 20)), "magic": int(b.get("magic", 0)),
               "comment": "web-chart", "type_time": mt5.ORDER_TIME_GTC, "type_filling": fill}
        if b.get("sl_points"):
            req["sl"] = price - sign * b["sl_points"] * info.point
        if b.get("tp_points"):
            req["tp"] = price + sign * b["tp_points"] * info.point
        r = mt5.order_send(req)
        if r is None or r.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"order rejected: {r.comment if r else mt5.last_error()}")
        return r._asdict()

    def post_close(self, q):
        ticket = int(self._body()["ticket"])
        p = (mt5.positions_get(ticket=ticket) or [None])[0]
        if not p:
            raise RuntimeError("position not found")
        tick = mt5.symbol_info_tick(p.symbol)
        buy = p.type == mt5.POSITION_TYPE_BUY
        r = mt5.order_send({"action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": p.volume, "position": ticket,
                            "type": mt5.ORDER_TYPE_SELL if buy else mt5.ORDER_TYPE_BUY,
                            "price": tick.bid if buy else tick.ask, "deviation": 20,
                            "type_filling": mt5.ORDER_FILLING_IOC})
        if r is None or r.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"close rejected: {r.comment if r else mt5.last_error()}")
        return r._asdict()

    def get_experts(self, q):
        d = experts_dir()
        return sorted(f for f in os.listdir(d) if EA_NAME.match(f))

    def post_experts(self, q):
        b = self._body()
        name = os.path.basename(b["name"])
        if not EA_NAME.match(name):
            raise RuntimeError("only .mq5 / .ex5 / .mqh files allowed")
        with open(os.path.join(experts_dir(), name), "wb") as f:
            f.write(base64.b64decode(b["content"]))
        return {"ok": True, "name": name}

    def delete_experts(self, q):
        name = os.path.basename(q["name"])
        if not EA_NAME.match(name):
            raise RuntimeError("invalid name")
        os.remove(os.path.join(experts_dir(), name))
        return {"ok": True}


def main():
    if mt5 is None:
        sys.exit("MetaTrader5 package not installed (Windows only): pip install MetaTrader5")
    if not mt5.initialize():
        print("MT5 not initialised yet — log in from the web UI (Settings → MT5: Server).")
    print(f"MT5 bridge on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
