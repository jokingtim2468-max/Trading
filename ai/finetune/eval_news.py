"""Compare Llama models on held-out days (ai/finetune/data/val.jsonl), through Ollama.

    python ai/finetune/eval_news.py --model llama3.2:3b --model drp-llama --limit 300

For headline examples it checks direction: does the model's Nasdaq/gold score have the same sign as
what the market really did that day (days the label calls flat are skipped)? It also averages the
scores per day, the way the AI service does, and checks those. For range examples it reports the
average miss of the predicted high and low, next to the fixed-line model that is in the prompt.
"""

import argparse
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from ai.llm import SCHEMA as NEWS_SCHEMA  # noqa: E402

RANGE_SCHEMA = {"type": "object", "properties": {"high": {"type": "number"}, "low": {"type": "number"}},
                "required": ["high", "low"]}
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def chat(url, model, messages, schema):
    body = {"model": model, "stream": False, "format": schema, "options": {"temperature": 0}, "messages": messages}
    req = urllib.request.Request(url + "/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(json.loads(_LOCAL.open(req, timeout=180).read())["message"]["content"])


def sign(x):
    return (x > 0) - (x < 0)


def num(v):
    try:
        return round(float(v))
    except (TypeError, ValueError):
        return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", action="append", required=True, help="Ollama model name (repeat to compare)")
    ap.add_argument("--url", default="http://127.0.0.1:11434")
    ap.add_argument("--limit", type=int, default=300, help="examples per kind")
    a = ap.parse_args()
    rows = [json.loads(line) for line in (HERE / "data/val.jsonl").open(encoding="utf-8")]
    news = [r for r in rows if r["kind"] == "news"][: a.limit]
    rng = [r for r in rows if r["kind"] == "range"][: a.limit]
    for model in a.model:
        hit = n = errors = 0
        per_day = defaultdict(lambda: {"nq": [], "gc": [], "truth": None})
        for r in news:
            truth = json.loads(r["messages"][2]["content"])
            try:
                out = chat(a.url, model, r["messages"][:2], NEWS_SCHEMA)
            except Exception as e:
                errors += 1
                if errors == 1:
                    print(f"  {model}: request failed ({e}). Is Ollama running and the model pulled?")
                continue
            for k in ("nasdaq", "gold"):
                if truth[k] != 0 and truth["relevance"] > 0:
                    n += 1
                    hit += sign(num(out.get(k))) == sign(truth[k])
            day = per_day[r["day"]]
            day["nq"].append(num(out.get("nasdaq")) * max(num(out.get("relevance")), 0))
            day["gc"].append(num(out.get("gold")) * max(num(out.get("relevance")), 0))
            day["truth"] = truth
        dh = dn = 0
        for day in per_day.values():
            for k, key in (("nq", "nasdaq"), ("gc", "gold")):
                t = day["truth"][key]
                s = sum(day[k])
                if t != 0 and s != 0:
                    dn += 1
                    dh += sign(s) == sign(t)
        miss, base = [], []
        for r in rng:
            truth = json.loads(r["messages"][2]["content"])
            m = re.search(r"Fixed-line model: high ([\d,.]+), low ([\d,.]+)", r["messages"][1]["content"])
            try:
                out = chat(a.url, model, r["messages"][:2], RANGE_SCHEMA)
                miss.append((abs(float(out["high"]) - truth["high"]) + abs(float(out["low"]) - truth["low"])) / 2)
                if m:
                    fh, fl = (float(x.replace(",", "")) for x in m.groups())
                    base.append((abs(fh - truth["high"]) + abs(fl - truth["low"])) / 2)
            except Exception:
                errors += 1
                continue
        print(f"\n{model}" + (f"  ({errors} failed requests)" if errors else ""))
        print(f"  headline direction: {hit}/{n} = {100 * hit / max(n, 1):.1f}%   (50% = coin flip)")
        print(f"  day-level direction (summed headlines): {dh}/{dn} = {100 * dh / max(dn, 1):.1f}%")
        if miss:
            print(f"  range: avg miss {sum(miss) / len(miss):,.2f}  vs fixed-line model in the prompt "
                  f"{sum(base) / max(len(base), 1):,.2f}  ({len(miss)} days)")


if __name__ == "__main__":
    main()
