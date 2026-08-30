#!/usr/bin/env python3
"""
Generate the PWA / home-screen icon set from the real trail geometry.

The icon is the ACT northern route itself, drawn from
`public/act-north-trail.geojson`, so it reads as *this* trail rather than a
generic map pin. Rendered at 4x and box-downsampled for anti-aliasing; no
image library is required, the PNGs are written by hand.

    python3 scripts/build-icons.py
"""

import json
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEOJSON = os.path.join(ROOT, "public", "act-north-trail.geojson")
OUT = os.path.join(ROOT, "public", "icons")

BG = (0x14, 0x17, 0x1A)
CASING = (0xFF, 0xFF, 0xFF)
TRAIL = (0x9C, 0x36, 0xB5)
START = (0x19, 0x71, 0xC2)
FINISH = (0xE8, 0x59, 0x0C)

SS = 4  # supersample factor


def load_stages():
    with open(GEOJSON) as fh:
        fc = json.load(fh)
    lines = []
    for feat in fc["features"]:
        if feat["properties"].get("kind") == "stage":
            lines.append([(c[0], c[1]) for c in feat["geometry"]["coordinates"]])
    if not lines:
        raise SystemExit("no stage features found in " + GEOJSON)
    return lines


def mercator(lon, lat):
    """Web Mercator, so the icon matches the map's own projection."""
    x = lon / 360.0
    s = math.sin(math.radians(lat))
    y = -math.log((1 + s) / (1 - s)) / (4 * math.pi)
    return x, y


class Canvas:
    def __init__(self, size, bg):
        self.n = size
        self.px = bytearray(bg * (size * size))

    def blend(self, x, y, color, alpha=1.0):
        if x < 0 or y < 0 or x >= self.n or y >= self.n:
            return
        i = (y * self.n + x) * 3
        if alpha >= 1.0:
            self.px[i : i + 3] = bytes(color)
            return
        for k in range(3):
            self.px[i + k] = int(self.px[i + k] * (1 - alpha) + color[k] * alpha)

    def disc(self, cx, cy, r, color):
        r2 = r * r
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                    self.blend(x, y, color)

    def segment(self, x0, y0, x1, y1, w, color):
        """Thick line as a swept disc — slow, but these are tiny images."""
        dist = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(dist))
        for i in range(steps + 1):
            t = i / steps
            self.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, color)

    def downsample(self, factor):
        n = self.n // factor
        out = bytearray(n * n * 3)
        inv = 1.0 / (factor * factor)
        for y in range(n):
            for x in range(n):
                acc = [0, 0, 0]
                for dy in range(factor):
                    row = (y * factor + dy) * self.n
                    for dx in range(factor):
                        i = (row + x * factor + dx) * 3
                        acc[0] += self.px[i]
                        acc[1] += self.px[i + 1]
                        acc[2] += self.px[i + 2]
                j = (y * n + x) * 3
                out[j] = int(acc[0] * inv)
                out[j + 1] = int(acc[1] * inv)
                out[j + 2] = int(acc[2] * inv)
        c = Canvas.__new__(Canvas)
        c.n, c.px = n, out
        return c

    def write_png(self, path):
        raw = bytearray()
        for y in range(self.n):
            raw.append(0)  # filter type 0
            raw += self.px[y * self.n * 3 : (y + 1) * self.n * 3]

        def chunk(tag, data):
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(
                ">I", zlib.crc32(body) & 0xFFFFFFFF
            )

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.n, self.n, 8, 2, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        with open(path, "wb") as fh:
            fh.write(png)


def best_angle(proj):
    """
    The route is ~165 km east-west but barely 25 km north-south, so drawn
    upright it occupies a thin band and most of the icon is dead space. Laying
    it along the diagonal lets it be drawn roughly 1.4x larger. Search for the
    rotation whose bounding box fits a square best.
    """
    pts = [p for line in proj for p in line]
    best, best_fit = 0.0, 0.0
    for deg in range(0, 180):
        a = math.radians(deg)
        cos_a, sin_a = math.cos(a), math.sin(a)
        rx = [p[0] * cos_a - p[1] * sin_a for p in pts]
        ry = [p[0] * sin_a + p[1] * cos_a for p in pts]
        w, h = max(rx) - min(rx), max(ry) - min(ry)
        fit = 1.0 / max(w, h)
        if fit > best_fit:
            best, best_fit = a, fit
    return best


def render(size, inset):
    """`inset` is the fraction of the edge left empty — maskable icons need more."""
    lines = load_stages()
    proj = [[mercator(lon, lat) for lon, lat in line] for line in lines]

    angle = best_angle(proj)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    proj = [
        [(p[0] * cos_a - p[1] * sin_a, p[0] * sin_a + p[1] * cos_a) for p in line]
        for line in proj
    ]

    xs = [p[0] for line in proj for p in line]
    ys = [p[1] for line in proj for p in line]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    span = max(maxx - minx, maxy - miny)

    big = size * SS
    pad = big * inset
    scale = (big - 2 * pad) / span
    # Centre the shorter axis rather than pinning it to the padding edge.
    ox = pad + (span - (maxx - minx)) * scale / 2
    oy = pad + (span - (maxy - miny)) * scale / 2

    def to_px(p):
        return (ox + (p[0] - minx) * scale, oy + (p[1] - miny) * scale)

    c = Canvas(big, BG)
    casing_w = max(3.0, big * 0.052)
    trail_w = max(1.5, big * 0.026)

    for width, color in ((casing_w, CASING), (trail_w, TRAIL)):
        for line in proj:
            pts = [to_px(p) for p in line]
            for a, b in zip(pts, pts[1:]):
                c.segment(a[0], a[1], b[0], b[1], width, color)

    # Endpoints: Sisimiut (west, blue) and Kangerlussuaq (east, orange). Chosen
    # by unrotated longitude, since "west" is meaningless after the rotation.
    ends = []
    for line, rline in zip(lines, proj):
        for i in (0, -1):
            ends.append((line[i][0], to_px(rline[i])))
    west = min(ends)[1]
    east = max(ends)[1]
    r = big * 0.048
    for pt, color in ((west, START), (east, FINISH)):
        c.disc(pt[0], pt[1], r, CASING)
        c.disc(pt[0], pt[1], r * 0.58, color)

    return c.downsample(SS)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [
        ("icon-192.png", 192, 0.10),
        ("icon-512.png", 512, 0.10),
        ("icon-maskable-512.png", 512, 0.22),
        ("apple-touch-icon.png", 180, 0.10),
        ("favicon-32.png", 32, 0.06),
    ]
    for name, size, inset in targets:
        render(size, inset).write_png(os.path.join(OUT, name))
        print(f"  {name}  {size}x{size}")


if __name__ == "__main__":
    main()
