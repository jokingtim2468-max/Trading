"""Day Range Predictor AI service: quick-trade TP/SL from price + news (local Llama via Ollama).

Every minute it rebuilds the 5-minute features, gets the price model's probability, shifts it
with the news score from the local Llama model, and publishes the TP/SL for the side it leans to:

  * http://127.0.0.1:8766/ai            JSON for the web app (and anything else on this PC)
  * MT5 Common\\Files\\DRP_AI_<NQ|GC>.txt  read by the DayRangePredictor EA
  * ai/logs/predictions.csv             every call, so ai/evaluate.py can measure it later

Prices come from the MT5 bridge (bridge/mt5_bridge.py, real time) when it's running, otherwise
from Yahoo Finance (delayed). Settings: ai/config.json (created on first run).

Run:  ollama pull llama3.1:8b   then   python ai/service.py
Educational tool. Not financial advice. No prediction is certain.
"""

import argparse
import copy
import csv
import datetime as dt
import json
import math
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from ai import llm, news, short_model as SM  # noqa: E402
import train_drp as T  # noqa: E402

DEFAULTS = {
    "ollama_url": "http://127.0.0.1:11434",
    "ollama_model": "llama3.1:8b",
    "news_weight": 0.4,            # how far news can move the probability (0 = ignore news)
    "news_half_life_min": 120,
    "news_refresh_sec": 300,
    "price_refresh_sec": 60,
    "port": 8766,
    "mt5_bridge": "http://127.0.0.1:8765",
    "server_minus_ny_hours": 7,    # broker server time minus New York time (7 for most MT5 brokers)
    "symbols": {"NQ": {"mt5": "US100"}, "GC": {"mt5": "XAUUSD"}},
    "allowed_origins": ["http://localhost:5173", "http://127.0.0.1:5173"],
}
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def load_config():
    path = ROOT / "ai/config.json"
    cfg = copy.deepcopy(DEFAULTS)
    if path.exists():
        cfg.update(json.loads(path.read_text()))
    else:
        path.write_text(json.dumps(DEFAULTS, indent=2))
    return cfg


def mt5_files_dir():
    appdata = os.environ.get("APPDATA")
    if appdata:
        d = Path(appdata) / "MetaQuotes" / "Terminal" / "Common" / "Files"
        if d.parent.exists():
            d.mkdir(exist_ok=True)
            return d
    d = ROOT / "ai" / "out"
    d.mkdir(parents=True, exist_ok=True)
    return d


def sigmoid(x):
    return 1 / (1 + math.exp(-x))


def logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


