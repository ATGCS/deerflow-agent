#!/usr/bin/env python3
"""Probe LangGraph runs/stream SSE: event types, ordering, text/tool patterns."""
import json
import re
import ssl
import sys
import urllib.error
import urllib.request

THREAD_ID = "7f0fe712-3094-44fb-89c4-4ab962e981b2"
BASE = "http://localhost:1420/api/langgraph"

# Minimal user message (avoid long model runs)
USER_TEXT = "请只回复一行：STREAMTEST-PROBE-OK"

BODY = {
    "assistant_id": "lead_agent",
    "input": {
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": USER_TEXT}],
            }
        ]
    },
    "stream_mode": ["values", "messages-tuple"],
    "streamSubgraphs": True,
    "streamResumable": True,
    "config": {"recursion_limit": 1000},
    "context": {
        "thinking_enabled": True,
        "is_plan_mode": False,
        "subagent_enabled": False,
        "thread_id": THREAD_ID,
    },
}


def extract_text_preview(obj, max_len=120):
    """Rough preview of assistant text from LangGraph message objects."""
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj[:max_len].replace("\n", "\\n")
    if isinstance(obj, dict):
        c = obj.get("content")
        if isinstance(c, str):
            return c[:max_len].replace("\n", "\\n")
        if isinstance(c, list):
            parts = []
            for b in c:
                if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str):
                    parts.append(b["text"])
            t = "".join(parts)
            return t[:max_len].replace("\n", "\\n")
    return str(obj)[:max_len]


def summarize_data(event_name, data_raw):
    out = {"event": event_name, "raw_len": len(data_raw)}
    try:
        data = json.loads(data_raw)
    except json.JSONDecodeError:
        out["parse_error"] = True
        return out
    if event_name == "values":
        vals = data.get("values") if isinstance(data, dict) else None
        msgs = (vals or {}).get("messages") if isinstance(vals, dict) else None
        if isinstance(msgs, list) and msgs:
            last = msgs[-1]
            out["last_type"] = last.get("type") if isinstance(last, dict) else None
            out["last_text_preview"] = extract_text_preview(last)
            out["msg_count"] = len(msgs)
    elif event_name in ("messages", "messages-tuple"):
        # tuple / object shapes vary
        out["data_keys"] = list(data.keys())[:12] if isinstance(data, dict) else "non-dict"
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                out["first_type"] = first.get("type")
                out["first_text_preview"] = extract_text_preview(first)
    return out


def main():
    url = f"{BASE}/threads/{THREAD_ID}/runs/stream"
    raw_out = "tmp_runs_stream_raw_sample.txt"
    summary_out = "tmp_runs_stream_summary.json"

    req = urllib.request.Request(
        url,
        data=json.dumps(BODY, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )

    frames = []
    raw_chunks = []
    max_bytes = 800_000
    read_bytes = 0

    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
            ct = resp.headers.get("Content-Type", "")
            print("status", resp.status, "content-type", ct)
            while read_bytes < max_bytes:
                chunk = resp.read(8192)
                if not chunk:
                    break
                read_bytes += len(chunk)
                raw_chunks.append(chunk)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print("HTTPError", e.code, body[:2000])
        sys.exit(1)
    except Exception as e:
        print("Error", type(e).__name__, e)
        sys.exit(1)

    blob = b"".join(raw_chunks).decode("utf-8", errors="replace")
    with open(raw_out, "w", encoding="utf-8") as f:
        f.write(blob[:500_000])

    # Split SSE frames by double newline
    normalized = blob.replace("\r\n", "\n")
    parts = normalized.split("\n\n")
    for frame in parts:
        frame = frame.strip()
        if not frame:
            continue
        event_name = ""
        data_lines = []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                event_name = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        data_raw = "".join(data_lines)
        if not data_raw:
            continue
        summ = summarize_data(event_name or "(no event)", data_raw)
        summ["frame_idx"] = len(frames)
        frames.append(summ)

    # Detect alternating values vs messages patterns
    event_counts = {}
    for f in frames:
        ev = f.get("event", "")
        event_counts[ev] = event_counts.get(ev, 0) + 1

    report = {
        "url": url,
        "thread_id": THREAD_ID,
        "user_message": USER_TEXT,
        "total_bytes_read": read_bytes,
        "frame_count": len(frames),
        "event_counts": event_counts,
        "first_40_frames": frames[:40],
    }
    with open(summary_out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("Wrote", raw_out, "and", summary_out)
    print("event_counts:", event_counts)
    print("first 15 event types:", [f.get("event") for f in frames[:15]])


if __name__ == "__main__":
    main()
