"""Score headlines with a local Llama model through Ollama (http://127.0.0.1:11434).

Each headline gets nasdaq (-2..2), gold (-2..2) and relevance (0..3). Scores are cached on disk so
a headline is only sent to the model once.
"""

import datetime as dt
import json
import math
import urllib.request
from pathlib import Path

SYSTEM = (
    "You score financial news headlines for short-term traders of Nasdaq 100 futures and gold. "
    "For the headline, give: nasdaq (-2..2), gold (-2..2), relevance (0..3). "
    "Rules: rate hikes, hot inflation, higher yields => nasdaq negative, gold negative. "
    "Rate cuts, cooling inflation, lower yields, weaker dollar => nasdaq positive, gold positive. "
    "War, geopolitical risk, safe-haven demand => gold positive, nasdaq negative. "
    "Strong big-tech earnings => nasdaq positive. A headline that reports gold rising => gold +1 or +2. "
    "Company press releases about small mines or single small stocks => relevance 0. Answer only JSON."
)
EXAMPLES = [
    ("Fed signals two more rate hikes as inflation stays hot", {"nasdaq": -2, "gold": -1, "relevance": 3}),
    ("Nvidia beats estimates, raises guidance", {"nasdaq": 2, "gold": 0, "relevance": 2}),
    ("Small miner announces drilling results in Nevada", {"nasdaq": 0, "gold": 0, "relevance": 0}),
]
SCHEMA = {
    "type": "object",
    "properties": {
        "nasdaq": {"type": "integer", "minimum": -2, "maximum": 2},
        "gold": {"type": "integer", "minimum": -2, "maximum": 2},
        "relevance": {"type": "integer", "minimum": 0, "maximum": 3},
    },
    "required": ["nasdaq", "gold", "relevance"],
}
# Ollama is local: never route it through an HTTP proxy
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class NewsScorer:
    def __init__(self, url, model, cache_path):
        self.url = url.rstrip("/")
        self.model = model
        self.cache_path = Path(cache_path)
        self.cache = json.loads(self.cache_path.read_text()) if self.cache_path.exists() else {}

    def available(self):
        try:
            tags = json.loads(_LOCAL.open(self.url + "/api/tags", timeout=5).read())
            return any(m.get("name", "").split(":")[0] == self.model.split(":")[0] for m in tags.get("models", []))
        except Exception:
            return False

    def _ask(self, title):
        msgs = [{"role": "system", "content": SYSTEM}]
        if not self.model.startswith("drp"):        # the fine-tuned model learned the format; base models need examples
            for h, o in EXAMPLES:
                msgs += [{"role": "user", "content": h}, {"role": "assistant", "content": json.dumps(o)}]
        msgs.append({"role": "user", "content": title})
        body = {"model": self.model, "stream": False, "format": SCHEMA, "options": {"temperature": 0}, "messages": msgs}
        req = urllib.request.Request(self.url + "/api/chat", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        out = json.loads(json.loads(_LOCAL.open(req, timeout=120).read())["message"]["content"])
        clamp = lambda v, lo, hi: max(lo, min(hi, int(v)))  # noqa: E731
        return {"nasdaq": clamp(out["nasdaq"], -2, 2), "gold": clamp(out["gold"], -2, 2),
                "relevance": clamp(out["relevance"], 0, 3)}

    def score(self, items, limit=40):
        """Add 'score' to each headline, asking the model only for ones not in the cache."""
        asked = 0
        for it in items:
            if it["id"] not in self.cache and asked < limit:
                try:
                    self.cache[it["id"]] = self._ask(it["title"])
                except Exception as e:
                    it["error"] = str(e)
                asked += 1
            it["score"] = self.cache.get(it["id"])
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self.cache))
        return asked


def aggregate(items, key, now, half_life_min=120):
    """Time-decayed, relevance-weighted news score in [-1, 1] for one market, plus the top headlines."""
    field = "nasdaq" if key == "NQ" else "gold"
    num = den = 0.0
    top = []
    for it in items:
        s = it.get("score")
        if not s or s["relevance"] == 0:
            continue
        age = (now - dt.datetime.fromisoformat(it["time"])).total_seconds() / 60
        w = (s["relevance"] / 3) * math.pow(0.5, max(age, 0) / half_life_min)
        num += w * s[field]
        den += w
        top.append((abs(w * s[field]), it["title"], s[field], it["source"], round(age)))
    score = (num / den / 2) if den > 0 else 0.0
    top.sort(reverse=True)
    return max(-1.0, min(1.0, score)), [{"title": t, "score": v, "source": src, "age_min": a} for _, t, v, src, a in top[:3]]
