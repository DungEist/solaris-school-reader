"""Inspect supplied/rebuilt Reader captures through configured PhotoCraft MCP.

Preview image bytes stay in local files; the ledger contains hashes and sizes.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "test-results/phase8-reader/photocraft"
OUTPUT.mkdir(parents=True, exist_ok=True)
environment = os.environ.copy()
for key in ("PHOTOCRAFT_CONTROL_PORT", "PHOTOCRAFT_CONTROL_TOKEN_FILE", "PHOTOCRAFT_CONTROL_TOKEN"):
    environment.pop(key, None)
process = subprocess.Popen(
    ["photocraft-cli", "mcp", "--no-gpu", "--automation-read-root", str(ROOT),
     "--automation-write-root", str(OUTPUT)], stdin=subprocess.PIPE,
    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
    env=environment,
)
counter = 0


def rpc(method, params, notification=False):
    global counter
    counter += 1
    message = {"jsonrpc": "2.0", "method": method, "params": params}
    if not notification:
        message["id"] = counter
    process.stdin.write(json.dumps(message) + "\n")
    process.stdin.flush()
    if notification:
        return None
    deadline = time.monotonic() + 55
    while time.monotonic() < deadline:
        if not select.select([process.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
            raise TimeoutError(method)
        line = process.stdout.readline()
        if not line:
            raise RuntimeError("PhotoCraft MCP ended")
        answer = json.loads(line)
        if answer.get("id") == counter:
            if answer.get("error") or answer.get("result", {}).get("isError"):
                raise RuntimeError(json.dumps(answer, ensure_ascii=False)[:1000])
            return answer["result"]
    raise TimeoutError(method)


captures = [
    ("game-chisa-tier", "pic/Screenshot From 2026-11-13 20-04-36.png"),
    ("reader-relationship-desktop", "test-results/phase8-reader/screenshots/relationship-desktop.jpg"),
    ("reader-relationship-mobile", "test-results/phase8-reader/screenshots/relationship-mobile.jpg"),
    ("reader-combined-gains", "test-results/phase8-reader/screenshots/combined-gains-desktop.jpg"),
    ("reader-chisa-option3", "test-results/phase8-reader/screenshots/1011-option-3-rejoin.jpg"),
    ("reader-request", "test-results/phase8-reader/screenshots/request-desktop.jpg"),
    ("reader-shop-receipt", "test-results/phase8-reader/screenshots/shop-receipt-desktop.jpg"),
]
ledger = []
try:
    initialized = rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                     "clientInfo": {"name": "solaris-reader-ui-check", "version": "1"}})
    rpc("notifications/initialized", {}, True)
    for label, path in captures:
        opened = rpc("tools/call", {"name": "doc_open", "arguments": {"path": path}})
        preview = rpc("tools/call", {"name": "doc_render_preview", "arguments": {"max_side": 1280}})
        pictures = [block for block in preview.get("content", []) if block.get("type") == "image"]
        if len(pictures) != 1:
            raise RuntimeError(f"Expected one preview for {path}")
        picture = pictures[0]
        pixels = base64.b64decode(picture["data"])
        filename = OUTPUT / (label + ".png")
        filename.write_bytes(pixels)
        ledger.append({"source": path, "source_sha256": hashlib.sha256((ROOT / path).read_bytes()).hexdigest(),
                       "opened": opened, "preview_path": str(filename.relative_to(ROOT)),
                       "preview_mime_type": picture["mimeType"], "preview_bytes": len(pixels),
                       "preview_sha256": hashlib.sha256(pixels).hexdigest()})
        rpc("tools/call", {"name": "doc_close", "arguments": {}})
    (OUTPUT / "review.json").write_text(json.dumps({"server": initialized.get("serverInfo"),
        "mode": "photocraft-cli MCP, headless CPU", "captures": ledger}, indent=2) + "\n")
    print(f"PASS: PhotoCraft MCP rendered {len(ledger)} local previews; test-results/phase8-reader/photocraft/review.json")
finally:
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
