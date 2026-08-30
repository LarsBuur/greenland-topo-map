#!/usr/bin/env python3
"""
Measure the native resolution of the Klimadatastyrelsen `gl_aabent_land` WMS.

The service advertises no scale limits — no MinScaleDenominator, no
MaxScaleDenominator, an empty metadata URL — so it renders at any zoom asked of
it and never says where the underlying data stops. That has to be measured, and
it decides `TOPO_NATIVE_ZOOM` in components/MapView.tsx, which in turn decides
how deep the offline download is worth going.

Two independent measurements, both reading the source pixel grid out of the
served image:

  1. Render a small square of ground at a far finer pixel size than the source
     can hold. The source pixels appear as blocks; the period of the horizontal
     edge profile is their size.
  2. Do the same for ordinary z15/z16/z17 tiles. A server upscaling a fixed
     raster reports the same ground resolution at every one of them.

Usage:
    DATAFORSYNINGEN_TOKEN=... python3 scripts/measure-native-resolution.py
"""

import math
import os
import struct
import subprocess
import sys
import urllib.parse
import zlib

WMS = "https://api.dataforsyningen.dk/wms/gl_aabent_land"
# A hillside on the trail west of Kangerluarsuk: contours and shading, no flat
# lake surface to hide the grid.
LAT, LON = 66.9634, -52.9330
R = 6378137.0


def fetch(bbox: str, width: int, height: int, token: str) -> bytes:
    params = {
        "service": "WMS",
        "request": "GetMap",
        "version": "1.3.0",
        "layers": "gl_aabent_land",
        "styles": "",
        "format": "image/png",
        "transparent": "false",
        "crs": "EPSG:3857",
        "bbox": bbox,
        "width": str(width),
        "height": str(height),
        "token": token,
    }
    # curl rather than urllib: the python.org builds ship without a CA bundle,
    # and this should just run.
    url = f"{WMS}?{urllib.parse.urlencode(params)}"
    res = subprocess.run(["curl", "-sS", "--fail", url], capture_output=True)
    if res.returncode != 0:
        sys.exit(f"WMS request failed: {res.stderr.decode().strip()}")
    return res.stdout


def decode_png(data: bytes):
    """Minimal PNG reader — enough for 8-bit RGB/RGBA, no image library needed."""
    pos, idat, w, h, ct = 8, b"", None, None, None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if tag == b"IHDR":
            w, h, _bd, ct = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * channels
    raw = zlib.decompress(idat)
    out, prev, p = bytearray(), bytearray(stride), 0
    for _ in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        out += line
        prev = line
    return out, w, h, channels


def block_period(png: bytes) -> int:
    """
    Spacing of the source pixel grid, in rendered pixels.

    Sums the absolute colour step between neighbouring columns down the image;
    upscaled source pixels put a spike at every block boundary. The lag with the
    strongest autocorrelation is the block size.
    """
    px, w, h, ch = decode_png(png)
    stride = w * ch
    cols = [0.0] * w
    for y in range(0, h, 2):
        row = px[y * stride : (y + 1) * stride]
        for x in range(1, w):
            cols[x] += sum(abs(row[x * ch + k] - row[(x - 1) * ch + k]) for k in range(3))

    mean = sum(cols) / w
    dev = [c - mean for c in cols]
    scored = [
        (sum(dev[i] * dev[i + lag] for i in range(w - lag)) / (w - lag), lag)
        for lag in range(2, 32)
    ]
    return max(scored)[1]


def mercator(lat: float, lon: float):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def tile_bbox(z: int):
    n = 2**z
    x = (LON + 180) / 360 * n
    r = math.radians(LAT)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n

    def corner(xt, yt):
        lo = xt / n * 360 - 180
        la = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yt / n))))
        return mercator(la, lo)

    x0, y0 = corner(math.floor(x), math.floor(y) + 1)
    x1, y1 = corner(math.floor(x) + 1, math.floor(y))
    return f"{x0},{y0},{x1},{y1}"


def main():
    token = os.environ.get("DATAFORSYNINGEN_TOKEN")
    if not token:
        sys.exit("Set DATAFORSYNINGEN_TOKEN (see .env.local).")

    print("1. A small patch of ground, deliberately over-rendered\n")
    cx, cy = mercator(LAT, LON)
    # Web Mercator metres are inflated by 1/cos(lat); this is ~256 m of real ground.
    half = 128 / math.cos(math.radians(LAT))
    ground_m = 256.0
    width = 512
    png = fetch(f"{cx - half},{cy - half},{cx + half},{cy + half}", width, width, token)
    period = block_period(png)
    native = period * ground_m / width
    print(f"   {ground_m:.0f} m into {width} px = {ground_m / width:.2f} m/px requested")
    print(f"   source blocks every {period} px  ->  native {native:.2f} m/px\n")

    print("2. Ordinary tiles — an upscaling server repeats itself\n")
    for z in (14, 15, 16, 17):
        mpp = 156543.03392 * math.cos(math.radians(LAT)) / 2**z
        p = block_period(fetch(tile_bbox(z), 256, 256, token))
        note = "  (at or below native — period floors at 2)" if p <= 2 else ""
        print(f"   z{z}: tile {mpp:6.3f} m/px, blocks every {p:2d} px -> {p * mpp:5.2f} m/px{note}")

    zoom = math.log2(156543.03392 * math.cos(math.radians(LAT)) / native)
    print(f"\n   native {native:.2f} m/px is zoom {zoom:.1f} at {LAT:.1f}°N")
    print(f"   1:50,000 scanned at 300 dpi would be 4.23 m/px, at 340 dpi 3.73 m/px")


if __name__ == "__main__":
    main()
