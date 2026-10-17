#!/usr/bin/env python3
"""QuantBot MT5 daemon: keeps every enabled MT5 account logged in, 24/7.

QuantBot (the app, on the same PC / VPS) holds the accounts: broker, account number, server, the account's own
terminal64.exe and its password (encrypted; QuantBot hands it to this daemon over 127.0.0.1 only, with the daemon
token). For each account this daemon runs one worker process, because the MetaTrader5 package talks to one terminal
per process. A worker starts and logs in its terminal, checks the connection every 30 seconds, logs in again when
the terminal or the broker connection drops (waiting longer after each failure, up to 5 minutes), and reports the
state, balance and equity back to QuantBot. QuantBot's Copier EA in each terminal places the copied trades.

    pip install MetaTrader5
    python mt5_manager.py --token <token from QuantBot Settings > MT5 & deployment>

Each account needs its own MT5 installation folder (copy the folder, or install each broker's terminal), so two
accounts never share one terminal64.exe. Windows only (the MetaTrader5 package is).
"""
import argparse
import hashlib
import json
import logging
import logging.handlers
import multiprocessing as mp
import os
import sys
import time
import urllib.error
import urllib.request

CHECK_SECONDS = 30
REFRESH_SECONDS = 60
MAX_BACKOFF = 300
log = logging.getLogger("mt5_manager")


def setup_logging(path):
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    out = logging.StreamHandler(sys.stdout)
    out.setFormatter(fmt)
    log.addHandler(out)
    if path:
        f = logging.handlers.RotatingFileHandler(path, maxBytes=2_000_000, backupCount=2, encoding="utf-8")
        f.setFormatter(fmt)
        log.addHandler(f)


