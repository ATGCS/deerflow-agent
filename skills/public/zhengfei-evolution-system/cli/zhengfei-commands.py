# -*- coding: utf-8 -*-
"""
正飞记忆快捷命令 - 快速访问记忆功能
正飞信息技术出品
"""

import sys
import io
import os
import json
from datetime import datetime
from typing import Dict, Any, List, Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()

MEMORY_MODULES_AVAILABLE = False
EnhancedMemoryManager = None
MemoryCategory = None
MemoryImportance = None
MemorySearch = None


def _load_memory_modules():
    global MEMORY_MODULES_AVAILABLE, EnhancedMemoryManager, MemoryCategory, MemoryImportance, MemorySearch

    try:
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "zhengfei_memory_core",
            os.path.join(SCRIPT_DIR, "zhengfei-memory-core.py")
        )
        core_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(core_module)
        EnhancedMemoryManager = core_module.EnhancedMemoryManager
        MemoryCategory = core_module.MemoryCategory
        MemoryImportance = core_module.MemoryImportance

        spec = importlib.util.spec_from_file_location(
            "zhengfei_memory_search",
            os.path.join(SCRIPT_DIR, "zhengfei-memory-search.py")
        )
        search_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(search_module)
        MemorySearch = search_module.MemorySearch

        MEMORY_MODULES_AVAILABLE = True
    except Exception as e:
        print(f"[警告] 记忆模块导入失败: {e}")
        MEMORY_MODULES_AVAILABLE = False


_load_memory_modules()


