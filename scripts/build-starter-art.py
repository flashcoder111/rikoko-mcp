"""Build original, deterministic rikoko starter illustrations. No model/network calls."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "packages/templates/src/bundled"
ROOT.mkdir(parents=True, exist_ok=True)
PALETTES = [
    ("product-stage", "奶油色商品展台", "商品", ["展台", "简洁", "暖色"], "#f1e8da", "#c46c43", "#e0c6a8"),
    ("coffee-corner", "咖啡时光插画", "场景", ["咖啡", "门店", "暖色"], "#ebe0cd", "#314a40", "#bfa581"),
    ("paper-notes", "纸张与便签插画", "背景", ["教程", "知识", "浅色"], "#ebece6", "#4a6556", "#ccd4c0"),
    ("ranking-blocks", "蓝色阶梯插画", "背景", ["清单", "排行", "蓝色"], "#dfe6f1", "#435d97", "#b7c8e3"),
    ("event-sunset", "落日拱门插画", "场景", ["活动", "邀请", "橙色"], "#f7dfcd", "#bf4f32", "#eab090"),
    ("brand-orbit", "深绿几何插画", "品牌", ["品牌", "几何", "深色"], "#183a36", "#dbb576", "#35564d"),
]
manifest = []
for slug, name, category, tags, bg, accent, soft in PALETTES:
    im = Image.new("RGB", (720, 1280), bg)
    d = ImageDraw.Draw(im)
    d.ellipse((390, -120, 970, 460), fill=soft)
    d.line((64, 90, 656, 90), fill=accent, width=3)
    if slug == "product-stage":
        d.ellipse((120, 630, 620, 740), fill=soft)
        d.rounded_rectangle((172, 605, 548, 895), radius=35, fill=soft)
        d.ellipse((172, 550, 548, 675), fill=accent)
        d.rounded_rectangle((300, 310, 425, 565), radius=25, fill=accent)
        d.rectangle((325, 273, 400, 319), fill=soft)
    elif slug == "coffee-corner":
        d.ellipse((128, 710, 610, 800), fill=soft)
        d.ellipse((404, 490, 582, 690), outline=accent, width=30)
        d.rounded_rectangle((195, 460, 470, 746), radius=78, fill=accent)
        d.ellipse((195, 440, 470, 530), fill=soft)
        for x in (260, 335, 410):
            d.arc((x-30, 235, x+30, 415), 70, 270, fill=accent, width=6)
    elif slug == "paper-notes":
        for x, y in ((115, 330), (165, 395), (215, 460)):
            d.rounded_rectangle((x, y, x+350, y+325), radius=20, fill=soft if x != 215 else accent)
        for y in (530, 600, 670):
            d.line((266, y, 505, y), fill=bg, width=8)
    elif slug == "ranking-blocks":
        for i, h in enumerate((140, 260, 390)):
            x = 90 + i*190
            d.rounded_rectangle((x, 820-h, x+165, 820), radius=20, fill=accent if i == 2 else soft)
            d.ellipse((x+55, 750-h, x+110, 805-h), fill=accent)
    elif slug == "event-sunset":
        d.rounded_rectangle((150, 290, 570, 840), radius=210, fill=accent)
        d.ellipse((275, 460, 445, 630), fill=bg)
        d.rectangle((150, 685, 570, 850), fill=soft)
        d.line((70, 855, 650, 855), fill=accent, width=4)
    else:
        d.ellipse((145, 340, 575, 770), outline=accent, width=35)
        d.ellipse((275, 460, 430, 615), fill=accent)
        d.line((92, 800, 623, 320), fill=soft, width=15)
    d.line((64, 1110, 656, 1110), fill=accent, width=3)
    path = ROOT / f"{slug}.png"
    im.save(path, optimize=True)
    data = path.read_bytes()
    manifest.append(dict(id=f"starter-{slug}", file=path.name, name=name, category=category, tags=tags,
                         sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), width=720, height=1280))
# The second batch uses a separate illustration for every scene. These are original
# schematic drawings, not screenshots, customer endorsements or third-party assets.
DETAILS = [
    ("software-overview", "软件总览示意", "背景", ["软件", "截图", "演示"], "#edf1fa", "#253b71", "产品总览", "01"),
    ("software-focus", "功能操作示意", "背景", ["软件", "功能", "演示"], "#edf1fa", "#253b71", "核心功能", "02"),
    ("software-ready", "完成效果示意", "背景", ["软件", "完成", "演示"], "#edf1fa", "#253b71", "完成效果", "03"),
    ("change-before", "整理前示意", "场景", ["对比", "收纳", "之前"], "#f6ece0", "#70472e", "改变之前", "01"),
    ("change-after", "整理后示意", "场景", ["对比", "收纳", "之后"], "#f6ece0", "#70472e", "改变之后", "02"),
    ("change-summary", "整理对照示意", "场景", ["对比", "收纳", "细节"], "#f6ece0", "#70472e", "看见变化", "03"),
    ("feedback-intro", "反馈场景插画", "品牌", ["评价", "反馈", "品牌"], "#f1edf8", "#4d3d68", "倾听反馈", "01"),
    ("feedback-quote", "评价卡片插画", "品牌", ["评价", "卡片", "口碑"], "#f1edf8", "#4d3d68", "真实体验", "02"),
    ("feedback-source", "评价来源插画", "品牌", ["评价", "来源", "品牌"], "#f1edf8", "#4d3d68", "分享体验", "03"),
]
font_path = Path(__file__).resolve().parents[1] / "packages/render/fonts/NotoSansSC.ttf"
if not font_path.is_file():
    raise RuntimeError("Bundled OFL Noto Sans SC is required to build redistributable starter artwork")
title_font = ImageFont.truetype(str(font_path), 48)
small_font = ImageFont.truetype(str(font_path), 22)
number_font = ImageFont.truetype(str(font_path), 96)

for slug, name, category, tags, bg, accent, title, number in DETAILS:
    im = Image.new("RGB", (720, 1280), bg)
    d = ImageDraw.Draw(im)
    soft = "#dce4f3" if slug.startswith("software") else "#e8d5c0" if slug.startswith("change") else "#ded5ec"
    d.text((54, 65), "rikoko  /  故事分镜", font=small_font, fill=accent)
    d.text((54, 120), title, font=title_font, fill=accent)
    d.text((546, 97), number, font=number_font, fill=soft)
    d.line((54, 234, 666, 234), fill=soft, width=2)
    d.rounded_rectangle((44, 286, 676, 884), radius=32, fill="#ffffff")

    if slug.startswith("software"):
        d.rounded_rectangle((80, 335, 640, 812), radius=20, fill="#f5f7fc", outline=soft, width=2)
        for x in (106, 128, 150):
            d.ellipse((x, 357, x+10, 367), fill=soft)
        d.line((80, 387, 640, 387), fill=soft, width=2)
        d.rounded_rectangle((106, 414, 238, 781), radius=12, fill=accent)
        for y in (455, 507, 559, 611):
            d.rounded_rectangle((128, y, 211, y+10), radius=5, fill=soft)
        if slug.endswith("overview"):
            for x, y in ((266, 414), (445, 414), (266, 607), (445, 607)):
                d.rounded_rectangle((x, y, x+165, y+160), radius=14, fill="#ffffff", outline=soft, width=2)
                d.rounded_rectangle((x+18, y+23, x+100, y+35), radius=6, fill=soft)
                for j, h in enumerate((35, 67, 49)):
                    d.rounded_rectangle((x+20+j*39, y+130-h, x+44+j*39, y+130), radius=4, fill=accent)
        elif slug.endswith("focus"):
            for i, y in enumerate((427, 535, 643)):
                d.rounded_rectangle((266, y, 613, y+84), radius=12, fill=accent if i == 1 else "#ffffff", outline=soft, width=2)
                d.ellipse((286, y+22, 318, y+54), fill="#ffffff" if i == 1 else soft)
                d.rounded_rectangle((337, y+23, 580, y+33), radius=5, fill=soft)
                d.rounded_rectangle((337, y+45, 519, y+53), radius=4, fill=soft)
            d.polygon([(557, 587), (569, 629), (580, 612), (600, 608)], fill="#d5a642")
        else:
            d.ellipse((335, 456, 553, 674), fill=soft)
            d.line((389, 566, 427, 606, 502, 523), fill=accent, width=14)
            d.rounded_rectangle((328, 716, 560, 730), radius=7, fill=soft)
    elif slug.startswith("change"):
        if slug.endswith("before"):
            for x, y, w, h, color in ((115, 371, 202, 176, soft), (345, 452, 216, 131, accent),
                                       (190, 612, 155, 164, "#bf936b"), (416, 648, 158, 115, soft)):
                d.rounded_rectangle((x, y, x+w, y+h), radius=15, fill=color)
                d.line((x+25, y+30, x+w-25, y+30), fill=bg, width=5)
        elif slug.endswith("after"):
            for row in range(2):
                for col in range(3):
                    x, y = 102+col*179, 379+row*215
                    d.rounded_rectangle((x, y, x+155, y+171), radius=15, fill=accent if col == 1 else soft)
                    d.rounded_rectangle((x+35, y+104, x+120, y+127), radius=5, fill=bg)
            d.line((95, 568, 625, 568), fill=soft, width=8)
            d.line((95, 783, 625, 783), fill=soft, width=8)
        else:
            for col in range(2):
                x = 96+col*282
                d.rounded_rectangle((x, 390, x+246, 754), radius=20, fill=bg)
                for j in range(3):
                    y = 432+j*85
                    offset = (j % 2)*45 if col == 0 else 0
                    d.rounded_rectangle((x+25+offset, y, x+180+offset, y+62), radius=9, fill=soft if col == 0 else accent)
            d.line((324, 807, 396, 807), fill=accent, width=6)
            d.polygon([(395, 793), (412, 807), (395, 821)], fill=accent)
    else:
        d.rounded_rectangle((95, 373, 625, 755), radius=24, fill=bg)
        if slug.endswith("intro"):
            for x, y, color in ((133, 420, soft), (211, 558, accent)):
                d.rounded_rectangle((x, y, x+338, y+96), radius=22, fill=color)
                d.polygon([(x+40, y+86), (x+40, y+115), (x+74, y+86)], fill=color)
                for j in range(3):
                    d.ellipse((x+130+j*38, y+41, x+142+j*38, y+53), fill="#ffffff")
        elif slug.endswith("quote"):
            for x in (141, 207):
                d.ellipse((x, 419, x+47, 466), fill=accent)
                d.polygon([(x+5, 442), (x+41, 442), (x+18, 502), (x, 502)], fill=accent)
            for i, y in enumerate((543, 592, 641)):
                d.rounded_rectangle((141, y, 566-i*35, y+15), radius=7, fill=soft)
        else:
            d.ellipse((134, 424, 230, 520), fill=soft)
            d.ellipse((161, 442, 203, 484), fill=accent)
            d.rounded_rectangle((150, 486, 215, 510), radius=12, fill=accent)
            for i, y in enumerate((442, 480, 579, 625, 671)):
                x = 262 if i < 2 else 140
                d.rounded_rectangle((x, y, 564, y+14), radius=7, fill=soft)

    # Keep the bottom third clear for editable captions.
    d.text((54, 926), "示意画面 · 可替换为你的素材", font=small_font, fill=accent)
    d.line((54, 1200, 666, 1200), fill=soft, width=2)
    path = ROOT / f"{slug}.png"
    im.save(path, optimize=True)
    data = path.read_bytes()
    manifest.append(dict(id=f"starter-{slug}", file=path.name, name=name, category=category, tags=tags,
                         sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), width=720, height=1280))

(ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n")
print(f"Built {len(manifest)} original starter illustrations")
