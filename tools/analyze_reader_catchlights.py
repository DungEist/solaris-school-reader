#!/usr/bin/env python3
"""Measure rendered catchlights against the colored iris in Reader recordings.

Input is the JSON written by reader-catchlight-playback-check.mjs and its actual
PNG frames. No animation is synthesized and no browser is launched here. The
source geometry proves an open, stationary interval; this separate pixel pass
measures the white reflection within the colored iris, excluding the sclera,
the lower painted iris sheen and colored recording guides.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WHITE_MINIMUM = 212
WHITE_CHANNEL_SPREAD = 40


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bbox(value: Any) -> tuple[float, float, float, float]:
    """Return x, y, width, height from explicit rectangle metadata."""
    if isinstance(value, (list, tuple)) and len(value) == 4:
        return tuple(float(number) for number in value)
    if isinstance(value, dict):
        if all(key in value for key in ("x", "y", "width", "height")):
            return tuple(float(value[key]) for key in ("x", "y", "width", "height"))
        if all(key in value for key in ("minX", "minY", "maxX", "maxY")):
            return (float(value["minX"]), float(value["minY"]),
                    float(value["maxX"] - value["minX"]),
                    float(value["maxY"] - value["minY"]))
        for key in ("bounds", "bbox", "irisBounds", "irisBBox"):
            if key in value:
                return bbox(value[key])
    raise ValueError(f"Unknown iris rectangle: {value!r}")


def components(mask: np.ndarray) -> list[np.ndarray]:
    """Eight-connected pixel components; only small eye ROIs are visited."""
    seen = np.zeros(mask.shape, dtype=bool)
    height, width = mask.shape
    result = []
    for row, column in zip(*np.nonzero(mask)):
        if seen[row, column]:
            continue
        stack = [(int(row), int(column))]
        seen[row, column] = True
        points = []
        while stack:
            y, x = stack.pop()
            points.append((x, y))
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        result.append(np.asarray(points, dtype=np.int32))
    return result


def convex_hull(points: np.ndarray) -> list[tuple[int, int]]:
    ordered = sorted(set(map(tuple, points.tolist())))
    if len(ordered) < 3:
        return ordered

    def cross(origin, first, second):
        return ((first[0] - origin[0]) * (second[1] - origin[1])
                - (first[1] - origin[1]) * (second[0] - origin[0]))

    lower, upper = [], []
    for point in ordered:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(ordered):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def color_mask(rgb: np.ndarray, family: str, guide_colors: list[list[int]]) -> np.ndarray:
    red, green, blue = np.moveaxis(rgb.astype(np.int16), -1, 0)
    spread = np.max(rgb, axis=-1).astype(np.int16) - np.min(rgb, axis=-1)
    colored = (spread >= 25) & (np.max(rgb, axis=-1) >= 75)
    if family == "gold":
        colored &= (red >= green - 10) & (green >= blue + 12) & (red >= 90)
    elif family == "blue":
        colored &= (blue >= red + 12) & (green >= red + 8) & (blue >= 75)
    elif family == "green":
        # Verina's green iris has an olive/brown upper shade and amber pupil.
        # Its complete colored boundary encloses the upper white reflection;
        # selecting only green-dominant texels would keep just the lower half.
        colored &= (green >= red - 40) & (green >= blue + 12) & (green >= 55)
    for color in guide_colors:
        colored &= np.max(np.abs(rgb.astype(np.int16) - np.asarray(color[:3])), axis=-1) > 3
    return colored


def eye_sample(image: Image.Image, seed: tuple[float, float, float, float], family: str,
               previous: tuple[float, float] | None, guide_colors: list[list[int]]) -> dict[str, Any]:
    sx, sy, sw, sh = seed
    left, top = max(0, math.floor(sx)), max(0, math.floor(sy))
    right, bottom = min(image.width, math.ceil(sx + sw)), min(image.height, math.ceil(sy + sh))
    if right - left < 5 or bottom - top < 5:
        raise ValueError(f"Iris ROI is outside the recording: {seed}")
    rgb = np.asarray(image.convert("RGB"))[top:bottom, left:right]
    colored = color_mask(rgb, family, guide_colors)
    groups = [group for group in components(colored) if len(group) >= 12]
    if not groups:
        raise ValueError(f"No colored {family} iris pixels within {seed}")
    # The colored rim supplies the boundary. White holes inside it do not shift
    # this center when the catchlight moves, unlike averaging colored pixels.
    iris_pixels = max(groups, key=len)
    hull = convex_hull(iris_pixels)
    included = Image.new("L", (right - left, bottom - top))
    ImageDraw.Draw(included).polygon(hull, fill=255)
    iris_mask = np.asarray(included) > 0
    ix0, iy0 = iris_pixels.min(axis=0)
    ix1, iy1 = iris_pixels.max(axis=0)
    iris_center = (left + (int(ix0) + int(ix1)) / 2,
                   top + (int(iy0) + int(iy1)) / 2)
    iris_width, iris_height = int(ix1 - ix0 + 1), int(iy1 - iy0 + 1)
    white = ((np.min(rgb, axis=-1) >= WHITE_MINIMUM)
             & ((np.max(rgb, axis=-1).astype(np.int16) - np.min(rgb, axis=-1)) <= WHITE_CHANNEL_SPREAD)
             & iris_mask)
    # Source Abby has a large painted glint at the lower iris edge in addition
    # to the separately animated white dot. Track the compact upper reflection.
    rows = np.arange(rgb.shape[0])[:, None]
    white &= rows <= iy0 + iris_height * .70
    candidates = [group for group in components(white)
                  if 3 <= len(group) <= max(4, iris_mask.sum() * .20)]
    if not candidates:
        raise ValueError(f"No compact white reflection in the colored iris at {seed}")
    if previous is None:
        selected = max(candidates, key=len)
    else:
        def score(group):
            center = group.mean(axis=0) + (left, top)
            distance = np.linalg.norm(center - previous)
            return math.log1p(len(group)) - distance / max(3, iris_width * .2)
        selected = max(candidates, key=score)
    x0, y0 = selected.min(axis=0)
    x1, y1 = selected.max(axis=0)
    center = selected.mean(axis=0) + (left, top)
    return {
        "irisBoundary": [left + int(ix0), top + int(iy0), iris_width, iris_height],
        "irisCenter": list(iris_center), "coloredIrisPixels": int(len(iris_pixels)),
        "reflectionCenter": center.tolist(),
        "reflectionRelativeToIrisPixels": [float(center[0] - iris_center[0]), float(center[1] - iris_center[1])],
        "reflectionRelativeToIrisWidths": [float((center[0] - iris_center[0]) / iris_width),
                                          float((center[1] - iris_center[1]) / iris_height)],
        "reflectionBounds": [left + int(x0), top + int(y0), int(x1 - x0 + 1), int(y1 - y0 + 1)],
        "reflectionAreaPixels": int(len(selected)),
        "whitePixelsInUpperIris": int(white.sum()), "candidateComponentCount": len(candidates),
    }


def span(values: list[list[float]]) -> list[float]:
    data = np.asarray(values, dtype=float)
    return (data.max(axis=0) - data.min(axis=0)).tolist()


def flatten_numbers(value: Any) -> list[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [float(value)]
    if isinstance(value, dict):
        return [number for key in sorted(value) for number in flatten_numbers(value[key])]
    if isinstance(value, (list, tuple)):
        return [number for item in value for number in flatten_numbers(item)]
    return []


def stationary_geometry(frames: list[dict]) -> dict[str, Any]:
    checks = {}
    for key in ("root", "scale", "camera", "canvasRect", "irisVertices", "perEyeIrisBounds"):
        values = [flatten_numbers(frame[key]) for frame in frames if key in frame]
        if not values or not all(len(value) == len(values[0]) for value in values):
            checks[key] = {"observed": False}
            continue
        maximum = max(span(values), default=0)
        tolerance = .02 if key in ("irisVertices", "perEyeIrisBounds") else 1e-6
        checks[key] = {"observed": True, "maximumCoordinateSpan": maximum,
                       "tolerance": tolerance, "stationary": maximum <= tolerance}
    observed = [check for check in checks.values() if check["observed"]]
    return {"checks": checks,
            "stationary": len(observed) >= 4 and all(check["stationary"] for check in observed)}


def recording_eyes(case: dict, first: dict) -> list[dict]:
    eyes = case.get("recordingEyes") or case.get("eyes") or first.get("perEyeIrisBounds")
    if isinstance(eyes, dict):
        eyes = [{"name": name, "bounds": bounds} for name, bounds in eyes.items()]
    if not isinstance(eyes, list) or len(eyes) < 2:
        raise ValueError("Recording JSON needs both eyes' initial iris bounds.")
    explicit_recording = "recordingEyes" in case or case.get("irisCoordinateSpace") == "recording" or "mapping" in case
    crop = case.get("crop") or case.get("viewportCrop")
    destination = bbox(case.get("eyeCropInRecording", {"x": 24, "y": 52, "width": 672, "height": 220}))
    result = []
    for index, eye in enumerate(eyes):
        rectangle = bbox(eye)
        if not explicit_recording:
            if not crop:
                raise ValueError("Viewport iris bounds require an explicit crop mapping.")
            cx, cy, cw, ch = bbox(crop)
            dx, dy, dw, dh = destination
            x, y, width, height = rectangle
            rectangle = (dx + (x - cx) * dw / cw, dy + (y - cy) * dh / ch,
                         width * dw / cw, height * dh / ch)
        name = eye.get("name") or eye.get("side") or ("screen-left" if index == 0 else "screen-right")
        character = str(case.get("character", case.get("case", case.get("name", "")))).lower()
        family = eye.get("color") or ("gold" if "abby" in character and index == 0 else
                                     "blue" if "abby" in character else "green" if "verina" in character else "gold")
        center = eye.get("irisCenter")
        reference = (float(center["x"]), float(center["y"])) if explicit_recording and isinstance(center, dict) else (rectangle[0] + rectangle[2] / 2, rectangle[1] + rectangle[3] / 2)
        result.append({"name": name, "color": family, "seed": rectangle, "referenceCenter": reference})
    return result


def frame_path(frame: dict, index: int, case_name: str, input_directory: Path) -> Path:
    supplied = frame.get("file") or frame.get("framePath") or frame.get("path")
    if supplied:
        path = Path(supplied)
        for base in (input_directory, ROOT, input_directory / case_name):
            if (base / path).is_file():
                return (base / path).resolve()
    candidate = input_directory / case_name / f"frame-{index:04d}.png"
    if candidate.is_file():
        return candidate
    raise FileNotFoundError(f"Missing recorded PNG for {case_name} frame {index}: {supplied}")


def tracked_frame(image: Image.Image, samples: list[dict], eyes: list[dict], timestamp: float, path: Path) -> None:
    """Annotate a copy; original recorded pixels and timestamps stay intact."""
    result = image.copy()
    draw = ImageDraw.Draw(result)
    font_path = Path("/usr/share/fonts/TTF/DejaVuSans.ttf")
    font = ImageFont.truetype(str(font_path), 12) if font_path.exists() else ImageFont.load_default()
    captions = [f"t {timestamp:.3f} s"]
    for index, (sample, eye) in enumerate(zip(samples, eyes)):
        gx, gy = eye["referenceCenter"]
        draw.line((gx - 5, gy, gx + 5, gy), fill="#168a8a", width=1)
        draw.line((gx, gy - 5, gx, gy + 5), fill="#168a8a", width=1)
        x, y, width, height = sample["reflectionBounds"]
        # The one-pixel margin leaves the actual white dot completely visible.
        draw.rectangle((x - 1, y - 1, x + width, y + height), outline="#d44755", width=1)
        dx, dy = sample["reflectionRelativeToFixedIrisGuidePixels"]
        captions.append(f"{'L' if index == 0 else 'R'} dot ({dx:.2f}, {dy:.2f}) px")
    # Keep the metrics above the original iris-guide caption at baseline 300.
    draw.text((24, 272), "  |  ".join(captions), fill="#27302e", font=font)
    result.save(path)


def contactsheet(case_name: str, frames: list[dict], tracks: list[dict], paths: list[Path], eyes: list[dict], output: Path) -> Path:
    indices = {0, len(frames) - 1}
    for eye in range(len(eyes)):
        positions = [sample["eyes"][eye]["reflectionRelativeToIrisPixels"][0] for sample in tracks]
        areas = [sample["eyes"][eye]["reflectionAreaPixels"] for sample in tracks]
        indices.update((int(np.argmin(positions)), int(np.argmax(positions)), int(np.argmin(areas)), int(np.argmax(areas))))
    chosen = sorted(indices)[:6]
    for index in range(min(6, len(frames))):
        if len(chosen) >= 6:
            break
        if index not in chosen:
            chosen.append(index)
    chosen.sort()
    cell_width, cell_height = 190, 204
    sheet = Image.new("RGB", (cell_width * len(chosen), 34 + cell_height * len(eyes)), "#1a2330")
    font_path = Path("/usr/share/fonts/TTF/DejaVuSans.ttf")
    font = ImageFont.truetype(str(font_path), 12) if font_path.exists() else ImageFont.load_default()
    draw = ImageDraw.Draw(sheet)
    draw.text((10, 8), f"{case_name}: actual frame pixels; red box tracks the white reflection", fill="white", font=font)
    for column, index in enumerate(chosen):
        image = Image.open(paths[index]).convert("RGB")
        for row, eye in enumerate(eyes):
            sample = tracks[index]["eyes"][row]
            x, y, width, height = eye["seed"]
            box = (math.floor(x - 4), math.floor(y - 4), math.ceil(x + width + 4), math.ceil(y + height + 4))
            closeup = image.crop(box)
            annotation = ImageDraw.Draw(closeup)
            rx, ry, rw, rh = sample["reflectionBounds"]
            annotation.rectangle((rx - box[0] - 1, ry - box[1] - 1, rx + rw - box[0], ry + rh - box[1]), outline="#ff6666", width=1)
            factor = min(174 / closeup.width, 154 / closeup.height)
            closeup = closeup.resize((round(closeup.width * factor), round(closeup.height * factor)), Image.Resampling.NEAREST)
            left, top = column * cell_width + 8, 34 + row * cell_height
            draw.text((left, top), f"{eye['name']}  {tracks[index]['timeSeconds']:.3f}s", font=font, fill="#a6dff0")
            sheet.paste(closeup, (left, top + 20))
            dx, dy = sample["reflectionRelativeToIrisPixels"]
            draw.text((left, top + 178), f"dot ({dx:.2f}, {dy:.2f}), area {sample['reflectionAreaPixels']}", font=font, fill="white")
    path = output / "tracked-contact-sheet.png"
    sheet.save(path)
    return path


def analyze_case(case: dict, input_directory: Path, output: Path) -> dict:
    case_name = case.get("case") or case.get("name") or case.get("id") or case.get("target", {}).get("name")
    input_directory = Path(case.get("directory", input_directory))
    case = {**case, "character": case.get("character") or case.get("target", {}).get("character") or case_name}
    frames = case["frames"]
    if not case_name or len(frames) < 20:
        raise ValueError("Each case needs a name and at least 20 actual recorded frames.")
    eyes = recording_eyes(case, frames[0])
    # The recorder's fixed center guide is #168a8a. It cannot be a white
    # reflection, and removing it also keeps the iris boundary purely painted.
    guide_colors = case.get("guideColors", [[22, 138, 138]] if "mapping" in case else [])
    tracked_directory = input_directory / "tracked-frames"
    tracked_directory.mkdir(exist_ok=True)
    previous = [None] * len(eyes)
    tracks, paths = [], []
    for index, frame in enumerate(frames):
        path = frame_path(frame, index, case_name, input_directory)
        image = Image.open(path).convert("RGB")
        samples = []
        for eye_index, eye in enumerate(eyes):
            sample = eye_sample(image, eye["seed"], eye["color"], previous[eye_index], guide_colors)
            sample["name"] = eye["name"]
            sample["fixedIrisGuideCenter"] = list(eye["referenceCenter"])
            sample["reflectionRelativeToFixedIrisGuidePixels"] = [sample["reflectionCenter"][axis] - eye["referenceCenter"][axis] for axis in (0, 1)]
            previous[eye_index] = tuple(sample["reflectionCenter"])
            samples.append(sample)
        annotated = tracked_directory / f"frame-{index:04d}.png"
        tracked_frame(image, samples, eyes, float(frame["timeSeconds"]), annotated)
        tracks.append({"frame": index, "timeSeconds": float(frame["timeSeconds"]),
                       "eyeTrackTime": frame.get("eyeTrackTime"),
                       "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
                       "sha256": digest(path),
                       "trackedFrame": str(annotated.relative_to(ROOT)) if annotated.is_relative_to(ROOT) else str(annotated),
                       "trackedSha256": digest(annotated), "eyes": samples})
        paths.append(path)
    eye_summaries = []
    for index, eye in enumerate(eyes):
        samples = [track["eyes"][index] for track in tracks]
        movement = span([sample["reflectionRelativeToIrisPixels"] for sample in samples])
        boundary = span([sample["irisBoundary"] for sample in samples])
        center_span = span([sample["irisCenter"] for sample in samples])
        dimensions = span([sample["reflectionBounds"][2:] for sample in samples])
        areas = [sample["reflectionAreaPixels"] for sample in samples]
        area_variation = (max(areas) - min(areas)) / max(1, min(areas))
        changed = max(movement) >= .4 or max(dimensions) >= 1 or area_variation >= .10
        eye_summaries.append({"eye": eye["name"], "color": eye["color"],
                              "reflectionCentroidSpanRelativeToIrisPixels": movement,
                              "reflectionCentroidSpanRelativeToFixedIrisGuidePixels": span([sample["reflectionRelativeToFixedIrisGuidePixels"] for sample in samples]),
                              "reflectionCentroidSpanRelativeToIrisWidths": span([sample["reflectionRelativeToIrisWidths"] for sample in samples]),
                              "reflectionWidthHeightSpanPixels": dimensions,
                              "reflectionAreaRangePixels": [min(areas), max(areas)],
                              "reflectionAreaVariationFraction": area_variation,
                              "irisBoundaryCoordinateSpanPixels": boundary,
                              "irisCenterSpanPixels": center_span,
                              "coloredIrisStationary": max(center_span) <= 1.5 and max(boundary) <= 2,
                              "whiteReflectionChanges": changed})
    stationary = stationary_geometry(frames)
    duration = tracks[-1]["timeSeconds"] - tracks[0]["timeSeconds"]
    expected_eye = case.get("target", {}).get("eye")
    open_eye = bool(expected_eye) and all(frame.get("animation") == expected_eye
                                         and frame.get("loop") is True
                                         and frame.get("timeScale") == 1 for frame in frames)
    video_path = input_directory / "close-up.webm"
    video = {"path": str(video_path.relative_to(ROOT)) if video_path.is_relative_to(ROOT) else str(video_path),
             "sha256": digest(video_path), "byteLength": video_path.stat().st_size} if video_path.is_file() else None
    contact = contactsheet(case_name, frames, tracks, paths, eyes, input_directory)
    track_path = input_directory / "pixel-tracks.json"
    track_path.write_text(json.dumps({"case": case_name, "frames": tracks}, indent=2) + "\n")
    result = {"case": case_name,
            "result": "PASS" if stationary["stationary"] and open_eye and duration >= 1
            and all(eye["coloredIrisStationary"] and eye["whiteReflectionChanges"] for eye in eye_summaries) else "REVIEW",
            "frameCount": len(frames), "durationSeconds": duration,
            "geometry": stationary, "eyes": eye_summaries, "openEyeAtOriginalSpeed": open_eye,
            "target": case.get("target"), "recordingMapping": case.get("mapping"),
            "recording": video or case.get("recording"),
            "sourceHashes": case.get("sourceHashes", {}),
            "measurementsSha256": digest(input_directory / "measurements.json") if (input_directory / "measurements.json").is_file() else None,
            "analyzerSha256": digest(Path(__file__)),
            "trackedFrames": str(tracked_directory.relative_to(ROOT)) if tracked_directory.is_relative_to(ROOT) else str(tracked_directory),
            "trackedFrameAnnotations": "Thin red boxes surround the independently measured upper white reflection; fixed teal iris-center marks and timestamped offsets use the original recording iris guide. All raw frames remain untouched.",
            "pixelTracks": str(track_path.relative_to(ROOT)) if track_path.is_relative_to(ROOT) else str(track_path),
            "contactSheet": str(contact.relative_to(ROOT)) if contact.is_relative_to(ROOT) else str(contact)}
    (input_directory / "pixel-analysis.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "test-results/reader-catchlights/playback/production-browser-result.json")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/reader-catchlights/playback/pixel-analysis")
    args = parser.parse_args()
    source = json.loads(args.input.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    if "measurements" in source:
        cases = []
        for item in source["measurements"]:
            directory = Path(item["directory"])
            if not directory.is_absolute():
                directory = ROOT / directory
            case = json.loads((directory / "measurements.json").read_text())
            case["directory"] = str(directory)
            cases.append(case)
    else:
        cases = source.get("cases") or source.get("recordings") or [source]
    if not cases:
        raise ValueError("No completed Reader recording is present in the input JSON.")
    for case in cases:
        case["sourceHashes"] = source.get("hashes", case.get("sourceHashes", {}))
    results = [analyze_case(case, args.input.parent, args.output) for case in cases]
    report = {"result": "PASS" if all(case["result"] == "PASS" for case in results) else "REVIEW",
              "input": str(args.input), "inputSha256": digest(args.input), "analyzerSha256": digest(Path(__file__)),
              "sourceHashes": source.get("hashes", {}),
              "method": "Actual RGB PNG pixels: a saturated colored-iris rim supplies a convex boundary; track the largest compact upper white reflection component through that boundary. Its centroid, dimensions and area are measured relative to the iris independently of the recorded source geometry.",
              "thresholds": {"whiteMinimumRgbChannel": WHITE_MINIMUM, "maximumWhiteChannelSpread": WHITE_CHANNEL_SPREAD,
                             "maximumIrisCenterSpanPixels": 1.5, "maximumIrisBoundarySpanPixels": 2,
                             "minimumReflectionCentroidSpanPixels": .4, "minimumReflectionDimensionSpanPixels": 1,
                             "minimumReflectionAreaVariationFraction": .10},
              "cases": results}
    path = args.output / "pixel-summary.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"result": report["result"], "output": str(path), "cases": results}, indent=2))
    if report["result"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
