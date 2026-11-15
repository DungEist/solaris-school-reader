#!/usr/bin/env python3
"""Resolve source alpha-probe blink ambiguity with final RGB layer ablations.

Run after audit_reader_catchlight_eyes.mjs and source-blink snapshot selection.
The same native meshes/UVs/clips are drawn with and without the verified iris
or reflection layer; empty slots remain in draw order to end clipping.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from raster_reader_catchlight_eyes import ROOT, default_bounds, render


def without(frame, role):
    result = copy.deepcopy(frame)
    for layer in result["layers"]:
        if layer.get("eyeRole") == role:
            layer.update(type="EmptyAttachment", vertices=[], uvs=[], triangles=[])
    return result


def hue_array(rgb):
    value = rgb.astype(float) / 255
    maximum = value.max(axis=2)
    minimum = value.min(axis=2)
    difference = maximum - minimum
    safe = np.where(difference > 0, difference, 1)
    hue = np.zeros(maximum.shape, dtype=float)
    red, green, blue = value[:, :, 0], value[:, :, 1], value[:, :, 2]
    hue[maximum == red] = ((green - blue) / safe)[maximum == red]
    hue[maximum == green] = (2 + (blue - red) / safe)[maximum == green]
    hue[maximum == blue] = (4 + (red - green) / safe)[maximum == blue]
    return (hue * 60 + 360) % 360


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("source_eyes", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--width", type=int, default=1500)
    args = parser.parse_args()
    args.input = args.input.resolve()
    args.source_eyes = args.source_eyes.resolve()
    args.output = args.output.resolve()
    frames = json.loads(args.input.read_text())["frames"]
    report = json.loads(args.source_eyes.read_text())
    compositions = {composition["key"]: composition for character in report["characters"] for composition in character["compositions"]}
    args.output.mkdir(parents=True, exist_ok=True)
    textures = {}
    observations = []
    for index, frame in enumerate(frames):
        print(f"RGB layer ablation: {frame['slug']} {frame['id']} {frame['phase']} t={frame['time']:.6f}s", flush=True)
        path = frame["texture"]
        if path not in textures:
            textures.clear()
            textures[path] = np.array(Image.open(ROOT / path).convert("RGBA"), dtype=np.uint8)
        texture = textures[path]
        bounds = default_bounds(frame)
        height = max(140, round(args.width * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0])))
        size = (args.width, height)
        full = render(frame, texture, bounds, size)
        no_reflection = render(without(frame, "separate-catchlight"), texture, bounds, size)
        no_iris = render(without(frame, "iris"), texture, bounds, size)
        rgb = np.array(full, dtype=np.int16)
        reflection_delta = np.abs(rgb - np.array(no_reflection, dtype=np.int16)).max(axis=2)
        iris_delta = np.abs(rgb - np.array(no_iris, dtype=np.int16)).max(axis=2)
        minimum, maximum = rgb.min(axis=2), rgb.max(axis=2)
        white = (minimum >= 180) & ((maximum - minimum) <= 80)
        hue = hue_array(rgb)
        # Cartethyia's atlas-verified irises are blue/purple. A layer ablation
        # excludes painted blue lash accents and surrounding pink/gold art.
        colored_iris = ((maximum - minimum) >= 45) & (maximum >= 55) & (hue >= 160) & (hue <= 300)
        composition = compositions[frame["compositionKey"]]
        row = {"compositionKey": frame["compositionKey"], "expressionId": frame["id"], "phase": frame["phase"],
               "time": frame["time"], "sourceCropBounds": bounds, "rasterSize": list(size), "eyes": []}
        for eye in composition["eyes"]:
            box = eye["sourceIrisBounds"]
            left, bottom, right, top = bounds
            x0 = max(0, int((box["left"] - left) / (right - left) * size[0]))
            x1 = min(size[0], int(np.ceil((box["right"] - left) / (right - left) * size[0])))
            y0 = max(0, int((top - box["top"]) / (top - bottom) * size[1]))
            y1 = min(size[1], int(np.ceil((top - box["bottom"]) / (top - bottom) * size[1])))
            selection = np.s_[y0:y1, x0:x1]
            # A 1-byte threshold records even faint measurable contributions;
            # the 5-byte count separately reports visibly distinct patches.
            white_one = int((white[selection] & (reflection_delta[selection] >= 1)).sum())
            white_five = int((white[selection] & (reflection_delta[selection] >= 5)).sum())
            iris_one = int((colored_iris[selection] & (iris_delta[selection] >= 1)).sum())
            iris_five = int((colored_iris[selection] & (iris_delta[selection] >= 5)).sum())
            row["eyes"].append({"eye": eye["eye"], "sourceIrisBounds": box,
                "whiteReflectionPixelsWithAtLeastOneByteContribution": white_one,
                "whiteReflectionPixelsWithAtLeastFiveByteContribution": white_five,
                "coloredIrisPixelsWithAtLeastOneByteContribution": iris_one,
                "coloredIrisPixelsWithAtLeastFiveByteContribution": iris_five,
                "maximumReflectionLayerByteContribution": int(reflection_delta[selection].max()),
                "maximumIrisLayerByteContribution": int(iris_delta[selection].max()),
                "reflectionPixelVerdict": "hidden-white-catchlight" if white_one == 0 else "visible-white-catchlight",
                "irisPixelVerdict": "closed-without-colored-iris" if iris_one == 0 else "authored-colored-iris-residual"})
        filename = f"{frame['slug']}-{frame['id']}-{frame['phase']}-{index:03d}"
        for suffix, picture in [("source", full), ("without-reflection", no_reflection), ("without-iris", no_iris)]:
            image_path = args.output / f"{filename}-{suffix}.png"
            picture.save(image_path)
            row[suffix.replace('-', '_') + "Image"] = {"path": str(image_path.relative_to(ROOT)),
                "sha256": hashlib.sha256(image_path.read_bytes()).hexdigest()}
        # Make faint residuals reviewable while keeping the actual source PNGs.
        difference = Image.fromarray(np.uint8(np.clip(iris_delta * 8, 0, 255)))
        difference_path = args.output / f"{filename}-iris-difference-8x.png"
        difference.save(difference_path)
        row["irisDifferenceImage"] = str(difference_path.relative_to(ROOT))
        observations.append(row)
    result = {"authority": "native-mesh-atlas-and-draw-order-RGB-layer-ablation", "sourceEyesBeforeConfirmationSha256": hashlib.sha256(args.source_eyes.read_bytes()).hexdigest(),
        "method": "Software raster of supplied native world vertices, UV triangles, atlas RGBA, slot colors, straight-alpha GL blend factors and original clipping; ablated attachments become empty slots so native clipping ends remain intact. Pixels are measured before captions.",
        "thresholds": {"whiteMinimumRgb": 180, "maximumWhiteRgbSpread": 80, "bluePurpleIrisHueDegrees": [160, 300], "minimumIrisChannelSpread": 45,
                       "minimumIrisMaximumChannel": 55, "minimumMeasuredByteContribution": 1, "distinctPatchByteContribution": 5},
        "scope": "Resolves the two Cartethyia thinking-blink compositions whose conservative alpha probes never reported a fully closed eye; normal open frames are positive controls.",
        "observations": observations}
    output = args.output.parent / "source-blink-occlusion-confirmation.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    for observation in observations:
        if observation["phase"] != "blink":
            continue
        composition = compositions[observation["compositionKey"]]
        composition["blink"]["finalRgbConfirmation"] = {"path": str(output.relative_to(ROOT)), "time": observation["time"],
            "rasterSize": observation["rasterSize"], "eyes": observation["eyes"], "sourceImage": observation["sourceImage"]}
    args.source_eyes.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output), "observations": len(observations),
        "blinkVerdicts": [{"compositionKey": row["compositionKey"], "eyes": row["eyes"]} for row in observations if row["phase"] == "blink"]}))


if __name__ == "__main__":
    main()
