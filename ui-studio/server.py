from __future__ import annotations

import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import subprocess
import copy
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
ROOT = Path(os.environ.get("BLOOM_UI_ROOT", os.getcwd())).resolve()
CACHE_LIMIT = 256
BRIDGE_VERSION = 6

_thumbnail_cache: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()


def fetch_url(url: str, timeout: float = 8.0) -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "BloomUIStudio/1.0",
            "Accept": "application/json,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        ctype = resp.headers.get_content_type() or "application/octet-stream"
        return body, ctype


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
    api_url = "https://thumbnails.roblox.com/v1/assets?" + query

    image_url = None
    for attempt in range(4):
        try:
            raw, _ = fetch_url(api_url)
            payload = json.loads(raw.decode("utf-8"))
            rows = payload.get("data") or []
            if rows:
                row = rows[0]
                image_url = row.get("imageUrl")
                state = str(row.get("state") or "").lower()
                if image_url:
                    break
                if state not in {"pending", "inreview"}:
                    break
        except Exception:
            if attempt == 3:
                return None
        time.sleep(0.2 + attempt * 0.15)

    if image_url:
        try:
            image_bytes, content_type = fetch_url(image_url)
        except Exception:
            image_bytes, content_type = b"", ""
    else:
        image_bytes, content_type = b"", ""

    # Newly uploaded image assets can spend a while in the thumbnail service
    # even though the raw asset is already available. Try Asset Delivery so
    # Bloom UI Studio can preview fresh Workshop icons immediately.
    if not image_bytes:
        try:
            asset_url = "https://assetdelivery.roblox.com/v1/asset/?" + urllib.parse.urlencode({"id": asset_id})
            image_bytes, content_type = fetch_url(asset_url)
        except Exception:
            return None

    if not content_type.startswith("image/"):
        if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            content_type = "image/png"
        elif image_bytes.startswith(b"\xff\xd8\xff"):
            content_type = "image/jpeg"
        elif image_bytes[:4] == b"RIFF" and b"WEBP" in image_bytes[:16]:
            content_type = "image/webp"
        else:
            return None

    result = (image_bytes, content_type)
    _thumbnail_cache[asset_id] = result
    _thumbnail_cache.move_to_end(asset_id)
    while len(_thumbnail_cache) > CACHE_LIMIT:
        _thumbnail_cache.popitem(last=False)
    return result


