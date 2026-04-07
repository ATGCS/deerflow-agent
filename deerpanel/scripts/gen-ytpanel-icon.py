#!/usr/bin/env python3
"""
生成 YTPanel 应用图标：与 UI 一致的淡蓝→淡紫渐变（对齐 variables.css 的 indigo/sky 系），中央 YTPanel 字标。
输出：docs/ytpanel-app-icon-square.png（1024×1024，供 tauri icon 使用）
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("需要 Pillow: pip install Pillow", file=sys.stderr)
    sys.exit(1)

# 与 src/style/variables.css 中 accent / info 协调的淡渐变端点
# 略向 indigo #6366f1 偏一点，更贴品牌色
C_SKY2 = (165, 210, 255)  # 再淡一点的蓝
C_INDIGO_SOFT = (186, 192, 252)  # #bac0fc 淡靛紫


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_gradient(img: Image.Image, c0: tuple[int, int, int], c1: tuple[int, int, int]) -> None:
    w, h = img.size
    px = img.load()
    # 135° 对角：左上偏蓝、右下偏紫
    for y in range(h):
        for x in range(w):
            t = (x / max(w - 1, 1) + y / max(h - 1, 1)) / 2.0
            t = max(0.0, min(1.0, t))
            r = int(lerp(c0[0], c1[0], t))
            g = int(lerp(c0[1], c1[1], t))
            b = int(lerp(c0[2], c1[2], t))
            px[x, y] = (r, g, b)


def find_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/System/Library/Fonts/SFNS.ttf"),
    ]
    for p in candidates:
        if p.is_file():
            try:
                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out = root / "docs" / "ytpanel-app-icon-square.png"
    out.parent.mkdir(parents=True, exist_ok=True)

    size = 1024
    img = Image.new("RGB", (size, size), C_SKY2)
    draw_gradient(img, C_SKY2, C_INDIGO_SOFT)

    # 轻微柔光层（更「面板」感）
    overlay = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((-80, -80, size // 2 + 200, size // 2 + 200), fill=(255, 255, 255, 35))
    od.ellipse((size // 2 - 100, size // 2 - 100, size + 120, size + 120), fill=(255, 255, 255, 25))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    draw = ImageDraw.Draw(img)
    label = "YTPanel"
    font_size = 132
    font = find_font(font_size)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2
    ty = (size - th) // 2 - 8
    # 字标：深靛色，与浅色渐变对比清晰（对齐 --text-primary 偏 zinc）
    fill = (30, 27, 75)  # #1e1b4b
    try:
        draw.text(
            (tx, ty),
            label,
            font=font,
            fill=fill,
            stroke_width=4,
            stroke_fill=(255, 255, 255),
        )
    except TypeError:
        draw.text((tx, ty), label, font=font, fill=fill)

    img.save(out, "PNG", optimize=True)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
