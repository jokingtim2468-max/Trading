"""Stand-in MetaTrader5 package for testing mt5/mt5_mcp.py anywhere. FAKE_MT5_LIVE=1 makes the account a real one."""
import os
from types import SimpleNamespace as NS

_sent = []


def initialize(path=None):
    return True


def last_error():
    return (1, "Success")


def account_info():
    return NS(login=5100123, server="Demo-Server", company="Fake", currency="USD", balance=10000.0, equity=10012.5, margin=50.0, margin_free=9962.5,
              profit=12.5, leverage=100, trade_mode=2 if os.environ.get("FAKE_MT5_LIVE") else 0, trade_allowed=True)


def symbol_select(s, on):
    return True


def symbol_info(s):
    return NS(name=s, description="Gold", digits=2, point=0.01, spread=20, trade_contract_size=100.0, trade_tick_value=1.0, trade_tick_size=0.01,
              volume_min=0.01, volume_max=100.0, volume_step=0.01, currency_profit="USD") if s == "XAUUSD" else None


def symbol_info_tick(s):
    return NS(bid=2400.0, ask=2400.2, time=1700000000)


def positions_get(symbol=None, ticket=None):
    p = NS(ticket=77, symbol="XAUUSD", type=0, volume=0.1, price_open=2390.0, sl=2380.0, tp=2420.0, price_current=2400.0, profit=100.0, swap=0.0, comment="", time=1)
    return () if ticket not in (None, 77) else (p,)


def orders_get(symbol=None):
    return ()


def copy_rates_from_pos(s, tf, start, n):
    return [{"time": 1700000000 + i * 3600, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "tick_volume": 10} for i in range(n)]


def history_deals_get(a, b):
    return [NS(ticket=1, order=1, position_id=77, symbol="XAUUSD", type=0, entry=0, volume=0.1, price=2390.0, profit=0.0, commission=-0.5, swap=0.0, comment="", time=1)]


def order_send(req):
    _sent.append(req)
    return NS(retcode=10009, comment="done", order=900 + len(_sent), deal=0, price=req.get("price", 0), volume=req.get("volume", 0), request=req)
