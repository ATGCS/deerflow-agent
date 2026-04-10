"""Enhanced Web Fetch tool — Hybrid HTTP + Jina fallback strategy.

Strategy C (Hybrid):
1. Primary: Built-in HTTP fetcher with HTML→Markdown conversion (zero external deps)
2. Optional: Jina Reader API as enhanced backend when available
3. Fallback: If Jina fails, falls back to pure HTTP

Features:
- 50KB content limit (vs jina_ai's 4KB limit)
- Three extract modes: full / main-content / text
- Security: blocks internal networks, enforces http/https only
- Auto-detection of portal/search pages → redirect to web_search
"""

import logging
import re
import ssl
from html.parser import HTMLParser
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from ipaddress import ip_address as _ip_addr, ip_network as _ip_net

from langchain.tools import tool

logger = logging.getLogger(__name__)

# ── SSL Context ──────────────────────────────────────────────
_SSL_CONTEXT = ssl.create_default_context()
_SSL_CONTEXT.check_hostname = False
_SSL_CONTEXT.verify_mode = ssl.CERT_NONE

# ── Security ──────────────────────────────────────────────────
_BLOCKED_SCHEMES = {"file", "javascript", "data", "ftp"}
_BLOCKED_NETWORKS = [
    ("127.0.0.0", "255.0.0.0"),
    ("10.0.0.0", "255.0.0.0"),
    ("172.16.0.0", "255.240.0.0"),
    ("192.168.0.0", "255.255.0.0"),
    ("169.254.0.0", "255.255.0.0"),
]

_PORTAL_HOSTS = {
    "bing.com": ("/news/search", "/search"),
    "google.com": ("/search",),
    "baidu.com": ("/s",),
}


# ── HTML → Markdown Converter ────────────────────────────────


class _HTMLToMarkdown(HTMLParser):
    """Minimal but effective HTML to Markdown converter.

    Handles:
    - Headings h1→h6 → # prefixes
    - Paragraphs, line breaks, horizontal rules
    - Links [text](url), images ![alt](src)
    - Lists (ul/ol/li), tables (tr/td/th)
    - Code blocks (pre/code), bold/italic
    - Strips script/style/nav/footer/header noise
    """

    def __init__(self):
        super().__init__()
        self.output: list[str] = []
        self._in_script_style = False
        self._in_pre = False
        self._tag_stack: list[tuple[str, str]] = []
        self._list_depth = 0
        self._in_table = False
        self._table_row: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str]]):
        tag = tag.lower()
        attr_dict = dict(attrs)

        # Skip content inside script/style
        if tag in ("script", "style"):
            self._in_script_style = True
            return
        if tag in ("nav", "footer", "header", "aside"):
            self._in_script_style = True  # Treat as skip for main-content mode
            return
        if tag == "pre":
            self._in_pre = True
        if tag == "br":
            self._write("\n")
        if tag == "hr":
            self._write("\n---\n")
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self._write("\n" + "#" * level + " ")
        if tag in ("ul", "ol"):
            self._list_depth += 1
        if tag == "li":
            indent = "  " * max(0, self._list_depth - 1)
            self._write(f"\n{indent}- ")
        if tag == "p":
            self._write("\n")
        if tag == "img":
            alt = attr_dict.get("alt", "")
            src = attr_dict.get("src", "")
            if src and src.startswith("http"):
                self._write(f"![{alt}]({src})")
            elif alt:
                self._write(f"[Image: {alt}]")
        if tag == "a":
            href = attr_dict.get("href", "")
            self._tag_stack.append(("a", href))
        if tag in ("strong", "b"):
            self._write("**")
        if tag in ("em", "i"):
            self._write("*")
        if tag == "code" and not self._in_pre:
            self._write("`")
        if tag in ("blockquote",):
            self._write("> ")
        if tag == "table":
            self._in_table = True
        if tag == "tr":
            self._table_row = []
        if tag in ("td", "th"):
            self._table_row.append("")

    def handle_endtag(self, tag: str):
        tag = tag.lower()
        if tag in ("script", "style", "nav", "footer", "header", "aside"):
            self._in_script_style = False
            return
        if tag == "pre":
            self._in_pre = False
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote"):
            self._write("\n")
        if tag in ("ul", "ol"):
            self._list_depth = max(0, self._list_depth - 1)
        if tag == "a" and self._tag_stack:
            _, href = self._tag_stack.pop()
            if href and href.startswith("http"):
                self._write(f"({href})")
        if tag in ("strong", "b"):
            self._write("**")
        if tag in ("em", "i"):
            self._write("*")
        if tag == "code" and not self._in_pre:
            self._write("`")
        if tag == "tr" and self._in_table:
            self._write("| " + " | ".join(self._table_row) + " |")
        if tag == "th" and self._in_table:
            # Add separator row after header
            self._write("\n| " + " | ".join("---" for _ in self._table_row) + " |")
        if tag == "table":
            self._in_table = False

    def handle_data(self, data: str):
        if self._in_script_style:
            return
        text = data if self._in_pre else " ".join(data.split())
        self._write(text)
        if self._in_table and self._table_row is not None:
            # Also accumulate table cell data
            last_idx = len(self._table_row) - 1
            if last_idx >= 0:
                self._table_row[last_idx] += text.strip()

    def handle_entityref(self, name: str):
        entities = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "#39": "'", "nbsp": " "}
        self._write(entities.get(name, f"&{name};"))

    def _write(self, text: str):
        self.output.append(text)

    def get_markdown(self) -> str:
        raw = "".join(self.output)
        cleaned = re.sub(r"\n{3,}", "\n\n", raw)
        return cleaned.strip()


