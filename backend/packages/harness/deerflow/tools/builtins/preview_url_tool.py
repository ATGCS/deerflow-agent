"""Preview URL tool — Screenshot or text snapshot using Playwright.

Two modes:
1. 'screenshot' — Captures page as base64 PNG (for vision models)
2. 'text'      — Extracts rendered text from the page (for reading)

Uses Playwright's Chromium browser, reusing existing infrastructure.
"""

import base64
import logging
from typing import Literal

from langchain.tools import tool

logger = logging.getLogger(__name__)

# Security: block internal/private network URLs
_BLOCKED_HOSTS = {
    "localhost", "127.0.0.1", "0.0.0.0",
    "::1", "localhost.localdomain",
}


def _is_blocked_url(url: str) -> str | None:
    """Check if URL should be blocked."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return "Error: Invalid URL (no hostname)"
        if parsed.scheme not in ("http", "https"):
            return f"Error: Only http/https URLs allowed, got: {parsed.scheme}"
        if hostname in _BLOCKED_HOSTS:
            return f"Error: Internal URL blocked: {hostname}"
        # Block private IP ranges
        if hostname.replace(".", "").isdigit():
            parts = hostname.split(".")
            if len(parts) == 4:
                first_octet = int(parts[0])
                if first_octet in (10, 127, 169) or \
                   (first_octet == 172 and int(parts[1]) >= 16 and int(parts[1]) <= 31) or \
                   (first_octet == 192 and int(parts[1]) == 168):
                    return f"Error: Private IP address blocked: {hostname}"
        return None
    except Exception as e:
        return f"Error: Invalid URL: {e}"


@tool("preview_url", parse_docstring=False)
def preview_url_tool(
    url: str,
    *,
    mode: Literal["screenshot", "text"] = "text",
    viewport_width: int = 1280,
    viewport_height: int = 800,
    full_page: bool = False,
    wait_selector: str | None = None,
    timeout: int = 30000,
) -> str:
    """Preview a webpage by taking a screenshot or extracting rendered text.

    Uses a real browser (Playwright/Chromium) to render the page.

    Args:
        url: URL to preview (http/https only).
        mode: 'screenshot' returns base64 image; 'text' returns rendered text.
        viewport_width: Browser width in pixels (default 1280).
        viewport_height: Browser height in pixels (default 800).
        full_page: If True and mode=screenshot, capture entire scrollable page.
        wait_selector: CSS selector to wait for before capturing (e.g., '.main-content').
        timeout: Max wait time in milliseconds (default 30000).

    Examples:
        # Text mode - read article content
        preview_url_tool('https://example.com/article', mode='text')

        # Screenshot - capture visual
        preview_url_tool('https://example.com', mode='screenshot', full_page=True)

    Note: Screenshot output can be passed to view_image for visual analysis.
    """
    # Security check
    block_err = _is_blocked_url(url)
    if block_err:
        return block_err

    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout
    except ImportError:
        return (
            "Error: playwright not installed. "
            "Install with: pip install playwright && playwright install chromium"
        )

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--js-flags=--max-old-space-size=256",
                ],
            )

            context = browser.new_context(
                viewport={"width": viewport_width, "height": viewport_height},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                locale="zh-CN",
            )

            page = context.new_page()

            try:
                # Navigate to URL
                page.goto(url, timeout=timeout, wait_until="domcontentloaded")

                # Optional: wait for specific element
                if wait_selector:
                    page.wait_for_selector(wait_selector, timeout=min(timeout, 10000))

                # Extra wait for JS rendering
                page.wait_for_timeout(500)

                if mode == "screenshot":
                    result = _capture_screenshot(page, full_page, url)
                else:
                    result = _extract_text(page, url)

                return result

            except PwTimeout:
                return f"Error: Page load timed out after {timeout}ms for {url}"
            except Exception as e:
                return f"Error: Browser error for '{url}': {e}"
            finally:
                context.close()
                browser.close()

    except Exception as e:
        return f"Error: Failed to launch browser: {e}"


def _capture_screenshot(page, full_page: bool, url: str) -> str:
    """Capture page screenshot and return as base64 data URI."""
    screenshot_bytes = page.screenshot(
        full_page=full_page,
        type="png",
        quality=85,
    )
    b64 = base64.b64encode(screenshot_bytes).decode("ascii")

    size_info = ""
    if not full_page:
        vp = page.viewport_size
        size_info = f" ({vp['width']}x{vp['height']}px)"
    else:
        size_info = f" (full page, ~{len(screenshot_bytes)//1024}KB)"

    return (
        f"data:image/png;base64,{b64}\n\n"
        f"[Screenshot of {url}{size_info}]\n"
        f"Pass this data URI to view_image for visual analysis."
    )


def _extract_text(page, url: str) -> str:
    """Extract rendered text content from the page."""
    # Get main body text (rendered DOM, not raw HTML)
    text = page.evaluate("""() => {
        // Remove hidden/noise elements
        document.querySelectorAll(
            'script, style, nav, footer, header, [style*="display:none"], '
            + '[style*="display: none"], [hidden], [aria-hidden="true"]'
        ).forEach(function(e) { e.remove(); });

        var raw = document.body.innerText || document.body.textContent || '';

        // Clean up excessive whitespace
        return raw.split('\\n')
            .map(function(line) { return line.trim(); })
            .filter(function(line) { return line.length > 0; })
            .join('\\n');
    }""")

    if not text or not text.strip():
        return f"(page appears empty or had no extractable text content: {url})"

    # Truncate very long pages
    max_chars = 50000
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n... [truncated, total {len(text)} chars]"

    title = page.title() or url
    return f"# {title}\n\nSource: {url}\n\n{text}"
