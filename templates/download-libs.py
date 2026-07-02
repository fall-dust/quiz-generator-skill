#!/usr/bin/env python3
"""
第三方 JS/CSS 库下载脚本 — 将富文本渲染所需库下载到本地 js/lib/ 目录
确保离线可用。若本地已有则跳过，不会重复下载。
用法: python js/lib/download-libs.py
"""
import os, sys, urllib.request

# ─── 富文本编辑器 + Markdown 渲染所需库 ──────────────────────
LIBS = {
    "Quill JS":   ("https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js",                       "quill.min.js"),
    "Quill CSS":  ("https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css",                     "quill.snow.css"),
    "KaTeX JS":   ("https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js",                     "katex.min.js"),
    "KaTeX CSS":  ("https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css",                    "katex.min.css"),
    "KaTeX AR":   ("https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/contrib/auto-render.min.js",       "katex-auto-render.min.js"),
    "Marked":     ("https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js",                        "marked.min.js"),
    "DOMPurify":  ("https://cdn.jsdelivr.net/npm/dompurify@3.2.5/dist/purify.min.js",                  "purify.min.js"),
    "hl.js JS":   ("https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/lib/highlight.min.js",           "highlight.min.js"),
    "hl.js CSS":  ("https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css",          "github.min.css"),
    "hl.js Dark": ("https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark.min.css",     "github-dark.min.css"),
}


def sizeof_fmt(size):
    for unit in ("B", "KB", "MB"):
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}GB"


def download():
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(dst, exist_ok=True)

    ok = fail = skip = 0
    for name, (url, fname) in LIBS.items():
        path = os.path.join(dst, fname)
        if os.path.exists(path):
            size = os.path.getsize(path)
            print(f"✓  {name:12s}  已存在 ({sizeof_fmt(size)})  → 跳过")
            skip += 1
            continue

        try:
            print(f"↓  {name:12s}  正在下载...", end=" ", flush=True)
            urllib.request.urlretrieve(url, path)
            size = os.path.getsize(path)
            print(f"✓ {sizeof_fmt(size)}  →  {fname}")
            ok += 1
        except Exception as e:
            print(f"✗ 失败: {e}")
            fail += 1

    print(f"\n📊 总计: 成功 {ok} / 跳过 {skip} / 失败 {fail}")
    return fail


if __name__ == "__main__":
    sys.exit(download())