def cmd_search(query: str, top_k: int = 10, category: Optional[str] = None) -> Dict[str, Any]:
    """
    搜索记忆

    用法: 记忆搜索 <关键词>
    示例: 记忆搜索 TypeScript
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()

        cat_filter = None
        if category:
            try:
                cat_filter = [MemoryCategory(category)]
            except ValueError:
                pass

        results = manager.search(
            query,
            top_k=top_k,
            categories=cat_filter,
            include_relations=True
        )

        return {
            "success": True,
            "query": query,
            "count": len(results),
            "results": [
                {
                    "id": r.get("id"),
                    "text": r.get("text"),
                    "category": r.get("category"),
                    "importance": r.get("importance"),
                    "confidence": r.get("confidence"),
                    "created_at": r.get("created_at")
                }
                for r in results
            ]
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_stats() -> Dict[str, Any]:
    """
    查看记忆统计

    用法: 记忆统计
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()
        stats = manager.get_statistics()

        return {
            "success": True,
            "statistics": stats,
            "summary": {
                "总记忆数": stats.get("total_memories", 0),
                "关联数": stats.get("total_relations", 0),
                "已解决矛盾": stats.get("total_contradictions_resolved", 0),
                "分类分布": stats.get("by_category", {}),
                "重要性分布": stats.get("by_importance", {})
            }
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_recent(days: int = 7, top_k: int = 10) -> Dict[str, Any]:
    """
    查看最近记忆

    用法: 最近记忆 [天数]
    示例: 最近记忆 3
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        search = MemorySearch()
        results = search.get_recent_memories(days=days, top_k=top_k)

        return {
            "success": True,
            "days": days,
            "count": len(results),
            "results": [
                {
                    "text": r.text,
                    "source": r.source,
                    "created_at": r.created_at
                }
                for r in results
            ]
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_export(format: str = "json") -> Dict[str, Any]:
    """
    导出记忆

    用法: 导出记忆 [格式]
    示例: 导出记忆 json
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()
        data = manager.export_memories(format)

        return {
            "success": True,
            "format": format,
            "data": data
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_add(text: str, category: Optional[str] = None, importance: int = 3) -> Dict[str, Any]:
    """
    添加记忆

    用法: 添加记忆 <内容> [分类] [重要性]
    示例: 添加记忆 "我喜欢用TypeScript开发" preference 4
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()

        memory = manager.add_memory(
            text=text,
            confidence=0.9,
            source="manual",
            is_explicit=True
        )

        if category:
            try:
                memory.category = MemoryCategory(category)
            except ValueError:
                pass

        if importance:
            try:
                memory.importance = MemoryImportance(importance)
            except ValueError:
                pass

        return {
            "success": True,
            "memory": {
                "id": memory.id,
                "text": memory.text,
                "category": memory.category.value,
                "importance": memory.importance.value,
                "created_at": memory.created_at
            }
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_delete(memory_id: str) -> Dict[str, Any]:
    """
    删除记忆

    用法: 删除记忆 <记忆ID>
    示例: 删除记忆 MEM-12345678
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()
        success = manager.delete_memory(memory_id)

        return {
            "success": success,
            "memory_id": memory_id,
            "message": "记忆已删除" if success else "记忆未找到"
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_context(task: str, max_tokens: int = 2000) -> Dict[str, Any]:
    """
    获取任务上下文

    用法: 任务上下文 <任务描述>
    示例: 任务上下文 开发用户认证模块
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        from zhengfei_trigger import get_context_for_task
        context = get_context_for_task(task, max_tokens)

        return {
            "success": True,
            "task": task,
            "context": context
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_conflicts() -> Dict[str, Any]:
    """
    查看记忆冲突

    用法: 查看冲突
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()

        index_path = os.path.join(SCRIPT_DIR, "zhengfei-memory", "enhanced-index.json")
        with open(index_path, 'r', encoding='utf-8') as f:
            index_data = json.load(f)

        contradictions = index_data.get('contradictions_resolved', [])

        return {
            "success": True,
            "count": len(contradictions),
            "conflicts": [
                {
                    "old_text": c.get("old_text"),
                    "new_text": c.get("new_text"),
                    "resolved_at": c.get("resolved_at"),
                    "reason": c.get("reason")
                }
                for c in contradictions[-10:]
            ]
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_visualize() -> Dict[str, Any]:
    """
    生成记忆可视化

    用法: 记忆可视化
    """
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}

    try:
        manager = EnhancedMemoryManager()
        stats = manager.get_statistics()

        index_path = os.path.join(SCRIPT_DIR, "zhengfei-memory", "enhanced-index.json")
        with open(index_path, 'r', encoding='utf-8') as f:
            index_data = json.load(f)

        memories = index_data.get('memories', [])
        graph = index_data.get('relations', [])

        nodes = []
        for m in memories[:50]:
            nodes.append({
                "id": m.get("id"),
                "text": m.get("text", "")[:50],
                "category": m.get("category", "context"),
                "importance": m.get("importance", 3),
                "confidence": m.get("confidence", 0.5)
            })

        edges = []
        for r in graph[:50]:
            edges.append({
                "source": r.get("from_id"),
                "target": r.get("to_id"),
                "type": r.get("relation_type")
            })

        output_path = os.path.join(SCRIPT_DIR, "zhengfei-memory", "visualization.html")
        _generate_visualization_html(nodes, edges, output_path)

        return {
            "success": True,
            "output_path": output_path,
            "nodes_count": len(nodes),
            "edges_count": len(edges),
            "message": f"可视化已生成: {output_path}"
        }
    except Exception as e:
        return {"error": str(e)}


def _generate_visualization_html(nodes: List[Dict], edges: List[Dict], output_path: str):
    """生成可视化HTML文件"""

    category_colors = {
        "identity": "#4CAF50",
        "preference": "#2196F3",
        "behavior": "#FF9800",
        "knowledge": "#9C27B0",
        "relationship": "#E91E63",
        "goal": "#00BCD4",
        "skill": "#8BC34A",
        "project": "#607D8B",
        "temporal": "#795548",
        "context": "#9E9E9E"
    }

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>正飞记忆图谱可视化</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            min-height: 100vh;
        }}
        .header {{
            padding: 20px;
            background: #16213e;
            border-bottom: 1px solid #0f3460;
        }}
        .header h1 {{
            font-size: 24px;
            color: #e94560;
        }}
        .header p {{
            color: #888;
            margin-top: 5px;
        }}
        .stats {{
            display: flex;
            gap: 20px;
            margin-top: 15px;
        }}
        .stat {{
            background: #0f3460;
            padding: 10px 15px;
            border-radius: 8px;
        }}
        .stat-value {{
            font-size: 24px;
            font-weight: bold;
            color: #e94560;
        }}
        .stat-label {{
            font-size: 12px;
            color: #888;
        }}
        #graph {{
            width: 100%;
            height: calc(100vh - 150px);
        }}
        .node {{
            cursor: pointer;
        }}
        .node circle {{
            stroke-width: 2px;
        }}
        .node text {{
            font-size: 11px;
            fill: #ccc;
            pointer-events: none;
        }}
        .link {{
            stroke-opacity: 0.6;
        }}
        .tooltip {{
            position: absolute;
            background: #16213e;
            border: 1px solid #0f3460;
            padding: 10px;
            border-radius: 8px;
            font-size: 12px;
            max-width: 300px;
            pointer-events: none;
            z-index: 100;
        }}
        .legend {{
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: #16213e;
            padding: 15px;
            border-radius: 8px;
            font-size: 12px;
        }}
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 5px 0;
        }}
        .legend-color {{
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>🧠 正飞记忆图谱</h1>
        <p>记忆关联可视化展示</p>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">{len(nodes)}</div>
                <div class="stat-label">记忆节点</div>
            </div>
            <div class="stat">
                <div class="stat-value">{len(edges)}</div>
                <div class="stat-label">关联关系</div>
            </div>
        </div>
    </div>
    <div id="graph"></div>
    <div class="legend">
        <div class="legend-item"><div class="legend-color" style="background: #4CAF50"></div> 身份</div>
        <div class="legend-item"><div class="legend-color" style="background: #2196F3"></div> 偏好</div>
        <div class="legend-item"><div class="legend-color" style="background: #FF9800"></div> 行为</div>
        <div class="legend-item"><div class="legend-color" style="background: #9C27B0"></div> 知识</div>
        <div class="legend-item"><div class="legend-color" style="background: #E91E63"></div> 关系</div>
        <div class="legend-item"><div class="legend-color" style="background: #00BCD4"></div> 目标</div>
        <div class="legend-item"><div class="legend-color" style="background: #8BC34A"></div> 技能</div>
        <div class="legend-item"><div class="legend-color" style="background: #607D8B"></div> 项目</div>
    </div>
    <div class="tooltip" id="tooltip" style="display: none;"></div>
    <script>
        const nodes = {json.dumps(nodes)};
        const links = {json.dumps(edges)};
        const categoryColors = {json.dumps(category_colors)};

        const width = window.innerWidth;
        const height = window.innerHeight - 150;

        const svg = d3.select("#graph")
            .append("svg")
            .attr("width", width)
            .attr("height", height);

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(30));

        const link = svg.append("g")
            .selectAll("line")
            .data(links)
            .enter()
            .append("line")
            .attr("class", "link")
            .attr("stroke", "#444")
            .attr("stroke-width", 1);

        const node = svg.append("g")
            .selectAll("g")
            .data(nodes)
            .enter()
            .append("g")
            .attr("class", "node")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        node.append("circle")
            .attr("r", d => 8 + d.importance * 2)
            .attr("fill", d => categoryColors[d.category] || "#9E9E9E")
            .attr("stroke", d => categoryColors[d.category] || "#9E9E9E");

        node.append("text")
            .attr("dx", 15)
            .attr("dy", 4)
            .text(d => d.text.length > 20 ? d.text.substring(0, 20) + "..." : d.text);

        node.on("mouseover", function(event, d) {{
            const tooltip = document.getElementById("tooltip");
            tooltip.style.display = "block";
            tooltip.style.left = (event.pageX + 10) + "px";
            tooltip.style.top = (event.pageY + 10) + "px";
            tooltip.innerHTML = `
                <div><strong>分类:</strong> ${{d.category}}</div>
                <div><strong>重要性:</strong> ${{d.importance}}</div>
                <div><strong>置信度:</strong> ${{d.confidence.toFixed(2)}}</div>
                <div><strong>内容:</strong> ${{d.text}}</div>
            `;
        }});

        node.on("mouseout", function() {{
            document.getElementById("tooltip").style.display = "none";
        }});

        simulation.on("tick", () => {{
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node.attr("transform", d => `translate(${{d.x}}, ${{d.y}})`);
        }});

        function dragstarted(event) {{
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }}

        function dragged(event) {{
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }}

        function dragended(event) {{
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }}
    </script>
</body>
</html>'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)


def execute_command(command: str, args: List[str]) -> Dict[str, Any]:
    """执行快捷命令"""
    commands = {
        "搜索": lambda: cmd_search(args[0] if args else "", int(args[1]) if len(args) > 1 else 10),
        "search": lambda: cmd_search(args[0] if args else "", int(args[1]) if len(args) > 1 else 10),
        "统计": lambda: cmd_stats(),
        "stats": lambda: cmd_stats(),
        "最近": lambda: cmd_recent(int(args[0]) if args else 7),
        "recent": lambda: cmd_recent(int(args[0]) if args else 7),
        "导出": lambda: cmd_export(args[0] if args else "json"),
        "export": lambda: cmd_export(args[0] if args else "json"),
        "添加": lambda: cmd_add(args[0] if args else "", args[1] if len(args) > 1 else None, int(args[2]) if len(args) > 2 else 3),
        "add": lambda: cmd_add(args[0] if args else "", args[1] if len(args) > 1 else None, int(args[2]) if len(args) > 2 else 3),
        "删除": lambda: cmd_delete(args[0] if args else ""),
        "delete": lambda: cmd_delete(args[0] if args else ""),
        "上下文": lambda: cmd_context(args[0] if args else ""),
        "context": lambda: cmd_context(args[0] if args else ""),
        "冲突": lambda: cmd_conflicts(),
        "conflicts": lambda: cmd_conflicts(),
        "可视化": lambda: cmd_visualize(),
        "visualize": lambda: cmd_visualize(),
    }

    cmd_lower = command.lower()
    if cmd_lower in commands:
        return commands[cmd_lower]()

    return {"error": f"未知命令: {command}"}


def show_help():
    """显示帮助信息"""
    print("\n" + "=" * 60)
    print("     正飞记忆快捷命令 V1.0")
    print("=" * 60)
    print("\n可用命令:")
    print("  搜索 <关键词> [数量]     - 搜索记忆")
    print("  统计                    - 查看记忆统计")
    print("  最近 [天数]             - 查看最近记忆")
    print("  导出 [格式]             - 导出记忆 (json/markdown)")
    print("  添加 <内容> [分类] [重要性] - 添加记忆")
    print("  删除 <记忆ID>           - 删除记忆")
    print("  上下文 <任务描述>       - 获取任务上下文")
    print("  冲突                    - 查看记忆冲突")
    print("  可视化                  - 生成记忆图谱可视化")
    print("\n分类选项:")
    print("  identity, preference, behavior, knowledge")
    print("  relationship, goal, skill, project, temporal, context")
    print("\n重要性: 1-5 (1=琐碎, 5=关键)")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        show_help()
        sys.exit(0)

    command = sys.argv[1]
    args = sys.argv[2:]

    if command in ["help", "-h", "--help"]:
        show_help()
        sys.exit(0)

    result = execute_command(command, args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
