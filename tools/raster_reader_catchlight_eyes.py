#!/usr/bin/env python3
"""Raster source Spine eye geometry with its atlas, draw order and clip polygons.

This is a source-evidence illustration, not a native game framebuffer. Input
comes from audit_reader_catchlight_eyes.mjs. It never changes serving assets.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent


def polygon_mask(x, y, polygon):
    result = np.zeros(x.shape, dtype=bool)
    previous = polygon[-1]
    for current in polygon:
        ax, ay = previous
        bx, by = current
        crossing = ((ay > y) != (by > y)) & (x < (bx - ax) * (y - ay) / ((by - ay) or 1e-20) + ax)
        result ^= crossing
        previous = current
    return result


def render(frame, texture, bounds, size):
    left, bottom, right, top = bounds
    width, height = size
    result = np.zeros((height, width, 4), dtype=np.float32)
    # A neutral background makes pale reflections visible in transparent crops.
    result[:, :, :3] = [0.28, 0.35, 0.41]
    result[:, :, 3] = 1
    clipping = None
    clip_end = None
    source_height, source_width = texture.shape[:2]
    for layer in frame["layers"]:
        points = np.array(layer["vertices"], dtype=float).reshape(-1, 2)
        if layer["type"] == "ClippingAttachment":
            # Spine ignores nested starts until the active clipping ends.
            if clipping is None:
                clipping = points
                clip_end = layer["endSlot"]
            continue
        if not layer.get("uvs"):
            if layer["slotIndex"] == clip_end:
                clipping = None
                clip_end = None
            continue
        uvs = np.array(layer["uvs"], dtype=float).reshape(-1, 2)
        color = np.array(layer.get("color", [1, 1, 1, 1]), dtype=float)
        if color[3] <= 0:
            if layer["slotIndex"] == clip_end:
                clipping = None
                clip_end = None
            continue
        # Write each mesh into its own buffer; triangle shared edges composite once.
        mesh = np.zeros_like(result)
        for tri in np.array(layer["triangles"]).reshape(-1, 3):
            p = points[tri]
            screen_x = (p[:, 0] - left) / (right - left) * width
            screen_y = (top - p[:, 1]) / (top - bottom) * height
            x0 = max(0, math.floor(screen_x.min()))
            x1 = min(width, math.ceil(screen_x.max()))
            y0 = max(0, math.floor(screen_y.min()))
            y1 = min(height, math.ceil(screen_y.max()))
            if x0 >= x1 or y0 >= y1:
                continue
            grid_y, grid_x = np.mgrid[y0:y1, x0:x1]
            x = left + (grid_x + 0.5) / width * (right - left)
            y = top - (grid_y + 0.5) / height * (top - bottom)
            a, b, c = p
            denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(denominator) < 1e-9:
                continue
            wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator
            wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator
            wc = 1 - wa - wb
            inside = (wa >= -1e-7) & (wb >= -1e-7) & (wc >= -1e-7)
            if clipping is not None:
                inside &= polygon_mask(x, y, clipping)
            if not inside.any():
                continue
            uv = wa[:, :, None] * uvs[tri[0]] + wb[:, :, None] * uvs[tri[1]] + wc[:, :, None] * uvs[tri[2]]
            tx = np.clip(uv[:, :, 0] * source_width - 0.5, 0, source_width - 1.00001)
            ty = np.clip(uv[:, :, 1] * source_height - 0.5, 0, source_height - 1.00001)
            ix, iy = np.floor(tx).astype(int), np.floor(ty).astype(int)
            fx, fy = (tx - ix)[:, :, None], (ty - iy)[:, :, None]
            samples = (texture[iy, ix] * (1 - fx) * (1 - fy)
                       + texture[iy, ix + 1] * fx * (1 - fy)
                       + texture[iy + 1, ix] * (1 - fx) * fy
                       + texture[iy + 1, ix + 1] * fx * fy) * color / 255
            target = mesh[y0:y1, x0:x1]
            target[inside] = samples[inside]
        alpha = mesh[:, :, 3:4]
        blend = layer.get("blendMode", 0)
        if blend == 1:
            result[:, :, :3] = mesh[:, :, :3] * alpha + result[:, :, :3]
        elif blend == 2:
            # Native straight-alpha DST_COLOR / ONE_MINUS_SRC_ALPHA.
            result[:, :, :3] = mesh[:, :, :3] * result[:, :, :3] + result[:, :, :3] * (1 - alpha)
        elif blend == 3:
            result[:, :, :3] = mesh[:, :, :3] + result[:, :, :3] * (1 - mesh[:, :, :3])
        else:
            result[:, :, :3] = mesh[:, :, :3] * alpha + result[:, :, :3] * (1 - alpha)
        if layer["slotIndex"] == clip_end:
            clipping = None
            clip_end = None
    return Image.fromarray(np.uint8(np.clip(result[:, :, :3], 0, 1) * 255))


def default_bounds(frame):
    if frame.get("cropBounds"):
        return frame["cropBounds"]
    if frame.get("eyePoints"):
        points = np.array(frame["eyePoints"])
    else:
        layers = [layer for layer in frame["layers"] if layer.get("eyeRole") or
                  "face" in layer["attachment"] or "wink" in layer["attachment"] or
                  "感动眼" in layer["attachment"] or "得意" in layer["attachment"]]
        points = np.concatenate([np.array(layer["vertices"]).reshape(-1, 2) for layer in layers])
    left, bottom = points.min(axis=0)
    right, top = points.max(axis=0)
    pad = max((right - left) * 0.08, (top - bottom) * 0.08)
    return [float(left - pad), float(bottom - pad), float(right + pad), float(top + pad)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--width", type=int, default=900)
    parser.add_argument("--group-by-character", action="store_true")
    args = parser.parse_args()
    document = json.loads(args.input.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    cache = {}
    previews = []
    entries = []
    for index, frame in enumerate(document["frames"]):
        path = frame["texture"]
        if path not in cache:
            cache.clear()
            cache[path] = np.array(Image.open(ROOT / path).convert("RGBA"), dtype=np.uint8)
        bounds = default_bounds(frame)
        height = max(140, round(args.width * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0])))
        picture = render(frame, cache[path], bounds, (args.width, height))
        phase_label = "blink" if frame.get("phase") == "blink" else "mapped eye pose"
        label = f"{frame['slug']} {frame['id']} {phase_label} t={frame.get('time', 0):.4f}s"
        draw = ImageDraw.Draw(picture)
        draw.text((8, 8), label + " | source X increases to the right", fill="white", stroke_width=1, stroke_fill="black")
        filename = f"{frame['slug']}-{frame['id']}-{frame.get('phase', 'open')}-{index:03d}.png"
        destination = args.output / frame["slug"] if args.group_by_character else args.output
        destination.mkdir(parents=True, exist_ok=True)
        picture.save(destination / filename)
        entries.append({"file": str((destination / filename).relative_to(ROOT)) if destination.is_relative_to(ROOT) else str(destination / filename),
                        "slug": frame["slug"], "expressionId": frame["id"], "phase": frame.get("phase", "open"),
                        "time": frame.get("time", 0), "sourceCropBounds": bounds})
        ratio = 600 / picture.width
        previews.append((frame["slug"], picture.resize((600, round(picture.height * ratio)), Image.Resampling.LANCZOS)))
    def contact_sheet(pictures, path):
        max_height = max(image.height for image in pictures)
        sheet = Image.new("RGB", (1200, math.ceil(len(pictures) / 2) * (max_height + 24)), "#485969")
        for index, preview in enumerate(pictures):
            sheet.paste(preview, ((index % 2) * 600, (index // 2) * (max_height + 24)))
        sheet.save(path)
    sheets = {}
    if args.group_by_character:
        groups = {}
        for slug, preview in previews:
            groups.setdefault(slug, []).append(preview)
        for slug, pictures in groups.items():
            path = args.output / slug / "contact-sheet.png"
            contact_sheet(pictures, path)
            sheets[slug] = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)
        contact_sheet([pictures[0] for pictures in groups.values()], args.output / "contact-sheet.png")
    else:
        contact_sheet([preview for _, preview in previews], args.output / "contact-sheet.png")
    (args.output / "manifest.json").write_text(json.dumps({"authority": "software-rasterized-source-meshes", "entries": entries, "contactSheets": sheets}, indent=2) + "\n")
    print(json.dumps({"snapshots": len(entries), "output": str(args.output)}))


if __name__ == "__main__":
    main()
