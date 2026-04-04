#!/usr/bin/env python3
"""Analyze LangGraph SSE file: event order, values full-text vs message chunks (duplicate risk)."""
import json
import sys
from collections import Counter

PATH = sys.argv[1] if len(sys.argv) > 1 else r"D:/github/deerflaw/tmp_runs_stream_tools.txt"


def text_from_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text"
        )
    return ""


def summarize_values(d):
    raw = d["values"] if isinstance(d, dict) and "values" in d else d
    if not isinstance(raw, dict):
        return {"kind": "bad", "n": 0}
    msgs = raw.get("messages") or []
    if not msgs:
        return {"kind": "values", "n_msgs": 0}
    last = msgs[-1]
    last_type = last.get("type") if isinstance(last, dict) else None
    txt = text_from_content(last.get("content")) if isinstance(last, dict) else ""
    tc = last.get("tool_calls") or last.get("toolCalls") if isinstance(last, dict) else None
    n_tc = len(tc) if isinstance(tc, list) else 0
    # last assistant text length (scan from end)
    last_ai_txt = ""
    for m in reversed(msgs):
        if not isinstance(m, dict):
            continue
        if m.get("type") in ("ai", "AIMessage", "AIMessageChunk"):
            last_ai_txt = text_from_content(m.get("content"))
            break
    return {
        "kind": "values",
        "n_msgs": len(msgs),
        "last_type": last_type,
        "last_len": len(txt),
        "last_ai_len": len(last_ai_txt),
        "last_tool_calls": n_tc,
        "last_preview": (txt or last_ai_txt)[:100].replace("\n", " "),
    }


def summarize_messages(d):
    if isinstance(d, list) and d and isinstance(d[0], dict):
        m = d[0]
        t = text_from_content(m.get("content"))
        tc = m.get("tool_calls") or m.get("toolCalls")
        n_tc = len(tc) if isinstance(tc, list) else 0
        return {
            "kind": "messages",
            "m_type": m.get("type"),
            "chunk_len": len(t),
            "chunk_preview": t[:80].replace("\n", " "),
            "tool_calls": n_tc,
        }
    return {"kind": "messages", "raw": str(type(d))}


def main():
    raw = open(PATH, encoding="utf-8", errors="replace").read()
    frames = raw.replace("\r\n", "\n").split("\n\n")
    rows = []
    ev_counts = Counter()
    for fr in frames:
        fr = fr.strip()
        if not fr:
            continue
        ev = ""
        data = ""
        for ln in fr.split("\n"):
            if ln.startswith("event:"):
                ev = ln[6:].strip()
            elif ln.startswith("data:"):
                data += ln[5:].strip()
        if not data:
            continue
        try:
            d = json.loads(data)
        except json.JSONDecodeError:
            ev_counts[ev or "parse_err"] += 1
            continue
        ev_counts[ev or "(none)"] += 1
        if ev == "values":
            rows.append(summarize_values(d))
        elif ev in ("messages", "messages-tuple"):
            rows.append(summarize_messages(d))
        else:
            rows.append({"kind": ev})

    out_path = PATH.replace(".txt", "_analysis.json")
    report = {"path": PATH, "event_counts": dict(ev_counts), "steps": rows[:200]}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("Wrote", out_path)
    print("event_counts:", dict(ev_counts))
    print("--- first 30 steps ---")
    for i, r in enumerate(rows[:30]):
        print(i + 1, r)


if __name__ == "__main__":
    main()
