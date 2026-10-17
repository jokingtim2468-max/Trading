"""Stand-in for the MetaTrader5 package (Windows only) so the daemon can be tested anywhere.
FAKE_MT5_FAIL: comma-separated logins whose login fails; FAKE_MT5_NO_ALGO: logins with Algo Trading off;
FAKE_MT5_CALLS: file where every initialize() call is written as a JSON line (with the process id)."""
import json
import os
from types import SimpleNamespace

_state = {"login": None}
_error = (1, "Success")


def _logins(var):
    return {int(x) for x in os.environ.get(var, "").split(",") if x.strip()}


def initialize(path=None, login=None, password=None, server=None, timeout=None, portable=False):
    global _error
    with open(os.environ["FAKE_MT5_CALLS"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"pid": os.getpid(), "path": path, "login": login, "password": password, "server": server, "portable": portable}) + "\n")
    if login in _logins("FAKE_MT5_FAIL"):
        _error = (-6, "Terminal: Authorization failed")
        return False
    _state["login"] = login
    return True


def shutdown():
    _state["login"] = None


def last_error():
    return _error


def terminal_info():
    if _state["login"] is None:
        return None
    return SimpleNamespace(connected=True, trade_allowed=_state["login"] not in _logins("FAKE_MT5_NO_ALGO"))


def account_info():
    if _state["login"] is None:
        return None
    return SimpleNamespace(login=_state["login"], balance=100000.0 + _state["login"] % 1000, equity=100050.0, currency="USD")
