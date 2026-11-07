#!/usr/bin/env python3
"""Makes WebP copies of the site screenshots (800 and 1600 pixels wide) next to the JPEGs.
The JPEGs stay as the fallback and for social previews. Run: python3 scripts/optimize-media.py"""
import pathlib
from PIL import Image
MEDIA = pathlib.Path(__file__).resolve().parent.parent / "site" / "media"
for jpg in sorted(MEDIA.glob("*.jpg")):
    im = Image.open(jpg).convert("RGB")
    for w in (800, 1600):
        out = jpg.with_name(f"{jpg.stem}-{w}.webp")
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(out, "WEBP", quality=80, method=6)
        print(out.name, out.stat().st_size // 1024, "KB")

# Panel crops: the app's main area without the sidebar and top bar, so text stays readable when shown at page width.
BOX = (296, 76, 1800, 1125)
for name in ("v2-meeting", "v2-troubleshoot", "v2-interview", "v2-meeting-dark"):
    im = Image.open(MEDIA / f"{name}.jpg").convert("RGB").crop(BOX)
    im.save(MEDIA / f"{name}-panel.jpg", quality=88, optimize=True)
    for w in (800, 1504):
        out = MEDIA / f"{name}-panel-{w}.webp"
        im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(out, "WEBP", quality=80, method=6)
        print(out.name, out.stat().st_size // 1024, "KB")
