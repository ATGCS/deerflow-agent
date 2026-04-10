# 高效快速免费多层次深度搜索方案

## 🎯 设计目标

- **高效**: 并行搜索 + 智能缓存 + 结果去重
- **快速**: 异步并发 + 超时控制 + 渐进式加载
- **免费**: 零 API Key 依赖 + 开源工具
- **多层次**: 多引擎 + 多策略 + 多深度
- **深度**: 内容提取 + 链接追踪 + 相关推荐
- **精准**: 智能排序 + 质量评分 + 语义过滤

---

## 📐 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   用户查询                               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  第一层：查询优化层 (Query Optimization)                │
│  - 关键词扩展                                            │
│  - 同义词生成                                            │
│  - 意图识别                                              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  第二层：并行搜索层 (Parallel Search)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Baidu   │  │   Bing   │  │ DuckDuck │              │
│  │  (主)    │  │  (备)    │  │  (补)    │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                     │
│       └─────────────┴─────────────┘                     │
│                   │                                      │
│              结果聚合 + 去重                              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  第三层：质量评估层 (Quality Scoring)                   │
│  - 相关性评分 (TF-IDF + BM25)                           │
│  - 权威性评分 (域名权重)                                │
│  - 时效性评分 (发布时间)                                │
│  - 完整性评分 (内容长度)                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  第四层：深度提取层 (Deep Extraction)                   │
│  - 正文提取 (Readability)                               │
│  - 结构化数据 (JSON-LD)                                 │
│  - 相关链接 (内部链接)                                  │
│  - 多媒体资源 (图片/视频)                               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  第五层：智能排序层 (Intelligent Ranking)               │
│  - 多目标排序 (相关性 + 质量 + 时效)                    │
│  - 多样性控制 (来源分散)                                │
│  - 个性化权重 (用户偏好)                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  第六层：缓存层 (Caching)                               │
│  - 查询缓存 (相同查询直接返回)                          │
│  - 内容缓存 (已抓取页面 7 天有效)                        │
│  - 增量更新 (只更新过期内容)                            │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 核心实现策略

### 1️⃣ **查询优化层**

```python
class QueryOptimizer:
    """查询优化器 - 提升搜索精准度"""
    
    def expand_query(self, query: str) -> list[str]:
        """
        关键词扩展策略:
        1. 原始查询
        2. 添加同义词
        3. 添加相关术语
        4. 添加时间限定 (最新/最近)
        5. 添加站点限定 (site:gov.cn / site:edu.cn)
        """
        expansions = [query]
        
        # 同义词扩展
        synonyms = self._get_synonyms(query)
        expansions.extend(synonyms)
        
        # 添加时间限定
        if self._needs_time_filter(query):
            expansions.append(f"{query} 2024 2025")
            expansions.append(f"{query} 最新")
        
        # 添加权威站点限定
        if self._needs_authoritative(query):
            expansions.append(f"site:gov.cn {query}")
            expansions.append(f"site:edu.cn {query}")
        
        return expansions
    
    def _get_synonyms(self, query: str) -> list[str]:
        """基于词向量或词典的同义词扩展"""
        # TODO: 集成轻量级词向量模型
        return []
```

### 2️⃣ **并行搜索层**

```python
class ParallelSearchEngine:
    """并行搜索引擎 - 提升速度和覆盖率"""
    
    async def search(self, query: str, max_results: int = 10) -> list[Result]:
        """
        并行执行多个搜索引擎，然后聚合结果
        """
        tasks = [
            self._baidu_search(query, max_results),
            self._bing_search(query, max_results),
            self._duckduckgo_search(query, max_results),
        ]
        
        # 使用 asyncio.gather 并行执行
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 聚合 + 去重
        return self._merge_and_deduplicate(results)
    
    async def _baidu_search(self, query: str, max_results: int) -> list[Result]:
        """百度搜索 - 使用 Playwright 真浏览器"""
        # 利用已有缓存，避免重复验证
        return await asyncio.to_thread(
            _baidu_html_search, query, max_results
        )
    
    async def _bing_search(self, query: str, max_results: int) -> list[Result]:
        """Bing 搜索 - 作为备选源"""
        return await asyncio.to_thread(
            _bing_html_search, query, max_results
        )
```

