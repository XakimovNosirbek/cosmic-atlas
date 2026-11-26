"""Cut tile files that are too big for Cloudflare Pages (25 MiB per file) into parts the viewer joins again.

Today only the small-bodies orbit files can be that big (main.bin, the main-belt asteroids, is about 44 MB). Each
class listed in small-bodies/meta.json whose file is over --max-mib is written as <name>.0.bin, <name>.1.bin, ...
and meta.json gets "parts": [...] for it; web/src/solar/smallbodies.ts fetches the parts and concatenates them. The
whole file is removed. Any other file over the limit is reported and the script exits with status 1, so a deploy
never ships a file the host would reject.

usage: python3 scripts/split_large_tiles.py <tiles-dir> [--max-mib 24]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def split_small_bodies(tiles: Path, limit: int) -> list[str]:
    meta_path = tiles / "small-bodies" / "meta.json"
    if not meta_path.exists():
        return []
    meta = json.loads(meta_path.read_text())
    done = []
    for c in meta["classes"]:
        f = tiles / "small-bodies" / c["file"]
        if c.get("parts") or not f.exists() or f.stat().st_size <= limit:
            continue
        blob = f.read_bytes()
        stem = f.name.removesuffix(".bin")
        parts = []
        for i, k in enumerate(range(0, len(blob), limit)):
            name = f"{stem}.{i}.bin"
            (f.parent / name).write_bytes(blob[k:k + limit])
            parts.append(name)
        f.unlink()
        c["parts"] = parts
        done.append(f"small-bodies/{c['file']} ({len(blob):,} B) -> {', '.join(parts)}")
    if done:
        meta_path.write_text(json.dumps(meta, indent=1) + "\n")
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tiles", type=Path)
    ap.add_argument("--max-mib", type=float, default=24.0)
    a = ap.parse_args()
    limit = int(a.max_mib * 1024 * 1024)
    for line in split_small_bodies(a.tiles, limit):
        print("split:", line)
    big = [p for p in a.tiles.rglob("*") if p.is_file() and p.stat().st_size > limit]
    for p in big:
        print(f"still over {a.max_mib} MiB: {p.relative_to(a.tiles)} ({p.stat().st_size:,} B)", file=sys.stderr)
    return 1 if big else 0


if __name__ == "__main__":
    sys.exit(main())
