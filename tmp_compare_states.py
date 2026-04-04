import json
from collections import Counter


def load(path: str):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def extract(state):
    msgs = (state.get("values") or {}).get("messages") or []
    out = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        mid = m.get("id")
        typ = m.get("type")
        content = m.get("content")
        if isinstance(content, list):
            t = ""
            for p in content:
                if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
                    t += p["text"]
        else:
            t = content if isinstance(content, str) else ""
        out.append((typ, mid, (t or "").strip()))
    return out


def summarize(label: str, state):
    rows = extract(state)
    ids = [r[1] for r in rows if r[1]]
    dup_ids = sum(1 for v in Counter(ids).values() if v > 1)
    ai_texts = [r[2] for r in rows if r[0] == "ai"]
    return {"label": label, "messages": len(rows), "dup_ids": dup_ids, "ai_texts": ai_texts}


def main():
    s1 = load("tmp_repro_state_after_1.json")
    s2 = load("tmp_repro_state_after_2.json")
    a = summarize("state1", s1)
    b = summarize("state2", s2)
    out = {"a": a, "b": b, "ai_text_equal": a["ai_texts"] == b["ai_texts"]}
    with open("tmp_compare_states_report.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    # ASCII safe summary
    print("wrote tmp_compare_states_report.json")
    print("a_messages", a["messages"], "a_dup_ids", a["dup_ids"], "a_ai_count", len(a["ai_texts"]))
    print("b_messages", b["messages"], "b_dup_ids", b["dup_ids"], "b_ai_count", len(b["ai_texts"]))
    print("ai_text_equal", out["ai_text_equal"])


if __name__ == "__main__":
    main()

