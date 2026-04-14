#!/usr/bin/env python3
"""
slice_sprites.py — Auto-detect and slice sprites from a sprite sheet.

Finds sprite bounding boxes by detecting connected regions of non-transparent
(or non-background-colored) pixels using a scanline + union-find algorithm.
Works on any PNG — uniform or non-uniform sprite sizes, any layout.

Usage:
  python3 scripts/slice_sprites.py <input.png> [output_dir]
  python3 scripts/slice_sprites.py <input.png> [output_dir] [options]

Options:
  --padding N       Add N pixels of padding around each sprite (default: 2)
  --min-size N      Ignore blobs smaller than NxN bounding box (default: 6)
  --merge-gap N     Merge blobs within N pixels of each other (default: 8)
  --bg-color R G B  Treat this RGB color as background instead of transparency
  --prefix NAME     Output filename prefix (default: input filename stem)
  --preview         Save a debug image showing detected bounding boxes

Examples:
  python3 scripts/slice_sprites.py src/sprites/Heap_sprites/recycle_items.png --merge-gap 0 --preview 
  
  """

import sys
import os
import argparse
from PIL import Image, ImageDraw


# ---------------------------------------------------------------------------
# Union-Find (path-compressed)
# ---------------------------------------------------------------------------

class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        if x not in self.parent:
            self.parent[x] = x
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


# ---------------------------------------------------------------------------
# Core detection
# ---------------------------------------------------------------------------

def build_mask(img: Image.Image, bg_color=None) -> list:
    """Return a flat bytearray mask: 1 = foreground, 0 = background."""
    img = img.convert("RGBA")
    width, height = img.size
    mask = bytearray(width * height)

    pixels = img.load()

    if bg_color:
        br, bg_c, bb = bg_color
        threshold = 40  # color distance tolerance
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                if a < 10:
                    continue
                if abs(r - br) + abs(g - bg_c) + abs(b - bb) > threshold:
                    mask[y * width + x] = 1
    else:
        for y in range(height):
            for x in range(width):
                if pixels[x, y][3] > 10:
                    mask[y * width + x] = 1

    return mask, width, height


def find_runs(mask, width, height):
    """Scan each row and return list of (y, x_start, x_end) runs of foreground pixels."""
    runs = []
    for y in range(height):
        row_offset = y * width
        x = 0
        while x < width:
            if mask[row_offset + x]:
                start = x
                while x < width and mask[row_offset + x]:
                    x += 1
                runs.append((y, start, x - 1))
            else:
                x += 1
    return runs


def detect_blobs(mask, width, height):
    """
    Group foreground runs into blobs using union-find.
    Returns list of (x1, y1, x2, y2) bounding boxes.
    """
    runs = find_runs(mask, width, height)

    uf = UnionFind()
    # Index runs by row for overlap checking
    by_row = {}
    for i, (y, xs, xe) in enumerate(runs):
        by_row.setdefault(y, []).append(i)
        uf.find(i)  # ensure registered

    for i, (y, xs, xe) in enumerate(runs):
        prev_row = by_row.get(y - 1, [])
        for j in prev_row:
            _, pxs, pxe = runs[j]
            # Overlap check: ranges [xs,xe] and [pxs,pxe] intersect
            if xs <= pxe + 1 and pxs <= xe + 1:
                uf.union(i, j)

    # Collect bounding boxes per root
    boxes = {}
    for i, (y, xs, xe) in enumerate(runs):
        root = uf.find(i)
        if root not in boxes:
            boxes[root] = [xs, y, xe, y]
        else:
            b = boxes[root]
            b[0] = min(b[0], xs)
            b[1] = min(b[1], y)
            b[2] = max(b[2], xe)
            b[3] = max(b[3], y)

    return [tuple(b) for b in boxes.values()]


