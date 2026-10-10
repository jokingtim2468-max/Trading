"""Read-only HTTP bridge between the web chart UI and a running MetaTrader 5 terminal.

It serves prices, symbols and terminal status only. It has no endpoint that
places, modifies or closes orders: trading is done on the broker's own
platform (FTMO via TradingView), never through this bridge.

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

    def get_ticks(self, q):
        out = []
        for sym in q.get("symbols", "").split(",")[:60]:
            if not sym:
                continue
            mt5.symbol_select(sym, True)
            t, info = mt5.symbol_info_tick(sym), mt5.symbol_info(sym)
            if t and info:
                out.append({"symbol": sym, "time": t.time, "bid": t.bid, "ask": t.ask,
                            "digits": info.digits, "point": info.point})
        return out

    def get_terminal(self, q):
        t, a = mt5.terminal_info(), mt5.account_info()
        return {"terminal": t._asdict() if t else None,
                "account": {k: getattr(a, k) for k in ("login", "server", "company", "name", "currency", "trade_mode")} if a else None,
                "version": mt5.version()}

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
