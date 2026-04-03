import json, pathlib
p=pathlib.Path(r'D:\github\deerflaw\tmp_e2e_continue_c8d27cbb.txt')
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
print('error_event_count=', sum(1 for l in lines if l.strip()=='event: error'))
for l in lines[-30:]:
    if l.startswith('event: error') or l.startswith('data: {"error"'):
        print(l[:400])
seen=set()
for line in lines:
    if not line.startswith('data: '):
        continue
    try: obj=json.loads(line[6:])
    except: continue
    msgs=obj.get('messages',[]) if isinstance(obj,dict) else (obj if isinstance(obj,list) else [])
    for m in msgs:
        if isinstance(m,dict) and m.get('type')=='tool':
            mid=m.get('id') or (m.get('name'),m.get('tool_call_id'))
            if mid in seen: continue
            seen.add(mid)
            print('TOOL',m.get('name'),'->',str(m.get('content')).split('\n')[0][:220])