def merge_nearby(boxes, gap):
    """Merge bounding boxes that are within `gap` pixels of each other."""
    if not boxes:
        return []

    changed = True
    boxes = list(boxes)
    while changed:
        changed = False
        merged = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]:
                continue
            ax1, ay1, ax2, ay2 = boxes[i]
            for j in range(i + 1, len(boxes)):
                if used[j]:
                    continue
                bx1, by1, bx2, by2 = boxes[j]
                # Check if expanded boxes overlap
                if (ax1 - gap <= bx2 and bx1 - gap <= ax2 and
                        ay1 - gap <= by2 and by1 - gap <= ay2):
                    ax1 = min(ax1, bx1)
                    ay1 = min(ay1, by1)
                    ax2 = max(ax2, bx2)
                    ay2 = max(ay2, by2)
                    used[j] = True
                    changed = True
            merged.append((ax1, ay1, ax2, ay2))
            used[i] = True
        boxes = merged

    return boxes


def filter_small(boxes, min_size):
    return [
        b for b in boxes
        if (b[2] - b[0] + 1) >= min_size and (b[3] - b[1] + 1) >= min_size
    ]


def add_padding(boxes, padding, width, height):
    return [
        (
            max(0, b[0] - padding),
            max(0, b[1] - padding),
            min(width - 1, b[2] + padding),
            min(height - 1, b[3] + padding),
        )
        for b in boxes
    ]


def sort_boxes(boxes):
    """Sort top-to-bottom, left-to-right."""
    return sorted(boxes, key=lambda b: (b[1], b[0]))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Auto-detect and slice sprites from a sprite sheet."
    )
    parser.add_argument("input", help="Input PNG sprite sheet")
    parser.add_argument("output_dir", nargs="?", help="Output directory (default: <input_stem>/)")
    parser.add_argument("--padding", type=int, default=2, metavar="N",
                        help="Padding around each sprite in pixels (default: 2)")
    parser.add_argument("--min-size", type=int, default=6, metavar="N",
                        help="Minimum bounding box dimension to keep (default: 6)")
    parser.add_argument("--merge-gap", type=int, default=8, metavar="N",
                        help="Merge blobs within N pixels of each other (default: 8)")
    parser.add_argument("--bg-color", type=int, nargs=3, metavar=("R", "G", "B"),
                        help="Background color to treat as transparent (e.g. 255 0 255)")
    parser.add_argument("--prefix", type=str, default=None,
                        help="Output filename prefix (default: input stem)")
    parser.add_argument("--preview", action="store_true",
                        help="Save a debug image showing detected bounding boxes")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    stem = os.path.splitext(os.path.basename(args.input))[0]
    prefix = args.prefix or stem
    out_dir = args.output_dir or os.path.join(os.path.dirname(args.input), stem)
    os.makedirs(out_dir, exist_ok=True)

    print(f"Loading {args.input}...")
    img = Image.open(args.input)
    w, h = img.size
    print(f"  Size: {w}x{h}")

    print("Building foreground mask...")
    mask, width, height = build_mask(img, bg_color=args.bg_color)

    print("Detecting connected blobs...")
    boxes = detect_blobs(mask, width, height)
    print(f"  Raw blobs: {len(boxes)}")

    boxes = filter_small(boxes, args.min_size)
    print(f"  After min-size filter ({args.min_size}px): {len(boxes)}")

    if args.merge_gap > 0:
        boxes = merge_nearby(boxes, args.merge_gap)
        print(f"  After merge-gap ({args.merge_gap}px): {len(boxes)}")

    boxes = add_padding(boxes, args.padding, width, height)
    boxes = sort_boxes(boxes)

    print(f"\nSlicing {len(boxes)} sprites into {out_dir}/")
    for i, (x1, y1, x2, y2) in enumerate(boxes):
        sprite = img.crop((x1, y1, x2 + 1, y2 + 1))
        fname = f"{prefix}_{i:02d}.png"
        out_path = os.path.join(out_dir, fname)
        sprite.save(out_path)
        print(f"  {fname}  ({x2-x1+1}x{y2-y1+1}px)  @ ({x1},{y1})")

    if args.preview:
        preview = img.convert("RGBA")
        draw = ImageDraw.Draw(preview)
        for i, (x1, y1, x2, y2) in enumerate(boxes):
            draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0, 255), width=2)
            draw.text((x1 + 2, y1 + 2), str(i), fill=(255, 255, 0, 255))
        preview_path = os.path.join(out_dir, f"{prefix}_preview.png")
        preview.save(preview_path)
        print(f"\nPreview saved: {preview_path}")

    print(f"\nDone. {len(boxes)} sprites written to {out_dir}/")


if __name__ == "__main__":
    main()
