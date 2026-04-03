import json, pathlib
p=pathlib.Path(r'D:\github\deerflaw\tmp_complete_one_response.txt')
seen=set()
for line in p.read_text(encoding='utf-8',errors='replace').splitlines():
    if not line.startswith('data: '):
        continue
    try: obj=json.loads(line[6:])
    except: continue
    msgs=obj.get('messages',[]) if isinstance(obj,dict) else (obj if isinstance(obj,list) else [])
    for m in msgs:
        if isinstance(m,dict) and m.get('type')=='tool':
            key=m.get('id') or (m.get('name'),m.get('tool_call_id'))
            if key in seen: continue
            seen.add(key)
            print(m.get('name'),'->',str(m.get('content')).split('\n')[0][:200])
