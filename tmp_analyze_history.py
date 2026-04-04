import json
import hashlib
from collections import Counter, defaultdict


def norm_text(s: str) -> str:
    s = (s or "").strip()
    # light normalization similar to UI dedupe
    s = " ".join(s.split())
    return s


def to_text(content):
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if isinstance(part, str):
                out.append(part)
            elif isinstance(part, dict):
                if part.get("type") == "text" and isinstance(part.get("text"), str):
                    out.append(part["text"])
                elif "text" in part and isinstance(part["text"], str):
                    out.append(part["text"])
        return "\n".join([x for x in out if x is not None])
    if isinstance(content, dict):
        if content.get("type") == "text" and isinstance(content.get("text"), str):
            return content["text"]
    return ""


def load_history(path: str):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def main():
    hist = load_history("tmp_thread_history.json")
    # history format: list of {values:{messages:[...]}, ...}
    messages = []
    for item in hist:
        vals = item.get("values") or {}
        messages.extend(vals.get("messages") or [])

    # basic counts by type
    types = Counter(m.get("type") for m in messages)

    # duplicates by message id
    ids = [m.get("id") for m in messages if m.get("id")]
    id_dups = [k for k, v in Counter(ids).items() if v > 1]

    # analyze ai-only content duplicates (exact)
    ai_msgs = [m for m in messages if m.get("type") == "ai"]
    ai_texts = []
    for m in ai_msgs:
        t = norm_text(to_text(m.get("content")))
        if t:
            ai_texts.append(t)
    ai_text_dups = [(k, v) for k, v in Counter(ai_texts).items() if v > 1]
    ai_text_dups.sort(key=lambda x: (-x[1], -len(x[0])))

    # tool duplicates by tool_call_id
    tool_msgs = [m for m in messages if m.get("type") == "tool"]
    tcids = [m.get("tool_call_id") for m in tool_msgs if m.get("tool_call_id")]
    tcid_dups = [k for k, v in Counter(tcids).items() if v > 1]

    # fingerprint "similar" (first 80 normalized chars)
    fp_map = defaultdict(list)
    for idx, t in enumerate(ai_texts):
        fp = t[:80]
        fp_map[fp].append(idx)
    similar = sorted([(fp, len(idxs)) for fp, idxs in fp_map.items() if len(idxs) > 1], key=lambda x: -x[1])

    report = {
        "total_messages": len(messages),
        "type_counts": dict(types),
        "dup_message_ids_count": len(id_dups),
        "dup_message_ids_sample": id_dups[:20],
        "dup_tool_call_id_count": len(tcid_dups),
        "dup_tool_call_id_sample": tcid_dups[:20],
        "dup_exact_ai_texts_count": len(ai_text_dups),
        "dup_exact_ai_texts_top": [
            {"count": cnt, "text_preview": text[:200]} for text, cnt in ai_text_dups[:20]
        ],
        "dup_similar_fp80_count": len(similar),
        "dup_similar_fp80_top": [{"count": cnt, "fp80": fp} for fp, cnt in similar[:50]],
    }

    out_path = "tmp_history_dup_report.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # Print only ASCII-safe summary for console.
    print("Wrote", out_path)
    print("TOTAL messages:", report["total_messages"])
    print("DUP message ids:", report["dup_message_ids_count"])
    print("DUP tool_call_id:", report["dup_tool_call_id_count"])
    print("DUP exact ai texts:", report["dup_exact_ai_texts_count"])
    print("SIMILAR fp80 dup ai:", report["dup_similar_fp80_count"])

    # Also analyze state endpoint snapshot
    try:
        with open("tmp_thread_state.json", "r", encoding="utf-8-sig") as f:
            state = json.load(f)
        vals = state.get("values") or {}
        smsg = vals.get("messages") or []
        if not isinstance(smsg, list):
            smsg = []
        s_ids = [m.get("id") for m in smsg if isinstance(m, dict) and m.get("id")]
        s_tool = [m.get("tool_call_id") for m in smsg if isinstance(m, dict) and m.get("type") == "tool" and m.get("tool_call_id")]
        s_ai = []
        for m in smsg:
            if not isinstance(m, dict) or m.get("type") != "ai":
                continue
            t = norm_text(to_text(m.get("content")))
            if t:
                s_ai.append(t)
        s_ai_dups = [(k, v) for k, v in Counter(s_ai).items() if v > 1]
        s_ai_dups.sort(key=lambda x: -x[1])
        s_report = {
            "total_messages": len(smsg),
            "dup_message_ids_count": sum(1 for v in Counter(s_ids).values() if v > 1),
            "dup_tool_call_id_count": sum(1 for v in Counter(s_tool).values() if v > 1),
            "dup_exact_ai_texts_count": sum(1 for v in Counter(s_ai).values() if v > 1),
            "dup_exact_ai_texts_top": [{"count": v, "text_preview": k[:200]} for k, v in s_ai_dups[:20]],
        }
        with open("tmp_state_dup_report.json", "w", encoding="utf-8") as f:
            json.dump(s_report, f, ensure_ascii=False, indent=2)
        print("STATE messages:", s_report["total_messages"])
        print("STATE dup ids:", s_report["dup_message_ids_count"])
        print("STATE dup tool_call_id:", s_report["dup_tool_call_id_count"])
        print("STATE dup exact ai texts:", s_report["dup_exact_ai_texts_count"])
    except Exception as e:
        print("STATE analyze failed:", type(e).__name__)


if __name__ == "__main__":
    main()

