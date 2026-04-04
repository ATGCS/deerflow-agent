import json

PATH = r"D:/github/deerflaw/tmp_runs_stream_curl_out.txt"


def text_from_msg(m):
    if not isinstance(m, dict):
        return ""
    c = m.get("content")
    if isinstance(c, str):
        return c[:400]
    if isinstance(c, list):
        return "".join(
            x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text"
        )[:400]
    return ""


def last_ai_text(messages):
    for m in reversed(messages or []):
        if not isinstance(m, dict):
            continue
        t = m.get("type")
        if t in ("ai", "AIMessage", "AIMessageChunk"):
            return text_from_msg(m), t
    return "", None


def main():
    raw = open(PATH, encoding="utf-8", errors="replace").read()
    frames = raw.replace("\r\n", "\n").split("\n\n")
    idx = 0
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
        idx += 1
        try:
            d = json.loads(data)
        except json.JSONDecodeError:
            print(idx, ev, "BAD JSON")
            continue
        if ev == "values":
            msgs = (d.get("values") or {}).get("messages") or []
            preview, lt = last_ai_text(msgs)
            print(f"{idx} VALUES n_msgs={len(msgs)} last_ai_type={lt!r} last_ai_preview={preview!r}")
        elif ev == "messages":
            if isinstance(d, list) and d and isinstance(d[0], dict):
                m = d[0]
                t = text_from_msg(m)
                tc = m.get("tool_calls") or m.get("toolCalls")
                ntc = len(tc) if isinstance(tc, list) else 0
                print(f"{idx} MESSAGES type={m.get('type')!r} chunk={t!r} tool_calls={ntc}")
            else:
                print(f"{idx} MESSAGES shape={type(d).__name__}")


if __name__ == "__main__":
    main()
