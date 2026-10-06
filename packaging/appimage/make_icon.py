#!/usr/bin/env python3
"""Generate the WLED Web Video Sync app icon as a PNG (stdlib only).

Draws a dark rounded tile containing a rainbow LED matrix with a play
triangle, which reads clearly at both 256px and small tray sizes.
"""
import struct
import zlib

SIZE = 256
SS = 4  # supersampling factor for antialiasing
W = SIZE * SS


def lerp(a, b, t):
    return a + (b - a) * t


def hsl_to_rgb(h, s, l):
    """h in [0,1), s and l in [0,1] -> (r,g,b) 0-255."""
    def hue(p, q, t):
        if t < 0:
            t += 1
        if t > 1:
            t -= 1
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2 / 3 - t) * 6
        return p

    if s == 0:
        r = g = b = l
    else:
        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = hue(p, q, h + 1 / 3)
        g = hue(p, q, h)
        b = hue(p, q, h - 1 / 3)
    return (int(r * 255 + 0.5), int(g * 255 + 0.5), int(b * 255 + 0.5))


# Precompute the high-resolution image as an alpha/colour buffer.
bg = (11, 16, 32)          # deep navy tile
grid_n = 6                 # 6x6 LED cells
margin = W * 0.16
cell_gap = W * 0.022
grid_span = W - 2 * margin
cell = (grid_span - cell_gap * (grid_n - 1)) / grid_n

radius = W * 0.20          # corner radius of the tile

pixels = []
for y in range(W):
    row = []
    for x in range(W):
        # --- rounded-rect mask for the tile -------------------------------
        cx = min(max(x, radius), W - radius)
        cy = min(max(y, radius), W - radius)
        dx = x - cx
        dy = y - cy
        if dx * dx + dy * dy > radius * radius:
            row.append((0, 0, 0, 0))
            continue

        r, g, b, a = bg[0], bg[1], bg[2], 255

        # subtle vertical gradient so the tile is not flat
        t = y / W
        r = int(r + 10 * (1 - t))
        g = int(g + 12 * (1 - t))
        b = int(b + 26 * (1 - t))

        # --- LED cells ----------------------------------------------------
        gx = (x - margin) / (cell + cell_gap)
        gy = (y - margin) / (cell + cell_gap)
        ix, iy = int(gx), int(gy)
        if 0 <= ix < grid_n and 0 <= iy < grid_n:
            fx = gx - ix
            fy = gy - iy
            # convert cell-space fraction into a 0..1 position inside the cell
            cell_frac = cell / (cell + cell_gap)
            if fx <= cell_frac and fy <= cell_frac:
                # hue sweeps diagonally => rainbow matrix
                hue = ((ix + iy * grid_n) / (grid_n * grid_n - 1)) % 1.0
                lit = hsl_to_rgb(hue, 0.95, 0.58)
                # rounded corner softening on each LED
                ex = min(fx, cell_frac - fx) / cell_frac
                ey = min(fy, cell_frac - fy) / cell_frac
                edge = min(ex, ey)
                if edge > 0.08 or (ex > 0 and ey > 0):
                    r, g, b = lit
        row.append((r, g, b, a))
    pixels.append(row)


# --- play triangle overlay (semi-transparent white) ------------------------
tri = [(0.40, 0.34), (0.40, 0.66), (0.66, 0.50)]


def edge_fn(px, py, a, b):
    return (px - a[0]) * (b[1] - a[1]) - (py - a[1]) * (b[0] - a[0])


for y in range(W):
    for x in range(W):
        px, py = x / W, y / W
        d1 = edge_fn(px, py, tri[0], tri[1])
        d2 = edge_fn(px, py, tri[1], tri[2])
        d3 = edge_fn(px, py, tri[2], tri[0])
        inside = (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0)
        if inside:
            r, g, b, a = pixels[y][x]
            if a == 0:
                continue
            nr = int(lerp(r, 255, 0.72))
            ng = int(lerp(g, 255, 0.72))
            nb = int(lerp(b, 255, 0.72))
            pixels[y][x] = (nr, ng, nb, a)


# --- downsample SSxSS -> SIZE --------------------------------------------
out = bytearray()
for y in range(SIZE):
    out.append(0)  # PNG filter type 0
    for x in range(SIZE):
        rs = gs = bs = as_ = 0
        for sy in range(SS):
            for sx in range(SS):
                r, g, b, a = pixels[y * SS + sy][x * SS + sx]
                # premultiply so transparent corners do not bleed colour
                rs += r * a
                gs += g * a
                bs += b * a
                as_ += a
        n = SS * SS
        if as_ == 0:
            out += bytes((0, 0, 0, 0))
        else:
            out += bytes((rs // as_, gs // as_, bs // as_, as_ // n))


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(out), 9))
png += chunk(b"IEND", b"")

with open("wled-video-sync.png", "wb") as fh:
    fh.write(png)

print(f"wrote wled-video-sync.png ({len(png)} bytes, {SIZE}x{SIZE})")
