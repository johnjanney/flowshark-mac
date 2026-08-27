#!/usr/bin/env python3
"""
Generate the application and document icons.

The icons are drawn here rather than checked in as binaries, so they can be
reviewed and regenerated from source. The output is what the macOS bundle
needs: PNGs for the Tauri bundler and two `.icns` files, one for the
application and one for the `.flowshark` document type.

Drawing is done with scanline spans at 2048 pixels and then halved repeatedly
down to each size, which gives clean edges without a per-pixel supersampling
pass that would take minutes in pure Python.

Run with:  python3 scripts/generate-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
MASTER = 2048

Color = tuple[int, int, int, int]


class Canvas:
    """An RGBA raster with scanline span filling."""

    def __init__(self, size: int):
        self.size = size
        self.pixels = bytearray(size * size * 4)

    def fill_span(self, y: int, x0: float, x1: float, color: Color) -> None:
        if not (0 <= y < self.size):
            return
        start = max(0, int(round(x0)))
        end = min(self.size, int(round(x1)))
        if end <= start:
            return
        row = y * self.size * 4
        self.pixels[row + start * 4 : row + end * 4] = bytes(color) * (end - start)

    def fill(self, spans, color_for_row) -> None:
        """`spans(y)` yields (x0, x1) pairs; `color_for_row(y)` gives the colour."""
        for y in range(self.size):
            color = None
            for x0, x1 in spans(y + 0.5):
                if color is None:
                    color = color_for_row(y + 0.5)
                self.fill_span(y, x0, x1, color)

    def half(self) -> "Canvas":
        target = Canvas(self.size // 2)
        source = self.pixels
        out = target.pixels
        width = self.size
        for y in range(target.size):
            base0 = (y * 2) * width * 4
            base1 = (y * 2 + 1) * width * 4
            row = y * target.size * 4
            for x in range(target.size):
                i0 = base0 + x * 8
                i1 = base1 + x * 8
                a = source[i0 + 3] + source[i0 + 7] + source[i1 + 3] + source[i1 + 7]
                o = row + x * 4
                if a == 0:
                    continue
                for channel in range(3):
                    total = (
                        source[i0 + channel] * source[i0 + 3]
                        + source[i0 + 4 + channel] * source[i0 + 7]
                        + source[i1 + channel] * source[i1 + 3]
                        + source[i1 + 4 + channel] * source[i1 + 7]
                    )
                    out[o + channel] = total // a
                out[o + 3] = a // 4
        return target

    def to_png(self) -> bytes:
        raw = bytearray()
        stride = self.size * 4
        for y in range(self.size):
            raw.append(0)  # filter type 0 (None)
            raw.extend(self.pixels[y * stride : (y + 1) * stride])

        def chunk(tag: bytes, payload: bytes) -> bytes:
            return (
                struct.pack(">I", len(payload))
                + tag
                + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
            )

        header = struct.pack(">IIBBBBB", self.size, self.size, 8, 6, 0, 0, 0)
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b"")
        )


# ---------------------------------------------------------------------------
# Span generators
# ---------------------------------------------------------------------------


def squircle_spans(size: float, inset: float, exponent: float = 5.0):
    """Apple-style rounded square, drawn as a superellipse."""
    half = size * (1 - inset * 2) / 2
    cx = cy = size / 2

    def spans(y: float):
        dy = abs(y - cy) / half
        if dy >= 1:
            return
        dx = (1 - dy**exponent) ** (1 / exponent)
        yield (cx - dx * half, cx + dx * half)

    return spans


def rounded_rect_spans(x0: float, y0: float, x1: float, y1: float, radius: float):
    radius = min(radius, (x1 - x0) / 2, (y1 - y0) / 2)

    def spans(y: float):
        if not (y0 <= y <= y1):
            return
        if y < y0 + radius:
            offset = radius - (radius**2 - (y0 + radius - y) ** 2) ** 0.5
        elif y > y1 - radius:
            offset = radius - (radius**2 - (y - (y1 - radius)) ** 2) ** 0.5
        else:
            offset = 0
        yield (x0 + offset, x1 - offset)

    return spans


def polygon_spans(points: list[tuple[float, float]]):
    def spans(y: float):
        crossings: list[float] = []
        count = len(points)
        for i in range(count):
            ax, ay = points[i]
            bx, by = points[(i + 1) % count]
            if (ay > y) != (by > y):
                crossings.append(ax + (y - ay) / (by - ay) * (bx - ax))
        crossings.sort()
        for i in range(0, len(crossings) - 1, 2):
            yield (crossings[i], crossings[i + 1])

    return spans


def solid(color: Color):
    return lambda y: color


def vertical_gradient(size: float, top: tuple[int, int, int], bottom: tuple[int, int, int]):
    def color_for_row(y: float) -> Color:
        t = min(1.0, max(0.0, y / size))
        return (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
            255,
        )

    return color_for_row


# ---------------------------------------------------------------------------
# The icons
# ---------------------------------------------------------------------------

BLUE_TOP = (0x4F, 0x88, 0xF2)
BLUE_BOTTOM = (0x1D, 0x42, 0xAC)
WHITE: Color = (255, 255, 255, 255)
PAPER: Color = (252, 253, 255, 255)
INK: Color = (0x2B, 0x5F, 0xD9, 255)
EDGE: Color = (0xB6, 0xBD, 0xCB, 255)


def draw_glyph(canvas: Canvas, size: float, ink: Color, scale: float, top_y: float) -> None:
    """A small flowchart: a box, a decision diamond, a box, and two connectors."""
    cx = size / 2
    unit = size * scale
    stroke = unit * 0.08

    box_height = unit * 0.24
    box_half_width = unit * 0.36
    diamond_cy = top_y + unit * 0.62
    diamond_half = unit * 0.22
    bottom_top = top_y + unit * 1.0

    canvas.fill(
        rounded_rect_spans(
            cx - stroke / 2, top_y + box_height, cx + stroke / 2, diamond_cy - diamond_half, 0
        ),
        solid(ink),
    )
    canvas.fill(
        rounded_rect_spans(
            cx - stroke / 2, diamond_cy + diamond_half, cx + stroke / 2, bottom_top, 0
        ),
        solid(ink),
    )
    canvas.fill(
        rounded_rect_spans(
            cx - box_half_width, top_y, cx + box_half_width, top_y + box_height, unit * 0.06
        ),
        solid(ink),
    )
    canvas.fill(
        polygon_spans(
            [
                (cx, diamond_cy - diamond_half),
                (cx + unit * 0.32, diamond_cy),
                (cx, diamond_cy + diamond_half),
                (cx - unit * 0.32, diamond_cy),
            ]
        ),
        solid(ink),
    )
    canvas.fill(
        rounded_rect_spans(
            cx - box_half_width, bottom_top, cx + box_half_width, bottom_top + box_height, unit * 0.06
        ),
        solid(ink),
    )


def build_app_master() -> Canvas:
    canvas = Canvas(MASTER)
    canvas.fill(squircle_spans(MASTER, 0.095), vertical_gradient(MASTER, BLUE_TOP, BLUE_BOTTOM))
    draw_glyph(canvas, MASTER, WHITE, 0.52, MASTER * 0.178)
    return canvas


def build_document_master() -> Canvas:
    canvas = Canvas(MASTER)
    left, right = MASTER * 0.18, MASTER * 0.82
    top, bottom = MASTER * 0.06, MASTER * 0.94
    fold = MASTER * 0.2
    border = MASTER * 0.014

    canvas.fill(
        polygon_spans(
            [(left, top), (right - fold, top), (right, top + fold), (right, bottom), (left, bottom)]
        ),
        solid(EDGE),
    )
    canvas.fill(
        polygon_spans(
            [
                (left + border, top + border),
                (right - fold + border * 0.4, top + border),
                (right - border, top + fold + border * 0.4),
                (right - border, bottom - border),
                (left + border, bottom - border),
            ]
        ),
        solid(PAPER),
    )
    canvas.fill(
        polygon_spans(
            [
                (right - fold + border * 0.4, top + border),
                (right - border, top + fold + border * 0.4),
                (right - fold + border * 0.4, top + fold + border * 0.4),
            ]
        ),
        solid(EDGE),
    )
    draw_glyph(canvas, MASTER, INK, 0.4, MASTER * 0.252)
    return canvas


def pyramid(master: Canvas) -> dict[int, Canvas]:
    """Every power-of-two size from the master down to 16 pixels."""
    levels = {master.size: master}
    current = master
    while current.size > 16:
        current = current.half()
        levels[current.size] = current
    return levels


ICNS_TYPES = [
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic07", 128),
    (b"ic13", 256),
    (b"ic08", 256),
    (b"ic14", 512),
    (b"ic09", 512),
    (b"ic10", 1024),
]


def build_icns(levels: dict[int, Canvas], png_cache: dict[int, bytes]) -> bytes:
    entries = bytearray()
    for tag, size in ICNS_TYPES:
        if size not in png_cache:
            png_cache[size] = levels[size].to_png()
        payload = png_cache[size]
        entries += tag + struct.pack(">I", len(payload) + 8) + payload
    return b"icns" + struct.pack(">I", len(entries) + 8) + bytes(entries)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    app_levels = pyramid(build_app_master())
    app_pngs: dict[int, bytes] = {}
    for name, size in {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 1024,
    }.items():
        if size not in app_pngs:
            app_pngs[size] = app_levels[size].to_png()
        (ICON_DIR / name).write_bytes(app_pngs[size])
        print(f"wrote {name}")
    (ICON_DIR / "icon.icns").write_bytes(build_icns(app_levels, app_pngs))
    print("wrote icon.icns")

    document_levels = pyramid(build_document_master())
    document_pngs: dict[int, bytes] = {}
    (ICON_DIR / "document.icns").write_bytes(build_icns(document_levels, document_pngs))
    print("wrote document.icns")
    (ICON_DIR / "document.png").write_bytes(document_levels[512].to_png())
    print("wrote document.png")


if __name__ == "__main__":
    main()