# ── Portal Page Detection ────────────────────────────────────


def _is_portal_search_page(url: str) -> bool:
    """Detect search engine result pages that should use web_search instead."""
    try:
        p = urlparse(url)
    except Exception:
        return False
    host = (p.netloc or "").lower()
    path = (p.path or "").lower()

    for domain, paths in _PORTAL_HOSTS.items():
        if host.endswith(domain) or host.endswith("." + domain):
            for prefix in paths:
                if path.startswith(prefix):
                    return True
    return False


# ── Network Safety Check ─────────────────────────────────────


def _is_blocked_url(parsed_url) -> str | None:
    """Return error message if URL should be blocked, None otherwise."""
    scheme = parsed_url.scheme.lower()
    if scheme in _BLOCKED_SCHEMES:
        return f"Error: Blocked URL scheme '{scheme}' — only http/https allowed"
    if scheme not in ("http", "https"):
        return f"Error: Only http/https URLs allowed, got: {scheme}"

    hostname = parsed_url.hostname
    if not hostname:
        return None

    for net, mask in _BLOCKED_NETWORKS:
        try:
            ip = _ip_addr(hostname)
            net_obj = _ip_net(f"{net}/{mask}", strict=False)
            if ip in net_obj:
                return f"Error: Private/internal network URL blocked: {hostname}"
        except ValueError:
            pass  # Not an IP address hostname, that's fine
    return None


# ── Main Content Extraction ──────────────────────────────────


def _extract_main_content(md: str, max_len: int = 50000) -> str | None:
    """Extract the most likely article body from converted Markdown.

    Uses heuristics:
    1. Split by heading boundaries
    2. Score each section by length × content keywords
    3. Return the highest-scoring section
    """
    sections = re.split(r"\n(?=#{1,4}\s)", md)
    if len(sections) <= 1:
        return None

    scored = []
    for sec in sections:
        text_len = len(sec)
        if text_len < 80:
            continue
        score = text_len

        # Boost sections with article-like headers
        header_match = re.match(
            r"^#{1,4}\s*"
            r"(?:Article|Content|Main|正文|文章|内容|Introduction|"
            r"Abstract|Summary|Overview|Background|Discussion|"
            r"Conclusion|Methodology|Results)",
            sec,
            re.IGNORECASE,
        )
        if header_match:
            score *= 2.5

        # Penalize navigation-heavy sections
        nav_indicators = len(re.findall(r"(?:menu|nav|sidebar|footer|header|subscribe)", sec, re.IGNORECASE))
        score *= max(0.5, 1.0 - nav_indicators * 0.2)

        # Prefer sections with paragraph-like density (longer lines)
        lines = sec.splitlines()
        long_lines = sum(1 for l in lines if len(l.strip()) > 60)
        if long_lines > 3:
            score *= 1.3

        scored.append((score, sec))

    if not scored:
        return None

    scored.sort(key=lambda x: -x[0])
    return scored[0][1][:max_len]


