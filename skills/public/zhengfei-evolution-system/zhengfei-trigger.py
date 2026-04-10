# -*- coding: utf-8 -*-
"""
正飞技能进化系统 - 进化触发引擎 V4.0
集成增强记忆核心系统、智能上下文组装
正飞信息技术出品
"""

import sys
import io
import os
import json
import importlib.util
from datetime import datetime
from typing import Optional, Dict, Any, List

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()

MEMORY_MODULES_AVAILABLE = False
EnhancedMemoryManager = None
ContextAssembler = None
ContextConfig = None
extract_turn_memory_changes = None
GuardLevel = None
ExtractedMemoryChange = None
judge_memory_candidate = None
MemoryJudgeInput = None
MemoryCategory = None
MemoryImportance = None

def _load_memory_modules():
    global MEMORY_MODULES_AVAILABLE, EnhancedMemoryManager, ContextAssembler, ContextConfig
    global extract_turn_memory_changes, GuardLevel, ExtractedMemoryChange
    global judge_memory_candidate, MemoryJudgeInput, MemoryCategory, MemoryImportance
    
    try:
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
            "zhengfei_memory_context",
            os.path.join(SCRIPT_DIR, "zhengfei-memory-context.py")
        )
        context_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(context_module)
        ContextAssembler = context_module.ContextAssembler
        ContextConfig = context_module.ContextConfig
        
        spec = importlib.util.spec_from_file_location(
            "zhengfei_memory_extractor",
            os.path.join(SCRIPT_DIR, "zhengfei-memory-extractor.py")
        )
        extractor_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(extractor_module)
        extract_turn_memory_changes = extractor_module.extract_turn_memory_changes
        GuardLevel = extractor_module.GuardLevel
        ExtractedMemoryChange = extractor_module.ExtractedMemoryChange
        
        spec = importlib.util.spec_from_file_location(
            "zhengfei_memory_judge",
            os.path.join(SCRIPT_DIR, "zhengfei-memory-judge.py")
        )
        judge_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(judge_module)
        judge_memory_candidate = judge_module.judge_memory_candidate
        MemoryJudgeInput = judge_module.MemoryJudgeInput
        
        MEMORY_MODULES_AVAILABLE = True
    except Exception as e:
        print(f"[警告] 记忆模块导入失败: {e}")
        MEMORY_MODULES_AVAILABLE = False

_load_memory_modules()