class Service:
    def __init__(self, cfg):
        self.cfg = cfg
        self.model = json.loads((ROOT / "ai/model.json").read_text())
        self.scorer = llm.NewsScorer(cfg["ollama_url"], cfg["ollama_model"], ROOT / "ai/cache/news_scores.json")
        self.lock = threading.Lock()
        self.out = {}
        self.news = {k: {"score": 0.0, "top": [], "count": 0, "errors": []} for k in cfg["symbols"]}
        self.events, self.llm_ok, self.news_time = [], False, None
        self.daily, self.daily_time = {}, {}
        self.files = mt5_files_dir()
        self.log = ROOT / "ai/logs/predictions.csv"
        self.log.parent.mkdir(parents=True, exist_ok=True)

    # ---------------- data
    def bars(self, key):
        sym = self.cfg["symbols"][key].get("mt5")
        if sym:
            try:
                q = urllib.parse.urlencode({"symbol": sym, "timeframe": "M5", "count": 900})
                rows = json.loads(_LOCAL.open(f"{self.cfg['mt5_bridge']}/rates?{q}", timeout=5).read())
                if isinstance(rows, list) and len(rows) > 100:
                    t = pd.to_datetime([r["time"] for r in rows], unit="s") - pd.Timedelta(hours=self.cfg["server_minus_ny_hours"])
                    idx = t.tz_localize("America/New_York", ambiguous="NaT", nonexistent="shift_forward")
                    df = pd.DataFrame({"o": [r["open"] for r in rows], "h": [r["high"] for r in rows],
                                       "l": [r["low"] for r in rows], "c": [r["close"] for r in rows],
                                       "v": [r["volume"] for r in rows]}, index=idx)
                    return df[df.index.notna()], f"MT5 {sym}"
            except Exception:
                pass
        df = T.yahoo(self.model["symbols"][key]["yahoo"], "5d", "5m")
        return df, "Yahoo (delayed)"

    def day_atr(self, key):
        if key not in self.daily or time.time() - self.daily_time[key] > 3600:
            m = self.model["symbols"][key]
            d = T.yahoo(m["yahoo"], "1y", "1d")
            d.index = d.index.date
            tr = np.maximum(d.h, d.c.shift()) - np.minimum(d.l, d.c.shift())
            self.daily[key] = tr.rolling(m["atr_days"]).mean().shift().to_dict()
            self.daily_time[key] = time.time()
        return self.daily[key]

    # ---------------- loops
    def update_news(self):
        self.llm_ok = self.scorer.available()
        try:
            self.events = news.calendar()
        except Exception as e:
            print("calendar:", e)
        now = dt.datetime.now(dt.timezone.utc)
        for key in self.cfg["symbols"]:
            items, errors = news.headlines(key)
            if self.llm_ok:
                self.scorer.score(items)
            score, top = llm.aggregate(items, key, now, self.cfg["news_half_life_min"])
            with self.lock:
                self.news[key] = {"score": score if self.llm_ok else 0.0, "top": top, "count": len(items),
                                  "errors": errors, "latest": [i["title"] for i in items[:5]]}
        self.news_time = now
        print(f"[{now:%H:%M}Z] news: " + ", ".join(f"{k} {v['score']:+.2f} ({v['count']} headlines)" for k, v in self.news.items())
              + ("" if self.llm_ok else f"  [Ollama model {self.cfg['ollama_model']} not available: news ignored]"))

    def update_prices(self):
        now = dt.datetime.now(dt.timezone.utc)
        for key in self.cfg["symbols"]:
            m = self.model["symbols"][key]
            try:
                b, src = self.bars(key)
                F, atr = SM.features(b, self.day_atr(key), m["live"])
            except Exception as e:
                print(f"{key}: price update failed: {e}")
                continue
            ok = F.notna().all(axis=1) & atr.notna()
            if not ok.any():
                continue
            last = F[ok].index[-1]
            p_price = float(SM.predict(F.loc[[last]], m["short"])[0])
            with self.lock:
                nw = self.news[key]
            p = sigmoid(logit(p_price) + self.cfg["news_weight"] * 2 * nw["score"])
            price, a5 = float(b.c.loc[last]), float(atr.loc[last])
            lv = SM.levels(price, a5, p, m["short"])
            risk = news.event_risk(self.events, now)
            if risk:
                lv["setup"] = False
            s = m["short"]
            out = {
                "symbol": key, "time": now.isoformat(), "bar_time": last.isoformat(), "source": src,
                "price": price, "atr5": a5, "p_price": p_price, "news": nw["score"], "p": p, **lv,
                "event": "; ".join(f"{e['title']} ({e['minutes']:+d} min)" for e in risk),
                "headlines": nw["top"], "latest": nw.get("latest", []), "llm": self.llm_ok, "llm_model": self.cfg["ollama_model"],
                "model": {"edge": s["edge"], "hold_win": s["hold"]["win"], "hold_ev": s["hold"]["ev"],
                          "hold_trades": s["hold"]["n"], "acc_hold": s["acc_hold"], "trained": self.model["trained"]},
            }
            with self.lock:
                self.out[key] = out
            self.write_mt5(key, out)
            self.write_log(out)

    def write_mt5(self, key, o):
        lines = {
            "time": o["time"], "epoch": int(dt.datetime.fromisoformat(o["time"]).timestamp()), "source": o["source"],
            "dir": o["dir"], "conf": f"{o['conf']:.4f}", "setup": int(o["setup"]),
            "tp_dist": f"{o['tp_dist']:.5f}", "sl_dist": f"{o['sl_dist']:.5f}",
            "p_price": f"{o['p_price']:.4f}", "news": f"{o['news']:.3f}", "llm": int(o["llm"]), "event": o["event"],
            "edge": int(o["model"]["edge"]), "hold_win": f"{o['model']['hold_win']:.3f}", "hold_ev": f"{o['model']['hold_ev']:.3f}",
        }
        for i, h in enumerate(o["headlines"][:3], 1):
            lines[f"headline{i}"] = f"{h['score']:+d} {h['title']}"[:180].replace("\n", " ")
        text = "".join(f"{k}={v}\n" for k, v in lines.items())
        tmp = self.files / f"DRP_AI_{key}.tmp"
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, self.files / f"DRP_AI_{key}.txt")

    def write_log(self, o):
        new = not self.log.exists()
        with self.log.open("a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "bar_time", "symbol", "source", "price", "atr5", "p_price", "news", "p", "dir",
                            "setup", "tp_dist", "sl_dist", "event"])
            w.writerow([o["time"], o["bar_time"], o["symbol"], o["source"], o["price"], o["atr5"], round(o["p_price"], 4),
                        round(o["news"], 3), round(o["p"], 4), o["dir"], int(o["setup"]), o["tp_dist"], o["sl_dist"], o["event"]])

    def run_loops(self):
        next_news = 0
        while True:
            if time.time() >= next_news:
                try:
                    self.update_news()
                except Exception as e:
                    print("news update failed:", e)
                next_news = time.time() + self.cfg["news_refresh_sec"]
            self.update_prices()
            time.sleep(self.cfg["price_refresh_sec"])

    def snapshot(self, key=None):
        with self.lock:
            if key:
                return self.out.get(key, {"error": "warming up"})
            return {"symbols": self.out, "llm": self.llm_ok, "llm_model": self.cfg["ollama_model"],
                    "news_time": self.news_time.isoformat() if self.news_time else None}


def make_handler(svc):
    origins = set(svc.cfg["allowed_origins"])

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            origin = self.headers.get("Origin", "")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            if u.path == "/ai":
                key = q.get("symbol")
                if key:
                    key = "GC" if any(x in key.upper() for x in ("XAU", "GOLD", "GC")) else "NQ"
                self._send(200, svc.snapshot(key))
            elif u.path == "/health":
                self._send(200, {"ok": True, "llm": svc.llm_ok})
            else:
                self._send(404, {"error": "not found"})

        def log_message(self, *a):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="run one news + price update, print it and exit")
    a = ap.parse_args()
    cfg = load_config()
    svc = Service(cfg)
    if a.once:
        svc.update_news()
        svc.update_prices()
        print(json.dumps(svc.snapshot(), indent=1, default=str))
        print(f"MT5 files written to {svc.files}")
        return
    threading.Thread(target=svc.run_loops, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", cfg["port"]), make_handler(svc))
    print(f"DRP AI service on http://127.0.0.1:{cfg['port']}/ai   (Ollama model: {cfg['ollama_model']})")
    print(f"MT5 files: {svc.files}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