### 3️⃣ **质量评估层**

```python
class QualityScorer:
    """质量评分器 - 多维度评估结果质量"""
    
    def score(self, result: SearchResult) -> float:
        """
        综合评分 = 0.4*相关性 + 0.3*权威性 + 0.2*时效性 + 0.1*完整性
        """
        relevance = self._score_relevance(result)
        authority = self._score_authority(result)
        freshness = self._score_freshness(result)
        completeness = self._score_completeness(result)
        
        return (
            0.4 * relevance +
            0.3 * authority +
            0.2 * freshness +
            0.1 * completeness
        )
    
    def _score_authority(self, result: SearchResult) -> float:
        """
        权威性评分 - 基于域名权重
        """
        domain_weights = {
            'gov.cn': 1.0,
            'edu.cn': 0.95,
            'ac.cn': 0.9,
            'org.cn': 0.85,
            'wikipedia.org': 0.95,
            'baike.baidu.com': 0.8,
            'zhihu.com': 0.7,
            'csdn.net': 0.6,
        }
        
        domain = self._extract_domain(result.url)
        return domain_weights.get(domain, 0.5)
    
    def _score_freshness(self, result: SearchResult) -> float:
        """
        时效性评分 - 基于发布时间
        """
        if not result.publish_date:
            return 0.5  # 未知日期给中等分数
        
        days_old = (datetime.now() - result.publish_date).days
        
        if days_old <= 7:
            return 1.0
        elif days_old <= 30:
            return 0.8
        elif days_old <= 90:
            return 0.6
        elif days_old <= 365:
            return 0.4
        else:
            return 0.2
```

### 4️⃣ **深度提取层**

```python
class DeepExtractor:
    """深度提取器 - 获取页面完整信息"""
    
    def extract(self, url: str) -> DeepContent:
        """
        提取内容包括:
        1. 正文内容 (Readability 算法)
        2. 结构化数据 (JSON-LD)
        3. 内部链接 (用于后续探索)
        4. 图片/视频资源
        5. 元数据 (作者、发布时间、标签)
        """
        html = self._fetch_html(url)
        
        # 正文提取
        article = readability_extractor.extract_article(html)
        
        # 结构化数据
        json_ld = self._extract_json_ld(html)
        
        # 内部链接
        internal_links = self._extract_internal_links(url, html)
        
        # 图片资源
        images = self._extract_images(html)
        
        # 元数据
        metadata = self._extract_metadata(html)
        
        return DeepContent(
            title=article.title,
            content=article.to_markdown()[:4096],
            json_ld=json_ld,
            related_links=internal_links[:10],
            images=images[:5],
            metadata=metadata,
        )
```

### 5️⃣ **智能排序层**

```python
class IntelligentRanker:
    """智能排序器 - 多目标优化"""
    
    def rank(self, results: list[SearchResult]) -> list[SearchResult]:
        """
        排序策略:
        1. 按综合评分排序
        2. 来源多样性控制 (同一域名不超过 3 条)
        3. 类型多样性 (百科/新闻/博客/论坛混合)
        4. 时间新鲜度加权
        """
        # 计算综合评分
        for result in results:
            result.score = self.scorer.score(result)
        
        # 按评分降序
        results.sort(key=lambda x: x.score, reverse=True)
        
        # 来源多样性控制
        diversified = self._diversify_sources(results, max_per_domain=3)
        
        # 类型多样性控制
        diversified = self._diversify_types(diversified)
        
        return diversified
    
    def _diversify_sources(
        self, 
        results: list[SearchResult], 
        max_per_domain: int
    ) -> list[SearchResult]:
        """确保结果来源多样性"""
        domain_counts = defaultdict(int)
        selected = []
        
        for result in results:
            domain = self._extract_domain(result.url)
            if domain_counts[domain] < max_per_domain:
                selected.append(result)
                domain_counts[domain] += 1
        
        return selected
```

### 6️⃣ **缓存层**

