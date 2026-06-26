#!/usr/bin/env python3
"""
第三方 JS 库下载脚本 — 将所需库下载到本地 js/lib/ 目录
确保离线可用。若本地已有则跳过，不会重复下载。
用法: python js/lib/download-libs.py
"""
import os, sys, urllib.request

# ─── 在此处声明需要的第三方库 ─────────────────────────────
LIBS = {
    # 库名: (CDN URL, 保存文件名)
    # 取消注释你需要的库：
    #
    # "chart.js": (
    #     "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
    #     "chart.umd.min.js",
    # ),
    # "katex": (
    #     "https://cdn.jsdelivr.net/npm/katex@0/dist/katex.mjs",
    #     "katex.mjs",
    # ),
    # "marked": (
    #     "https://cdn.jsdelivr.net/npm/marked@15/marked.min.js",
    #     "marked.min.js",
    # ),
    # "lodash-es": (
    #     "https://cdn.jsdelivr.net/npm/lodash-es@4/lodash.min.js",
    #     "lodash.min.js",
    # ),
    # "echarts": (
    #     "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js",
    #     "echarts.min.js",
    # ),
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

    if not LIBS:
        print("⚠  LIBS 字典为空。请先在 download-libs.py 中取消注释你需要的库。")
        sys.exit(1)

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
