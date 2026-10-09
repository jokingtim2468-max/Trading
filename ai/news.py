"""Free news sources: Yahoo Finance and Google News RSS headlines, ForexFactory economic calendar."""

import datetime as dt
import email.utils
import hashlib
import json
import ssl
import urllib.parse
import urllib.request

import defusedxml.ElementTree as ET   # remote XML: guard against entity-expansion attacks

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

FEEDS = {
    "NQ": {
        "yahoo": "NQ=F,^NDX,QQQ",
        "google": "Nasdaq 100 OR Nasdaq futures OR Federal Reserve OR US inflation when:1d",
    },
    "GC": {
        "yahoo": "GC=F,GLD",
        "google": "gold price OR Federal Reserve OR dollar index OR Treasury yields when:1d",
    },
}
CALENDAR = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        return r.read()


def _rss(url, source):
    out = []
    root = ET.fromstring(_get(url))
    for it in root.findall(".//item"):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        pub = it.findtext("pubDate")
        try:
            t = email.utils.parsedate_to_datetime(pub).astimezone(dt.timezone.utc) if pub else dt.datetime.now(dt.timezone.utc)
        except (TypeError, ValueError):
            t = dt.datetime.now(dt.timezone.utc)
        out.append({"id": hashlib.sha1(title.lower().encode()).hexdigest()[:16], "title": title,
                    "time": t.isoformat(), "source": source, "link": it.findtext("link") or ""})
    return out


def headlines(key, max_age_hours=12):
    """Recent headlines for one market, newest first, de-duplicated by title."""
    f = FEEDS[key]
    items, errors = [], []
    urls = [
        (f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={urllib.parse.quote(f['yahoo'])}&region=US&lang=en-US", "Yahoo Finance"),
        (f"https://news.google.com/rss/search?q={urllib.parse.quote(f['google'])}&hl=en-US&gl=US&ceid=US:en", "Google News"),
    ]
    for url, src in urls:
        try:
            items += _rss(url, src)
        except Exception as e:  # one feed failing shouldn't stop the other
            errors.append(f"{src}: {e}")
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=max_age_hours)
    seen, out = set(), []
    for it in sorted(items, key=lambda x: x["time"], reverse=True):
        if it["id"] in seen or dt.datetime.fromisoformat(it["time"]) < cutoff:
            continue
        seen.add(it["id"])
        out.append(it)
    return out, errors


def calendar():
    """This week's economic calendar (ForexFactory). Times are converted to UTC."""
    rows = json.loads(_get(CALENDAR))
    out = []
    for r in rows:
        try:
            t = dt.datetime.fromisoformat(r["date"]).astimezone(dt.timezone.utc)
        except (KeyError, ValueError):
            continue
        out.append({"title": r.get("title", ""), "country": r.get("country", ""), "impact": r.get("impact", ""),
                    "time": t.isoformat(), "forecast": r.get("forecast", ""), "previous": r.get("previous", "")})
    return out


def event_risk(events, now=None, before_min=30, after_min=15):
    """High-impact USD events from `before_min` minutes ahead to `after_min` minutes after release."""
    now = now or dt.datetime.now(dt.timezone.utc)
    hits = []
    for e in events:
        if e["impact"] != "High" or e["country"] != "USD":
            continue
        t = dt.datetime.fromisoformat(e["time"])
        mins = (t - now).total_seconds() / 60
        if -after_min <= mins <= before_min:
            hits.append({**e, "minutes": round(mins)})
    return hits
