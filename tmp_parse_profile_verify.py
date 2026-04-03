import json, pathlib
p = pathlib.Path(r'D:\github\deerflaw\tmp_profile_verify_run.txt')
for line in p.read_text(encoding='utf-8', errors='replace').splitlines():
    if not line.startswith('data: '):
        continue
    s=line[6:]
    try:
        obj=json.loads(s)
    except Exception:
        continue
    msgs=obj.get('messages',[]) if isinstance(obj,dict) else (obj if isinstance(obj,list) else [])
    for m in msgs:
        if not isinstance(m,dict):
            continue
        if m.get('type')=='ai':
            for tc in (m.get('tool_calls') or []):
                if tc.get('name')=='supervisor':
                    args=tc.get('args') or {}
                    if args.get('action') in ('create_subtask','assign_subtask'):
                        print('TOOL_CALL',args.get('action'),json.dumps(args,ensure_ascii=False)[:500])
        if m.get('type')=='tool' and m.get('name')=='supervisor':
            print('TOOL_RESULT',str(m.get('content'))[:220])