```python
class SearchCache:
    """搜索缓存 - 提升响应速度"""
    
    def __init__(self, ttl_days: int = 7):
        self.ttl_days = ttl_days
        self.cache_dir = Path(".cache/search")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def get(self, query: str) -> SearchResult | None:
        """获取缓存结果"""
        cache_key = self._hash_query(query)
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        if not cache_file.exists():
            return None
        
        # 检查是否过期
        age = time.time() - cache_file.stat().st_mtime
        if age > self.ttl_days * 86400:
            cache_file.unlink()
            return None
        
        # 返回缓存结果
        with open(cache_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def set(self, query: str, results: list[SearchResult]) -> None:
        """保存结果到缓存"""
        cache_key = self._hash_query(query)
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
```

---

## 🚀 性能优化策略

### 1. **异步并发**
```python
# 使用 asyncio + aiohttp 实现高并发
async def fetch_all(urls: list[str]) -> list[str]:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_one(session, url) for url in urls]
        return await asyncio.gather(*tasks, return_exceptions=True)
```

### 2. **连接池复用**
```python
# 浏览器连接池
class BrowserPool:
    def __init__(self, size: int = 3):
        self.pool = asyncio.Queue(maxsize=size)
        for _ in range(size):
            self.pool.put_nowait(self._create_browser())
    
    async def acquire(self):
        return await self.pool.get()
    
    async def release(self, browser):
        await self.pool.put(browser)
```

### 3. **智能超时**
```python
# 分级超时策略
TIMEOUTS = {
    'search': 10,      # 搜索结果 10 秒
    'fetch': 30,       # 页面抓取 30 秒
    'extract': 60,     # 深度提取 60 秒
}
```

### 4. **渐进式加载**
```python
# 先返回快速结果，后台继续深度提取
async def progressive_search(query: str):
    # 第一层：快速搜索 (1-2 秒)
    quick_results = await fast_search(query)
    yield quick_results
    
    # 第二层：深度提取 (5-10 秒)
    deep_results = await deep_extract(quick_results)
    yield deep_results
```

---

## 📊 多层次搜索策略

### **Level 1: 快速搜索** (1-2 秒)
- 只获取标题 + 摘要
- 使用缓存结果
- 适合实时交互场景

### **Level 2: 标准搜索** (3-5 秒)
- 获取标题 + 摘要 + 部分正文
- 并行 2-3 个搜索引擎
- 适合一般查询

### **Level 3: 深度搜索** (10-15 秒)
- 完整正文提取
- 结构化数据解析
- 相关链接发现
- 适合研究性任务

### **Level 4: 探索搜索** (30-60 秒)
- 追踪相关链接 (最多 10 个)
- 多轮迭代搜索
- 知识图谱构建
- 适合深度研究

---

## 🎯 精准搜索策略

### 1. **意图识别**
```python
class IntentClassifier:
    def classify(self, query: str) -> SearchIntent:
        """
        识别搜索意图:
        - FACT: 事实查询 (什么是...)
        - HOW: 方法查询 (怎么做...)
        - NEWS: 新闻查询 (最新...)
        - RESEARCH: 研究查询 (论文/报告)
        - PRODUCT: 产品查询 (评测/对比)
        """
        if query.startswith("什么是") or query.startswith("什么是"):
            return SearchIntent.FACT
        elif query.startswith("怎么") or query.startswith("如何"):
            return SearchIntent.HOW
        elif "最新" in query or "新闻" in query:
            return SearchIntent.NEWS
        # ...
```

### 2. **领域适配**
```python
DOMAIN_STRATEGIES = {
    'academic': {
        'engines': ['scholar', 'arxiv', 'semantic_scholar'],
        'filters': ['pdf', 'citation', 'peer_reviewed'],
    },
    'news': {
        'engines': ['google_news', 'bing_news'],
        'filters': ['last_24h', 'last_week'],
    },
    'code': {
        'engines': ['github', 'stackoverflow'],
        'filters': ['recent', 'high_stars'],
    },
}
```

