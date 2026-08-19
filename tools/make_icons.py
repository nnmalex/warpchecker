#!/usr/bin/env python3
"""Generate WARP Checker icons: orange shield with a white check, no deps."""
import math
import os
import struct
import zlib

SHIELD = (0xF3, 0x80, 0x20)  # Cloudflare orange
CHECK = (0xFF, 0xFF, 0xFF)
MARGIN = 0.05
SS = 8  # supersampling factor per axis


def shield_contains(u, t):
    """u in [-0.5, 0.5] across, t in [0, 1] down."""
    if t < 0.0 or t > 1.0:
        return False
    if t <= 0.42:
        hw = 0.5
    else:
        s = (t - 0.42) / 0.58
        if s >= 1.0:
            return False
        hw = 0.5 * math.sqrt(1.0 - s * s)
    au = abs(u)
    if au > hw:
        return False
    r = 0.16
    if t < r and au > 0.5 - r:
        dx, dy = au - (0.5 - r), t - r
        return dx * dx + dy * dy <= r * r
    return True


CHECK_PTS = [(0.27, 0.50), (0.43, 0.655), (0.735, 0.335)]
CHECK_HW = 0.055


def check_contains(u, t):
    x, y = u + 0.5, t
    for (x1, y1), (x2, y2) in zip(CHECK_PTS, CHECK_PTS[1:]):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        p = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
        ddx, ddy = x - (x1 + p * dx), y - (y1 + p * dy)
        if ddx * ddx + ddy * ddy <= CHECK_HW * CHECK_HW:
            return True
    return False


def render(size):
    rows = []
    span = 1.0 - 2 * MARGIN
    for py in range(size):
        row = bytearray()
        for px in range(size):
            sh = ck = 0
            for sy in range(SS):
                for sx in range(SS):
                    fx = (px + (sx + 0.5) / SS) / size
                    fy = (py + (sy + 0.5) / SS) / size
                    u = (fx - MARGIN) / span - 0.5
                    t = (fy - MARGIN) / span
                    if shield_contains(u, t):
                        sh += 1
                        if check_contains(u, t):
                            ck += 1
            n = SS * SS
            if sh == 0:
                row += bytes((0, 0, 0, 0))
                continue
            a = sh / n
            m = ck / sh  # check coverage within the shield
            rgb = tuple(
                round(SHIELD[i] * (1 - m) + CHECK[i] * m) for i in range(3)
            )
            row += bytes((*rgb, round(a * 255)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
out = os.environ.get("ICON_DIR", out)
os.makedirs(out, exist_ok=True)
for size in (16, 32, 48, 128):
    path = os.path.join(out, f"icon{size}.png")
    write_png(path, size, render(size))
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")
