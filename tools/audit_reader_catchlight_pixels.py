#!/usr/bin/env python3
"""Corroborate source catchlight labels using the actual mesh UV texels.

Run after audit_reader_catchlights.mjs. Pillow is already used by this repo's
local asset verification. This reads serving textures and makes a compact
contact sheet; it does not modify any source/serving asset.
"""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "test-results/reader-catchlights"
source = json.loads((DIRECTORY / "source-assets.json").read_text())
checks = []
previews = []
font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", 14) if Path("/usr/share/fonts/TTF/DejaVuSans.ttf").exists() else ImageFont.load_default()

for character in source["characters"]:
    texture_info = character["assets"]["texture"]
    texture_path = ROOT / texture_info["path"]
    texture_bytes = texture_path.read_bytes()
    assert hashlib.sha256(texture_bytes).hexdigest() == texture_info["sha256"]
    texture = Image.open(texture_path).convert("RGBA")
    assert list(texture.size) == texture_info["atlasDimensions"]
    seen = set()
    for clip in character["eyeClips"]:
        for catchlight in clip.get("catches", []):
            identity = (catchlight["slot"], catchlight["attachment"], tuple(catchlight["sourceUVs"]))
            if identity in seen:
                continue
            seen.add(identity)
            uvs = catchlight["sourceUVs"]
            points = [(uvs[index] * texture.width, uvs[index + 1] * texture.height) for index in range(0, len(uvs), 2)]
            if not points:
                continue
            left = max(0, math.floor(min(point[0] for point in points)))
            top = max(0, math.floor(min(point[1] for point in points)))
            right = min(texture.width, math.ceil(max(point[0] for point in points)))
            bottom = min(texture.height, math.ceil(max(point[1] for point in points)))
            crop = texture.crop((left, top, right, bottom))
            mask = Image.new("L", crop.size, 0)
            draw = ImageDraw.Draw(mask)
            triangles = catchlight["sourceTriangles"]
            for index in range(0, len(triangles), 3):
                polygon = [(points[triangles[index + offset]][0] - left, points[triangles[index + offset]][1] - top) for offset in range(3)]
                draw.polygon(polygon, fill=255)
            visible = []
            whites = []
            alpha = crop.getchannel("A")
            crop_pixels = crop.get_flattened_data() if hasattr(crop, "get_flattened_data") else crop.getdata()
            mask_pixels = mask.get_flattened_data() if hasattr(mask, "get_flattened_data") else mask.getdata()
            for index, ((red, green, blue, opacity), included) in enumerate(zip(crop_pixels, mask_pixels)):
                if included and opacity >= 32:
                    visible.append((red, green, blue))
                    # Texture evidence only: this threshold is not an animation
                    # or rendering rule. Blue/cream antialiasing stays visible.
                    if min(red, green, blue) >= 180 and max(red, green, blue) - min(red, green, blue) <= 80:
                        whites.append((left + index % crop.width, top + index // crop.width))
                if not included:
                    alpha.putpixel((index % crop.width, index // crop.width), 0)
            crop.putalpha(alpha)
            assert whites, f"No white UV texels in {character['slug']} / {catchlight['slot']}"
            checks.append({
                "character": character["slug"], "slot": catchlight["slot"], "attachment": catchlight["attachment"],
                "atlasRegion": catchlight["atlasRegion"], "firstExpression": clip["expressions"][0] if clip["expressions"] else None,
                "texturePath": texture_info["path"], "textureSha256": texture_info["sha256"],
                "sourceUvBoundsPixels": [left, top, right, bottom], "uvMaskedVisibleTexels": len(visible),
                "uvMaskedWhiteTexels": len(whites), "whiteFractionOfVisibleTexels": len(whites) / len(visible),
                "whiteTexelBoundsPixels": [min(point[0] for point in whites), min(point[1] for point in whites), max(point[0] for point in whites), max(point[1] for point in whites)],
            })
            scale = min(220 / crop.width, 140 / crop.height, 4)
            crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.NEAREST)
            previews.append((character["slug"], catchlight["slotIndex"], crop))

width, cell_height, columns = 750, 200, 3
sheet = Image.new("RGB", (width, math.ceil(len(previews) / columns) * cell_height), "#5c7081")
draw = ImageDraw.Draw(sheet)
for index, (slug, slot_index, crop) in enumerate(previews):
    left = index % columns * (width // columns)
    top = index // columns * cell_height
    draw.text((left + 12, top + 10), f"{slug}: source slot {slot_index}", font=font, fill="white")
    sheet.paste(crop, (left + 12, top + 42), crop)
sheet_path = DIRECTORY / "source-catchlight-uv-contact-sheet.png"
sheet.save(sheet_path)
report = {
    "result": "PASS", "method": "Actual serving atlas texels selected by the parsed Spine mesh UV triangles; alpha >=32, white RGB channels >=180 with spread <=80.",
    "scope": "Confirms white texels in the source catchlight cutouts. Animation classification remains the independent iris-relative native-mesh audit.",
    "textureCount": len({check["texturePath"] for check in checks}), "uniqueCatchlightCutouts": len(checks),
    "contactSheet": str(sheet_path.relative_to(ROOT)), "checks": checks,
}
(DIRECTORY / "source-catchlight-texels.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({key: report[key] for key in ["result", "textureCount", "uniqueCatchlightCutouts", "contactSheet"]}))