def run_git(*args: str, timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(ROOT),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def git_status_payload() -> dict:
    inside = run_git("rev-parse", "--is-inside-work-tree")
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return {"ok": False, "error": "Project root is not a Git working tree"}

    head = run_git("rev-parse", "HEAD")
    subject = run_git("log", "-1", "--pretty=%s")
    branch = run_git("branch", "--show-current")
    status = run_git("status", "--porcelain")
    return {
        "ok": True,
        "head": head.stdout.strip() if head.returncode == 0 else "",
        "subject": subject.stdout.strip() if subject.returncode == 0 else "",
        "branch": branch.stdout.strip() if branch.returncode == 0 else "",
        "dirty": bool(status.stdout.strip()),
        "changes": status.stdout.splitlines()[:30],
    }


def git_stash_entries() -> list[tuple[str, str]]:
    result = run_git("stash", "list", "--format=%gd%x09%gs")
    if result.returncode != 0:
        return []
    out: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        if "\t" in line:
            ref, subject = line.split("\t", 1)
            out.append((ref.strip(), subject.strip()))
    return out



MODEL_PATH = Path("src/StarterGui/BloomUI.model.json")


def read_json_file(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def git_show_json(rev: str, relpath: str):
    shown = run_git("show", f"{rev}:{relpath}", timeout=20.0)
    if shown.returncode != 0:
        return None
    try:
        return json.loads(shown.stdout)
    except Exception:
        return None


def _child_index(children):
    counts = {}
    order = []
    mapping = {}
    for child in children:
        if not isinstance(child, dict):
            base_key = ("__raw__", json.dumps(child, sort_keys=True, ensure_ascii=False))
        else:
            base_key = (str(child.get("ClassName", "")), str(child.get("Name", "")))
        idx = counts.get(base_key, 0)
        counts[base_key] = idx + 1
        key = (*base_key, idx)
        order.append(key)
        mapping[key] = child
    return order, mapping


def merge_remote_changes(base, local, remote):
    container_with_children = (
        isinstance(base, dict)
        and isinstance(local, dict)
        and isinstance(remote, dict)
        and isinstance(base.get("Children"), list)
        and isinstance(local.get("Children"), list)
        and isinstance(remote.get("Children"), list)
    )
    # Containers with Children must recurse even when base==remote so required
    # runtime children removed by a stale local editor model can be restored.
    if base == remote and not container_with_children:
        return copy.deepcopy(local)
    if base == local:
        return copy.deepcopy(remote)

    if isinstance(base, dict) and isinstance(local, dict) and isinstance(remote, dict):
        out = copy.deepcopy(local)
        all_keys = set(base) | set(local) | set(remote)
        for key in all_keys:
            b_has, l_has, r_has = key in base, key in local, key in remote
            if b_has and not r_has:
                # Assistant removed this key.
                out.pop(key, None)
                continue
            if not b_has and r_has:
                # Assistant added this key. Assistant wins on same-key simultaneous additions.
                out[key] = copy.deepcopy(remote[key])
                continue
            if r_has and not l_has:
                # User removed it. Preserve removal unless assistant changed the old value.
                if base.get(key) == remote.get(key):
                    out.pop(key, None)
                else:
                    out[key] = copy.deepcopy(remote[key])
                continue
            if b_has and l_has and r_has:
                if key == "Children" and all(isinstance(x, list) for x in (base[key], local[key], remote[key])):
                    out[key] = merge_children(base[key], local[key], remote[key])
                else:
                    out[key] = merge_remote_changes(base[key], local[key], remote[key])
        return out

    # Non-Children arrays represent atomic Roblox values (UDim2, Color3, etc.).
    # When both sides edited the same atomic value, the assistant edit wins because
    # AI SYNC was explicitly requested by the user.
    return copy.deepcopy(remote)


REQUIRED_RUNTIME_UI_CHILDREN = {
    "ObjectiveCard", "CurrencyHUD", "MenuDock", "RollHUD", "VerticalRoulette",
    "TutorialGuideBanner", "Toast", "ModalShade", "MainPanel", "RewardReveal",
    "ActiveBoostsHUD", "ActiveBoostTooltip", "MinimizeButton", "LuckBadge", "ScrollLeft", "ScrollRight",
    "TraitFilterPanel", "TraitFilterList", "TraitChipTemplate", "UnequipAllButton", "EquippedBadge", "InventoryHoverScale",
    "BeeSummary", "PassiveRowTemplate", "AbilityDescription", "UsedBadge", "GhostBadge", "CurrencyHelp",
    "Dock_SeedSatchel", "Dock_Garden", "Dock_Hive", "Dock_Index", "Dock_Workshop", "Dock_Quests", "Dock_Settings",
    "HiveKit", "HiveShell", "RoadList", "RoadNodeTemplate", "UpgradeButton",
    "TraitBeeStrip", "TraitBeeIconTemplate", "EquipSynergyButton",
    "TutorialSpotlight", "TutorialCallout", "TutorialScreenArrow", "StateKits",
    "ActionHitboxTemplate", "OverlayHitboxTemplate", "SearchBoxTemplate", "EmptyStateTemplate",
    "HoverScale", "TutorialCompleteScale", "SlotScale", "WorkshopZoomScale",
    "WorkshopTemplate", "WorkshopBody", "TreePanel", "TreeCanvas", "PanMap",
    "NodeTooltip", "WorkshopCurrencyBar", "WorkshopPoints", "WorkshopCoins", "WorkshopPetalDust", "WorkshopAncientNectar",
    "WorldUIPrototypes", "TutorialWorldBillboard", "ActivityCheckpointBillboard",
    "TutorialWorldLabelTemplate", "ActivityCheckpointLabelTemplate",
}


def _is_required_runtime_ui_child(value) -> bool:
    return isinstance(value, dict) and value.get("Name") in REQUIRED_RUNTIME_UI_CHILDREN


def merge_children(base_children, local_children, remote_children):
    b_order, b_map = _child_index(base_children)
    l_order, l_map = _child_index(local_children)
    r_order, r_map = _child_index(remote_children)

    out = []
    emitted = set()

    # Follow remote ordering for known/assistant-added objects.
    for key in r_order:
        emitted.add(key)
        r = r_map[key]
        if key not in b_map:
            out.append(copy.deepcopy(r))
            continue
        b = b_map[key]
        if key not in l_map:
            # Runtime-required authored UI cannot be deleted by a stale local editor model.
            # These nodes are referenced directly by client controllers and must survive AI SYNC.
            if _is_required_runtime_ui_child(r):
                out.append(copy.deepcopy(r))
                continue
            # Preserve user deletion for non-required authored objects if assistant did not touch it.
            if b == r:
                continue
            out.append(copy.deepcopy(r))
            continue
        out.append(merge_remote_changes(b, l_map[key], r))

    # Preserve user-only objects that do not exist in base or remote.
    for key in l_order:
        if key in emitted:
            continue
        if key not in b_map:
            out.append(copy.deepcopy(l_map[key]))

    return out


def write_model_json(model) -> None:
    target = ROOT / MODEL_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def backup_raw_model(label: str = "broken") -> str:
    target = ROOT / MODEL_PATH
    if not target.exists():
        return ""
    recovery = ROOT / ".recovery"
    recovery.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = recovery / f"BloomUI.model.{label}.{stamp}.json"
    out.write_bytes(target.read_bytes())
    return str(out.relative_to(ROOT)).replace("\\", "/")

def safe_sync_git(editor_model=None) -> tuple[int, dict]:
    status_before = git_status_payload()
    if not status_before.get("ok"):
        return 503, status_before

    old_head = status_before.get("head", "")
    model_abs = ROOT / MODEL_PATH
    model_rel = MODEL_PATH.as_posix()

    base_model = git_show_json("HEAD", model_rel)
    disk_model = read_json_file(model_abs)

    model_dirty_check = run_git("status", "--porcelain", "--", model_rel)
    model_dirty = bool(model_dirty_check.stdout.strip()) if model_dirty_check.returncode == 0 else False

    recovery_backup = ""
    recovered_from_editor = False
    invalid_model_fallback = False
    local_model = disk_model if model_dirty else None

    # BloomUI.model.json is handled separately from Git stash.
    # Always back it up before touching it.
    if model_dirty:
        recovery_backup = backup_raw_model("before-ai-sync")

        if disk_model is None:
            if isinstance(editor_model, dict):
                local_model = editor_model
                recovered_from_editor = True
            else:
                # Do not block sync. Keep raw broken bytes in .recovery and use
                # the clean repository model as the fallback.
                local_model = None
                invalid_model_fallback = True

        restore_model = run_git("restore", "--staged", "--worktree", "--", model_rel)
        if restore_model.returncode != 0:
            return 500, {
                "ok": False,
                "stage": "model-restore",
                "error": restore_model.stderr.strip() or restore_model.stdout.strip() or "Не удалось восстановить базовый BloomUI.model.json",
                "recovery_backup": recovery_backup,
            }

    # Stash every OTHER local change after BloomUI.model.json has been isolated.
    status_after_model = git_status_payload()
    dirty_other = bool(status_after_model.get("dirty"))
    stash_ref = ""
    stash_label = ""
    stashed = False
    restored = False

    if dirty_other:
        stash_label = f"Bloom UI Studio AI SYNC {int(time.time())}"
        try:
            stash = run_git("stash", "push", "-u", "-m", stash_label, timeout=30.0)
        except (subprocess.TimeoutExpired, OSError) as exc:
            if model_dirty and local_model is not None:
                write_model_json(local_model)
            return 500, {
                "ok": False,
                "stage": "stash",
                "error": str(exc),
                "recovery_backup": recovery_backup,
            }

        if stash.returncode != 0:
            if model_dirty and local_model is not None:
                write_model_json(local_model)
            output = "\n".join(x for x in [stash.stdout.strip(), stash.stderr.strip()] if x)
            return 500, {
                "ok": False,
                "stage": "stash",
                "error": output or "git stash failed",
                "recovery_backup": recovery_backup,
            }

        for ref, subject in git_stash_entries():
            if stash_label in subject:
                stash_ref = ref
                break

        if not stash_ref:
            if model_dirty and local_model is not None:
                write_model_json(local_model)
            return 500, {
                "ok": False,
                "stage": "stash",
                "error": "Локальные изменения сохранены, но временный stash не удалось идентифицировать.",
                "recovery_backup": recovery_backup,
            }
        stashed = True

    try:
        pull = run_git("pull", "--ff-only", timeout=45.0)
    except (subprocess.TimeoutExpired, OSError) as exc:
        pull = None
        pull_error = str(exc)
    else:
        pull_error = ""

    if pull is None or pull.returncode != 0:
        output = pull_error
        if pull is not None:
            output = "\n".join(x for x in [pull.stdout.strip(), pull.stderr.strip()] if x) or "git pull --ff-only failed"

        if stashed and stash_ref:
            restore = run_git("stash", "apply", stash_ref, timeout=30.0)
            if restore.returncode == 0:
                run_git("stash", "drop", stash_ref)
                restored = True

        # Put back user's valid local model if pull itself failed.
        if model_dirty and local_model is not None:
            write_model_json(local_model)

        return 500, {
            "ok": False,
            "stage": "pull",
            "error": output,
            "stashed": stashed,
            "restored": restored,
            "stash_ref": stash_ref if stashed and not restored else "",
            "recovery_backup": recovery_backup,
        }

    status_after_pull = git_status_payload()
    new_head = status_after_pull.get("head", "")

    # Restore non-model local changes.
    if stashed and stash_ref:
        try:
            restore = run_git("stash", "apply", stash_ref, timeout=30.0)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return 500, {
                "ok": False,
                "stage": "restore",
                "error": str(exc),
                "changed": bool(old_head and new_head and old_head != new_head),
                "stashed": True,
                "restored": False,
                "stash_ref": stash_ref,
                "recovery_backup": recovery_backup,
            }

        if restore.returncode != 0:
            conflict_scan = run_git("diff", "--name-only", "--diff-filter=U")
            conflicts = [x for x in conflict_scan.stdout.splitlines() if x.strip()] if conflict_scan.returncode == 0 else []
            output = "\n".join(x for x in [restore.stdout.strip(), restore.stderr.strip()] if x)
            return 409, {
                "ok": False,
                "stage": "restore",
                "error": "Мои изменения подтянуты, но конфликт возник в других локальных файлах. Stash сохранён.",
                "details": output[-6000:],
                "conflicts": conflicts,
                "changed": bool(old_head and new_head and old_head != new_head),
                "stashed": True,
                "restored": False,
                "stash_ref": stash_ref,
                "recovery_backup": recovery_backup,
            }

        restored = True
        drop = run_git("stash", "drop", stash_ref)
        if drop.returncode != 0:
            return 500, {
                "ok": False,
                "stage": "drop",
                "error": "Локальные изменения возвращены, но временный stash не удалось удалить. Данные не потеряны.",
                "stash_ref": stash_ref,
                "changed": bool(old_head and new_head and old_head != new_head),
                "stashed": True,
                "restored": True,
                "recovery_backup": recovery_backup,
            }

    # At this point the file on disk is the clean remote model.
    remote_model = read_json_file(model_abs)
    if remote_model is None:
        return 500, {
            "ok": False,
            "stage": "remote-model",
            "error": "После pull GitHub-версия BloomUI.model.json оказалась невалидной.",
            "recovery_backup": recovery_backup,
        }

    model_merged = False
    if model_dirty and local_model is not None and base_model is not None:
        merged_model = merge_remote_changes(base_model, local_model, remote_model)
        write_model_json(merged_model)
        model_merged = True
    elif invalid_model_fallback:
        # Broken local bytes are safely preserved in .recovery.
        # Keep the valid remote model and continue successfully.
        write_model_json(remote_model)

    status_final = git_status_payload()
    pull_output = "\n".join(x for x in [pull.stdout.strip(), pull.stderr.strip()] if x)

    return 200, {
        "ok": True,
        "changed": bool(old_head and new_head and old_head != new_head),
        "head": status_final.get("head", new_head),
        "subject": status_final.get("subject", ""),
        "dirty": status_final.get("dirty", False),
        "stashed": stashed,
        "restored": restored,
        "model_merged": model_merged,
        "recovered_from_editor": recovered_from_editor,
        "invalid_model_fallback": invalid_model_fallback,
        "recovery_backup": recovery_backup,
        "output": pull_output[-6000:],
    }


class BloomHandler(SimpleHTTPRequestHandler):
    server_version = "BloomUIStudio/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print("[Bloom UI]", fmt % args)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/health":
            body = json.dumps({"ok": True, "server": "Bloom UI Studio", "bridge": BRIDGE_VERSION}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/git/status":
            payload = git_status_payload()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200 if payload.get("ok") else 503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/thumbnail":
            qs = urllib.parse.parse_qs(parsed.query)
            asset_id = (qs.get("id") or [""])[0]
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

        if parsed.path != "/api/git/pull":
            self.send_error(404, "Unknown endpoint")
            return

        editor_model = None
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        if length > 0:
            try:
                request_body = self.rfile.read(min(length, 12_000_000))
                request_json = json.loads(request_body.decode("utf-8"))
                candidate = request_json.get("editor_model") if isinstance(request_json, dict) else None
                if isinstance(candidate, dict):
                    editor_model = candidate
            except Exception:
                editor_model = None

        status_code, payload = safe_sync_git(editor_model=editor_model)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    global ROOT
    import argparse

    parser = argparse.ArgumentParser(description="Bloom UI Studio local server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args()

    root = Path(args.root).resolve()
    ROOT = root
    os.chdir(root)

    server = ThreadingHTTPServer((HOST, args.port), BloomHandler)
    print()
    print("Bloom UI Studio server")
    print(f"Root: {root}")
    print(f"URL : http://{HOST}:{args.port}/tools/bloom-ui-editor/index.html")
    print("Roblox thumbnail proxy: enabled")
    print(f"Assistant Bridge API: v{BRIDGE_VERSION} (editor-memory recovery + safe sync)")
    print("Close this window to stop the server.")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
