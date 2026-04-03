import json, pathlib
p = pathlib.Path(r'D:\github\deerflaw\tmp_e2e_run_c8d27cbb.txt')
for line in p.read_text(encoding='utf-8', errors='replace').splitlines():
    if not line.startswith('data: '):
        continue
    s = line[6:]
    try:
        obj = json.loads(s)
    except Exception:
        continue
    msgs = obj.get('messages', []) if isinstance(obj, dict) else (obj if isinstance(obj, list) else [])
    for m in msgs:
        if not isinstance(m, dict):
            continue
        t = m.get('type')
        if t == 'tool':
            print('TOOL', m.get('name'), '->', str(m.get('content'))[:260])
        elif t == 'ai':
            c = str(m.get('content', '')).strip()
            if c:
                print('AI', c[:260].replace('\n', ' '))
