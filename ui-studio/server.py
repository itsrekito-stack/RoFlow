from __future__ import annotations

import argparse
import json
import mimetypes
import re
import subprocess
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT: Optional[Path] = None
CACHE_LIMIT = 256
BRIDGE_VERSION = 7

_thumbnail_cache: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()


def fetch_url(url: str, timeout: float = 8.0) -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "RoFlowUIStudio/1.0",
            "Accept": "application/json,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(), resp.headers.get_content_type() or "application/octet-stream"


def roblox_thumbnail(asset_id: str) -> Optional[tuple[bytes, str]]:
    cached = _thumbnail_cache.get(asset_id)
    if cached is not None:
        _thumbnail_cache.move_to_end(asset_id)
        return cached

    query = urllib.parse.urlencode(
        {
            "assetIds": asset_id,
            "returnPolicy": "PlaceHolder",
            "size": "420x420",
            "format": "Png",
            "isCircular": "false",
        }
    )

    image_url = None
    for attempt in range(4):
        try:
            raw, _ = fetch_url("https://thumbnails.roblox.com/v1/assets?" + query)
            rows = (json.loads(raw.decode("utf-8")).get("data") or [])
            if rows:
                image_url = rows[0].get("imageUrl")
                if image_url:
                    break
        except Exception:
            if attempt == 3:
                return None
        time.sleep(0.2 + attempt * 0.15)

    if not image_url:
        return None

    try:
        body, content_type = fetch_url(image_url)
    except Exception:
        return None

    if not content_type.startswith("image/"):
        return None

    result = (body, content_type)
    _thumbnail_cache[asset_id] = result
    _thumbnail_cache.move_to_end(asset_id)
    while len(_thumbnail_cache) > CACHE_LIMIT:
        _thumbnail_cache.popitem(last=False)
    return result


def run_git(*args: str, timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    if PROJECT_ROOT is None:
        raise RuntimeError("No project was supplied to the developer server")
    return subprocess.run(
        ["git", *args],
        cwd=str(PROJECT_ROOT),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def git_status_payload() -> dict:
    if PROJECT_ROOT is None:
        return {
            "ok": False,
            "error": "No project configured. Start with --project <path> or use RoFlow desktop.",
        }

    inside = run_git("rev-parse", "--is-inside-work-tree")
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return {"ok": False, "error": "Configured project is not a Git working tree"}

    head = run_git("rev-parse", "HEAD")
    subject = run_git("log", "-1", "--pretty=%s")
    branch = run_git("branch", "--show-current")
    status = run_git("status", "--porcelain")
    return {
        "ok": True,
        "root": str(PROJECT_ROOT),
        "head": head.stdout.strip() if head.returncode == 0 else "",
        "subject": subject.stdout.strip() if subject.returncode == 0 else "",
        "branch": branch.stdout.strip() if branch.returncode == 0 else "",
        "dirty": bool(status.stdout.strip()),
        "changes": status.stdout.splitlines()[:50],
    }


class RoFlowUIHandler(SimpleHTTPRequestHandler):
    server_version = "RoFlowUIStudio/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print("[RoFlow UI]", fmt % args)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def json_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/health":
            self.json_response(
                200,
                {
                    "ok": True,
                    "server": "RoFlow UI Studio",
                    "bridge": BRIDGE_VERSION,
                    "project": str(PROJECT_ROOT) if PROJECT_ROOT else "",
                },
            )
            return

        if parsed.path == "/api/git/status":
            payload = git_status_payload()
            self.json_response(200 if payload.get("ok") else 503, payload)
            return

        if parsed.path == "/api/thumbnail":
            asset_id = (urllib.parse.parse_qs(parsed.query).get("id") or [""])[0]
            if not re.fullmatch(r"\d{1,20}", asset_id):
                self.send_error(400, "Invalid asset id")
                return
            result = roblox_thumbnail(asset_id)
            if result is None:
                self.send_error(404, "Roblox thumbnail unavailable")
                return
            body, content_type = result
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/git/pull":
            self.json_response(
                501,
                {
                    "ok": False,
                    "error": "Safe AI Sync is available in the standalone RoFlow desktop app. Browser developer fallback never mutates Git.",
                },
            )
            return
        self.send_error(404, "Unknown endpoint")


def main() -> None:
    global PROJECT_ROOT

    parser = argparse.ArgumentParser(description="RoFlow UI Studio developer fallback server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--project", default="")
    args = parser.parse_args()

    if args.project:
        candidate = Path(args.project).expanduser().resolve()
        if not candidate.is_dir():
            raise SystemExit(f"Project folder not found: {candidate}")
        PROJECT_ROOT = candidate

    server = ThreadingHTTPServer((HOST, args.port), RoFlowUIHandler)
    print()
    print("RoFlow UI Studio developer fallback")
    print(f"UI     : http://{HOST}:{args.port}/")
    print(f"Project: {PROJECT_ROOT or '(not configured)'}")
    print("Safe AI Sync is intentionally disabled here; use RoFlow desktop.")
    print("Ctrl+C to stop.")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