### 3. **结果验证**
```python
class ResultVerifier:
    def verify(self, results: list[SearchResult]) -> list[SearchResult]:
        """
        验证结果质量:
        1. 检查内容完整性
        2. 检查来源可信度
        3. 检查时间有效性
        4. 交叉验证事实准确性
        """
        verified = []
        for result in results:
            if self._is_complete(result) and \
               self._is_credible(result) and \
               self._is_fresh(result):
                verified.append(result)
        return verified
```

---

## 💾 缓存策略

### **三级缓存体系**

```
L1: 内存缓存 (LRU, 1000 条)
    └── 热点查询，毫秒级响应

L2: 本地文件缓存 (7 天 TTL)
    └── 搜索结果，秒级响应

L3: 浏览器缓存 (Playwright Storage State)
    └── Cookie/LocalStorage, 避免重复登录
```

### **缓存更新策略**
```python
class CacheUpdater:
    def update_strategy(self, query: str) -> UpdateStrategy:
        """
        根据查询类型决定更新策略:
        - NEWS: 每小时更新
        - FACT: 每天更新
        - RESEARCH: 每周更新
        - EVERGREEN: 每月更新
        """
```

---

## 📈 监控与优化

### **关键指标**
```python
METRICS = {
    'latency_p50': '中位数响应时间',
    'latency_p95': '95% 响应时间',
    'success_rate': '搜索成功率',
    'cache_hit_rate': '缓存命中率',
    'result_quality': '结果质量评分',
    'user_satisfaction': '用户满意度',
}
```

### **A/B 测试**
```python
class ABTester:
    def test_ranking_strategy(self, query: str) -> str:
        """
        测试不同排序策略的效果
        Group A: 相关性优先
        Group B: 权威性优先
        Group C: 时效性优先
        """
```

---

## 🔒 安全与合规

### **请求频率控制**
```python
class RateLimiter:
    def __init__(self):
        self.limits = {
            'baidu.com': 10,      # 每秒 10 次
            'bing.com': 10,
            'duckduckgo.com': 10,
        }
    
    async def acquire(self, domain: str):
        await self.rate_limiters[domain].acquire()
```

### **User-Agent 轮换**
```python
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
    "Mozilla/5.0 (X11; Linux x86_64) ...",
]
```

---

## 📦 依赖安装

```bash
# 核心依赖
pip install aiohttp asyncio-playwright readability-lxml

# 可选依赖 (提升质量)
pip install sentence-transformers rank-bm25  # 语义搜索
pip install playwright  # 真浏览器搜索
pip install ddgs  # DuckDuckGo 非官方 API
```

---

## 🎓 使用示例

```python
from advanced_search import AdvancedSearchEngine

engine = AdvancedSearchEngine(
    level='deep',           # 搜索深度：quick/standard/deep/explore
    parallel=True,          # 并行搜索
    use_cache=True,         # 启用缓存
    diversity=True,         # 结果多样性
)

# 执行搜索
results = await engine.search(
    query="人工智能最新进展",
    max_results=10,
    time_range='month',     # 时间范围：day/week/month/year
    domain_filter=None,     # 域名过滤：['gov.cn', 'edu.cn']
)

# 输出结果
for result in results:
    print(f"标题：{result.title}")
    print(f"来源：{result.url}")
    print(f"评分：{result.score}")
    print(f"内容：{result.content[:200]}")
    print("-" * 80)
```

---

## 🎯 总结

本方案通过**六层架构**实现高效、快速、免费、多层次、深度、精准的搜索:

1. ✅ **查询优化** - 提升精准度
2. ✅ **并行搜索** - 提升速度和覆盖率
3. ✅ **质量评估** - 多维度评分
4. ✅ **深度提取** - 获取完整信息
5. ✅ **智能排序** - 多目标优化
6. ✅ **缓存加速** - 降低延迟

**核心优势:**
- 🆓 **完全免费** - 零 API 依赖
- ⚡ **快速响应** - 并行 + 缓存
- 🎯 **精准结果** - 智能评分 + 排序
- 🏗️ **多层次** - 4 个深度级别
- 🔍 **深度挖掘** - 内容提取 + 链接追踪
- 🚀 **高性能** - 异步并发 + 连接池