def api(url, token, path, body=None, timeout=10):
    """GET (no body) or POST JSON to QuantBot; returns the decoded JSON reply."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url.rstrip("/") + path, data=data, method="GET" if body is None else "POST",
                                 headers={"x-quantbot-daemon": token, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8") or "{}")


def report(url, token, acc, state, **extra):
    try:
        api(url, token, "/daemon/status", {"id": acc["id"], "state": state, **extra})
    except Exception as e:  # QuantBot closed or restarting: the next report catches up
        log.warning("could not report %s to QuantBot: %s", acc.get("label"), e)


def signature(acc):
    """Changes when anything that needs a fresh login changes."""
    keys = ("account_number", "password", "server", "terminal_path", "portable")
    return hashlib.sha256(json.dumps([acc.get(k) for k in keys]).encode()).hexdigest()


def connection(mt5, acc):
    """The account's live state, or None when the terminal isn't logged in to it and connected."""
    ti, ai = mt5.terminal_info(), mt5.account_info()
    if ti is None or ai is None or not ti.connected or int(ai.login) != int(acc["account_number"]):
        return None
    return {"balance": ai.balance, "equity": ai.equity, "currency": ai.currency, "algo_trading": bool(ti.trade_allowed)}


def worker(acc, url, token, stop, cycles=None, log_path=""):
    """One account: log in, then check every 30 s and log in again when the connection drops."""
    if not log.handlers:  # a new process (spawn) starts without the parent's logging
        setup_logging(log_path)
    import MetaTrader5 as mt5
    name = f"{acc.get('broker_name') or ''} #{acc['account_number']}".strip()
    backoff, done, warned_algo = 10, 0, False
    last = lambda: cycles is not None and done >= cycles  # noqa: E731
    while not stop.is_set() and (cycles is None or done < cycles):
        done += 1
        state = connection(mt5, acc)
        if state is None:
            mt5.shutdown()
            report(url, token, acc, "connecting")
            kwargs = {"login": int(acc["account_number"]), "password": acc["password"], "server": acc["server"], "timeout": 60000}
            if acc.get("terminal_path"):
                kwargs["path"] = acc["terminal_path"]
            if acc.get("portable"):
                kwargs["portable"] = True
            if not mt5.initialize(**kwargs):
                code, message = mt5.last_error()
                log.error("[%s] login failed (%s %s), trying again in %ss", name, code, message, backoff)
                report(url, token, acc, "error", error=f"login failed: {code} {message}")
                if last():
                    break
                stop.wait(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
                continue
            state = connection(mt5, acc)
            if state is None:
                log.error("[%s] logged in but not connected to %s yet", name, acc["server"])
                report(url, token, acc, "error", error=f"terminal started but not connected to {acc['server']}")
                if last():
                    break
                stop.wait(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
                continue
            log.info("[%s] logged in to %s, balance %.2f %s", name, acc["server"], state["balance"], state["currency"])
            backoff = 10
        if not state["algo_trading"] and not warned_algo:
            log.warning("[%s] Algo Trading is off in this terminal: the Copier EA can't trade", name)
            warned_algo = True
        report(url, token, acc, "connected", **state)
        if not last():
            stop.wait(CHECK_SECONDS)
    mt5.shutdown()


def plan(accounts):
    """Accounts to run, and the ones refused (two accounts can't share one terminal64.exe)."""
    run, refused, used = [], [], {}
    for acc in accounts:
        key = os.path.normcase(os.path.abspath(acc["terminal_path"])) if acc.get("terminal_path") else "<default terminal>"
        if key in used:
            refused.append((acc, f"uses the same terminal as {used[key]}: give each account its own MT5 folder (terminal path)"))
            continue
        used[key] = acc.get("label") or acc["account_number"]
        run.append(acc)
    return run, refused


class Supervisor:
    def __init__(self, url, token, cycles=None, log_path=""):
        self.url, self.token, self.cycles, self.log_path = url, token, cycles, log_path
        self.workers = {}  # account id -> (process, stop event, signature)
        self.ctx = mp.get_context("spawn")

    def stop_worker(self, acc_id, why):
        proc, ev, _, label = self.workers.pop(acc_id)
        ev.set()
        proc.join(20)
        if proc.is_alive():
            proc.terminate()
        log.info("stopped %s (%s)", label, why)

    def tick(self):
        try:
            accounts = api(self.url, self.token, "/daemon/accounts").get("accounts", [])
        except urllib.error.HTTPError as e:
            log.error("QuantBot refused the daemon (%s): check the token in Settings > MT5 & deployment", e.code)
            return
        except Exception as e:
            log.warning("QuantBot isn't reachable at %s (%s); retrying", self.url, e)
            return
        run, refused = plan(accounts)
        for acc, why in refused:
            log.error("[%s] %s", acc.get("label"), why)
            report(self.url, self.token, acc, "error", error=why)
        wanted = {a["id"]: a for a in run}
        for acc_id in list(self.workers):
            proc, _, sig, _ = self.workers[acc_id]
            if acc_id not in wanted:
                self.stop_worker(acc_id, "disabled or removed in QuantBot")
            elif sig != signature(wanted[acc_id]):
                self.stop_worker(acc_id, "login details changed")
            elif not proc.is_alive() and self.cycles is None:
                self.workers.pop(acc_id)
                log.warning("worker for %s stopped unexpectedly, restarting", wanted[acc_id].get("label"))
        for acc_id, acc in wanted.items():
            if acc_id in self.workers:
                continue
            ev = self.ctx.Event()
            proc = self.ctx.Process(target=worker, args=(acc, self.url, self.token, ev, self.cycles, self.log_path), name=f"mt5-{acc['account_number']}", daemon=True)
            proc.start()
            self.workers[acc_id] = (proc, ev, signature(acc), acc.get("label") or acc["account_number"])
            log.info("started account %s (%s on %s)", acc.get("label"), acc["account_number"], acc["server"])

    def run(self):
        log.info("QuantBot MT5 daemon started, QuantBot at %s", self.url)
        try:
            while True:
                self.tick()
                if self.cycles is not None:
                    for proc, _, _, _ in list(self.workers.values()):
                        proc.join(120)
                    return
                time.sleep(REFRESH_SECONDS)
        except KeyboardInterrupt:
            log.info("stopping")
        finally:
            for acc_id in list(self.workers):
                self.stop_worker(acc_id, "daemon stopping")


def main(argv=None):
    p = argparse.ArgumentParser(description="Keep QuantBot's MT5 accounts logged in, 24/7.")
    p.add_argument("--url", default=os.environ.get("QUANTBOT_URL", "http://127.0.0.1:5174"), help="QuantBot's address on this PC")
    p.add_argument("--token", default=os.environ.get("QUANTBOT_DAEMON_TOKEN"), help="daemon token from QuantBot Settings > MT5 & deployment")
    p.add_argument("--log", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "mt5_manager.log"), help="log file ('' for none)")
    p.add_argument("--once", action="store_true", help="log every account in once, report, and exit (a test run)")
    args = p.parse_args(argv)
    setup_logging(args.log)
    if not args.token:
        p.error("--token is required (QuantBot Settings > MT5 & deployment)")
    Supervisor(args.url, args.token, cycles=1 if args.once else None, log_path=args.log).run()


if __name__ == "__main__":
    mp.freeze_support()
    main()