# ── Jina Fallback (optional) ──────────────────────────────────


def _try_jina_fetch(url: str, timeout: int) -> str | None:
    """Attempt Jina Reader API fetch. Returns content or None on failure."""
    try:
        from deerflow.community.jina_ai.jina_client import JinaClient

        client = JinaClient()
        result = client.crawl(url, return_format="markdown", timeout=timeout)
        if result and isinstance(result, str) and not result.lower().startswith("error:"):
            return result[:50000]
    except ImportError:
        logger.debug("Jina client not available, skipping")
    except Exception as e:
        logger.debug("Jina fetch failed: %s", e)
    return None


# ── Core HTTP Fetcher ─────────────────────────────────────────


def _http_fetch(url: str, timeout: int, max_length: int) -> tuple[str, str]:
    """Fetch URL via HTTP and return (html_str, encoding)."""
    req = Request(url, headers={
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",  # No compression for simplicity
    })

    with urlopen(req, timeout=timeout, context=_SSL_CONTEXT) as resp:
        raw_bytes = resp.read(max_length * 2)
        encoding = resp.headers.get_content_charset() or "utf-8"
        html_str = raw_bytes.decode(encoding, errors="replace")[:max_length]

    return html_str, encoding


# ── Public Tool ───────────────────────────────────────────────


@tool("web_fetch_enhanced", parse_docstring=False)
def web_fetch_tool(
    url: str,
    *,
    extract: Literal["full", "main-content", "text"] = "main-content",
    max_length: int = 50000,
    timeout: int = 30,
    prefer_jina: bool = False,
) -> str:
    """Fetch content from a URL and convert to readable markdown.

    Supports hybrid strategy: built-in HTTP fetcher (always available)
    plus optional Jina Reader API for better quality.

    Args:
        url: URL to fetch (http:// or https:// only).
        extract: 'full'=entire page HTML to MD, 'main-content'=article body (default),
                 'text'=plain text only.
        max_length: Maximum response length in characters (default 50000).
        timeout: Request timeout in seconds (default 30).
        prefer_jina: Try Jina Reader API first (requires API key configured).

    Internal/private network URLs are blocked for security.

    Examples:
        web_fetch_tool('https://example.com/article')
        web_fetch_tool('https://example.com', extract='text', max_length=10000)
    """
    # Validate URL
    parsed_url = urlparse(url)
    block_err = _is_blocked_url(parsed_url)
    if block_err:
        return block_err

    # Detect search portals
    if _is_portal_search_page(url):
        return (
            "Error: This looks like a search/portal page. "
            "Use the `web_search` tool instead, then call `web_fetch_tool` on specific result URLs."
        )

    fetched_md = None

    # Strategy: try Jina first if requested, else try HTTP first
    if prefer_jina:
        fetched_md = _try_jina_fetch(url, timeout)
        if not fetched_md:
            logger.info("Jina failed, falling back to HTTP for %s", url)

    if not fetched_md:
        # Primary: built-in HTTP fetcher
        try:
            html_str, encoding = _http_fetch(url, timeout, max_length)

            if extract == "text":
                # Plain text mode: strip all tags
                text = re.sub(r"<[^>]+>", " ", html_str)
                text = re.sub(r"\s+", " ", text).strip()
                return text[:max_length]

            # Convert to Markdown
            parser = _HTMLToMarkdown()
            parser.feed(html_str)
            fetched_md = parser.get_markdown()

        except HTTPError as e:
            return f"Error: HTTP {e.code} {e.reason} for {url}"
        except URLError as e:
            # If HTTP fails, try Jina as fallback
            if not prefer_jina:
                fetched_md = _try_jina_fetch(url, timeout)
            if not fetched_md:
                return f"Error: Failed to fetch {url}: {e.reason}"
        except ssl.SSLError:
            return f"Error: SSL certificate error for {url}"
        except Exception as e:
            return f"Error: Fetching {url} failed: {e}"

    if not fetched_md:
        return f"Error: No content extracted from {url}"

    # Main content extraction
    if extract == "main-content":
        extracted = _extract_main_content(fetched_md, max_len=max_length)
        if extracted:
            fetched_md = extracted

    return fetched_md[:max_length] if fetched_md.strip() else \
        "(page appears empty or had no extractable content)"