def trigger_evolution(
    skill_name: str,
    execution_result: str,
    conversation_context: Optional[Dict[str, str]] = None,
    guard_level: str = "standard",
    enable_memory_extraction: bool = True,
    memory_md_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    触发进化流程：任务完成后自动记录素材、提取记忆、更新画像
    
    :param skill_name: 使用的技能名称
    :param execution_result: 执行结果（成功/失败/部分成功）
    :param conversation_context: 对话上下文 {"user": "...", "assistant": "..."}
    :param guard_level: 守卫级别 (strict/standard/relaxed)
    :param enable_memory_extraction: 是否启用记忆提取
    :param memory_md_path: MEMORY.md 路径，用于同步到 OpenClaw/微信插件
    :return: 进化结果摘要
    """
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    date_str = datetime.now().strftime("%Y-%m-%d")

    print("\n" + "=" * 60)
    print("     正飞技能进化系统 V4.0 | 进化触发")
    print("=" * 60)
    print(f"\n⏰ 时间: {current_time}")
    print(f"🔧 技能: {skill_name}")
    print(f"✅ 结果: {execution_result}")

    result = {
        "skill_name": skill_name,
        "execution_result": execution_result,
        "timestamp": current_time,
        "materials_recorded": False,
        "memories_extracted": 0,
        "profile_updated": False,
        "statistics": {}
    }

    materials_file = f"zhengfei-materials/{date_str}.md"
    materials_dir = os.path.dirname(materials_file)
    if not os.path.exists(materials_dir):
        os.makedirs(materials_dir, exist_ok=True)

    if not os.path.exists(materials_file):
        with open(materials_file, "w", encoding="utf-8") as f:
            f.write(f"# 正飞素材记录 - {date_str}\n\n")

    with open(materials_file, "a", encoding="utf-8") as f:
        f.write(f"## 任务记录 - {current_time}\n")
        f.write(f"- **技能**: {skill_name}\n")
        f.write(f"- **结果**: {execution_result}\n")
        f.write(f"- **状态**: 待整理\n\n")

    print(f"\n📁 素材已记录: {materials_file}")
    result["materials_recorded"] = True

    if enable_memory_extraction and MEMORY_MODULES_AVAILABLE and conversation_context:
        print("\n🧠 记忆提取中...")
        extracted_count = _extract_and_store_memories(
            conversation_context,
            guard_level
        )
        result["memories_extracted"] = extracted_count
        
        if extracted_count > 0:
            _update_dynamic_profile(skill_name, execution_result)
            result["profile_updated"] = True
            
            if memory_md_path:
                synced = _sync_to_memory_md(memory_md_path)
                if synced > 0:
                    print(f"  📤 已同步 {synced} 条记忆到 MEMORY.md")
                    result["memory_md_synced"] = synced

    print("\n📋 进化机会分析：")
    print("  □ 有可复用的模板吗？")
    print("  □ 有可推广的解决方案吗？")
    print("  □ 有可优化的流程吗？")
    print("  □ 有可沉淀的经验吗？")

    print("\n💡 能力卡片建议：")
    print("  如果发现可复用的能力，请按以下模板创建能力卡片：")
    print("\n  模板位置: zhengfei-capabilities/CAP-{ID}-{名称}.md")
    print("  模板内容:")
    print("    ## 触发条件")
    print("    ## 核心价值")
    print("    ## 实施方案")
    print("    ## 适用范围")
    print("    ## 风险边界")

    evolution_log = f"zhengfei-logs/evolution-{date_str}.log"
    logs_dir = os.path.dirname(evolution_log)
    if not os.path.exists(logs_dir):
        os.makedirs(logs_dir, exist_ok=True)
    
    with open(evolution_log, "a", encoding="utf-8") as f:
        f.write(f"[{current_time}] 触发进化 - {skill_name} - {execution_result}\n")
        if result["memories_extracted"] > 0:
            f.write(f"[{current_time}] 记忆提取 - {result['memories_extracted']} 条\n")

    print(f"\n📝 进化日志已更新: {evolution_log}")

    materials_count = count_materials(date_str)
    capabilities_count = count_capabilities()
    
    if MEMORY_MODULES_AVAILABLE:
        try:
            manager = EnhancedMemoryManager()
            stats = manager.get_statistics()
            result["statistics"] = stats
            print("\n📊 系统统计：")
            print(f"  今日素材: {materials_count} 条")
            print(f"  能力总量: {capabilities_count} 项")
            print(f"  记忆总量: {stats['total_memories']} 条")
            print(f"  记忆关联: {stats['total_relations']} 条")
            print(f"  分类分布: {stats.get('by_category', {})}")
            print(f"  重要性分布: {stats.get('by_importance', {})}")
            print(f"  已解决矛盾: {stats.get('total_contradictions_resolved', 0)} 次")
        except Exception as e:
            print(f"\n📊 统计获取失败: {e}")
            print(f"  今日素材: {materials_count} 条")
            print(f"  能力总量: {capabilities_count} 项")
    else:
        print("\n📊 当前统计：")
        print(f"  今日素材: {materials_count} 条")
        print(f"  能力总量: {capabilities_count} 项")

    print("\n" + "=" * 60)
    print("  ✅ 进化触发完成！")
    print("=" * 60)
    print("     正飞出品 | 持续进化 | 专业服务")
    print("=" * 60 + "\n")

    return result


def _extract_and_store_memories(
    conversation_context: Dict[str, str],
    guard_level: str
) -> int:
    """提取并存储记忆"""
    user_text = conversation_context.get("user", "")
    assistant_text = conversation_context.get("assistant", "")
    
    if not user_text or not assistant_text:
        return 0
    
    try:
        level = GuardLevel(guard_level)
    except ValueError:
        level = GuardLevel.STANDARD
    
    changes = extract_turn_memory_changes(
        user_text=user_text,
        assistant_text=assistant_text,
        guard_level=level
    )
    
    if not changes:
        print("  未发现可提取的记忆候选")
        return 0
    
    try:
        manager = EnhancedMemoryManager()
    except Exception as e:
        print(f"  记忆管理器初始化失败: {e}")
        return 0
    
    stored_count = 0
    for change in changes:
        judge_input = MemoryJudgeInput(
            text=change.text,
            is_explicit=change.is_explicit,
            guard_level=level,
            llm_enabled=False
        )
        
        judge_result = judge_memory_candidate(judge_input)
        
        if judge_result.accepted:
            if change.action == 'add':
                memory = manager.add_memory(
                    text=change.text,
                    confidence=change.confidence,
                    source=change.reason,
                    extraction_method="explicit" if change.is_explicit else "implicit",
                    is_explicit=change.is_explicit
                )
                print(f"  💾 记忆已保存: {change.text[:40]}... [{memory.category.value}]")
                stored_count += 1
            elif change.action == 'delete':
                deleted = manager.delete_memory_by_text(change.text)
                if deleted > 0:
                    print(f"  🗑️ 记忆已删除: {change.text[:40]}...")
                    stored_count += 1
        else:
            print(f"  ⏭️ 记忆被过滤: {change.text[:40]}... (分数: {judge_result.score:.2f})")
    
    return stored_count


def _update_dynamic_profile(skill_name: str, execution_result: str) -> None:
    """更新动态画像"""
    try:
        manager = EnhancedMemoryManager()
        activity = f"执行了 {skill_name} 任务，结果: {execution_result}"
        manager.add_memory(
            text=activity,
            confidence=1.0,
            source="activity",
            extraction_method="auto",
            ttl_days=7
        )
        print(f"  📋 动态画像已更新")
    except Exception as e:
        print(f"  动态画像更新失败: {e}")


def _sync_to_memory_md(memory_md_path: str) -> int:
    """同步记忆到 MEMORY.md"""
    try:
        manager = EnhancedMemoryManager()
        return manager.sync_to_memory_md(memory_md_path)
    except Exception as e:
        print(f"  MEMORY.md 同步失败: {e}")
        return 0


def count_materials(date_str: str) -> int:
    """统计今日素材数量"""
    materials_file = f"zhengfei-materials/{date_str}.md"
    if not os.path.exists(materials_file):
        return 0

    with open(materials_file, "r", encoding="utf-8") as f:
        content = f.read()
        return content.count("## 任务记录")


def count_capabilities() -> int:
    """统计能力总数"""
    capabilities_dir = "zhengfei-capabilities"
    if not os.path.exists(capabilities_dir):
        return 0

    count = 0
    for filename in os.listdir(capabilities_dir):
        if filename.startswith("CAP-") and filename.endswith(".md"):
            count += 1

    return count


def get_context_for_task(task_description: str, max_tokens: int = 2000) -> str:
    """为任务获取智能组装的上下文"""
    if not MEMORY_MODULES_AVAILABLE:
        return "记忆模块不可用"
    
    try:
        assembler = ContextAssembler()
        config = ContextConfig(max_total_tokens=max_tokens)
        context = assembler.assemble_context(task_description, config)
        return context.to_markdown()
    except Exception as e:
        return f"获取上下文失败: {e}"


def search_memories(
    query: str,
    top_k: int = 5,
    categories: Optional[List[str]] = None,
    min_importance: int = 2
) -> List[Dict[str, Any]]:
    """搜索记忆"""
    if not MEMORY_MODULES_AVAILABLE:
        return []
    
    try:
        manager = EnhancedMemoryManager()
        
        cat_filter = None
        if categories:
            cat_filter = [MemoryCategory(c) for c in categories]
        
        importance_filter = MemoryImportance(min_importance) if min_importance else None
        
        results = manager.search(
            query,
            top_k=top_k,
            categories=cat_filter,
            min_importance=importance_filter,
            include_relations=True
        )
        return results
    except Exception:
        return []


def get_memory_statistics() -> Dict[str, Any]:
    """获取记忆系统统计信息"""
    if not MEMORY_MODULES_AVAILABLE:
        return {"error": "记忆模块不可用"}
    
    try:
        manager = EnhancedMemoryManager()
        return manager.get_statistics()
    except Exception as e:
        return {"error": str(e)}


def export_memories(format: str = "json") -> str:
    """导出记忆"""
    if not MEMORY_MODULES_AVAILABLE:
        return '{"error": "记忆模块不可用"}'
    
    try:
        manager = EnhancedMemoryManager()
        return manager.export_memories(format)
    except Exception as e:
        return f'{{"error": "{e}"}}'


def import_memories(data: str, format: str = "json") -> int:
    """导入记忆"""
    if not MEMORY_MODULES_AVAILABLE:
        return 0
    
    try:
        manager = EnhancedMemoryManager()
        return manager.import_memories(data, format)
    except Exception:
        return 0


def show_usage():
    """显示使用说明"""
    print("\n" + "=" * 60)
    print("     正飞技能进化系统 V4.0 | 进化触发")
    print("=" * 60)
    print("\n使用方法:")
    print("  python zhengfei-trigger.py <技能名称> <执行结果> [选项]")
    print("\n参数:")
    print("  技能名称: 使用的技能名称")
    print("  执行结果: 成功/失败/部分成功")
    print("\n选项:")
    print("  --guard=strict|standard|relaxed  守卫级别 (默认: standard)")
    print("  --no-memory                      禁用记忆提取")
    print("\n示例:")
    print("  python zhengfei-trigger.py \"Python脚本生成\" \"成功\"")
    print("  python zhengfei-trigger.py \"代码审查\" \"成功\" --guard=strict")
    print("  python zhengfei-trigger.py \"文档创建\" \"成功\" --no-memory")
    print("\n环境变量:")
    print("  ZHENGFEI_USER_TEXT    用户对话内容 (用于记忆提取)")
    print("  ZHENGFEI_ASSISTANT_TEXT  助手对话内容 (用于记忆提取)")
    print("\nV4.0 新特性:")
    print("  - 增强记忆分类系统 (10种语义类别)")
    print("  - 记忆关联图谱 (8种关系类型)")
    print("  - 记忆重要性评估 (5级重要性)")
    print("  - 置信度衰减机制")
    print("  - 智能上下文组装")
    print("  - 记忆版本控制")
    print("  - 导入导出功能")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        show_usage()
        sys.exit(1)

    skill_name = sys.argv[1]
    execution_result = sys.argv[2]
    
    guard_level = "standard"
    enable_memory = True
    
    for arg in sys.argv[3:]:
        if arg.startswith("--guard="):
            guard_level = arg.split("=")[1]
        elif arg == "--no-memory":
            enable_memory = False
    
    conversation_context = None
    user_text = os.environ.get("ZHENGFEI_USER_TEXT", "")
    assistant_text = os.environ.get("ZHENGFEI_ASSISTANT_TEXT", "")
    
    if user_text and assistant_text:
        conversation_context = {
            "user": user_text,
            "assistant": assistant_text
        }
    
    trigger_evolution(
        skill_name=skill_name,
        execution_result=execution_result,
        conversation_context=conversation_context,
        guard_level=guard_level,
        enable_memory_extraction=enable_memory
    )
