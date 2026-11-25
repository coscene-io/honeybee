# SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
# SPDX-License-Identifier: MPL-2.0
"""Regenerate the synthetic mask fixtures. Deterministic: rerunning gives identical files.

    pip install numpy pycocotools opencv-python-headless
    python generate.py

masks.json  Shapes drawn on a 1280x720 frame: COCO compressed RLE from pycocotools, and the
            OpenCV reference conversion (findContours RETR_CCOMP outer rings, approxPolyDP
            eps=1, fillPoly) with its round-trip IoU. Tests hold the TypeScript conversion to
            at least that IoU, and use the shapes as mock mask observations.
codec.json  Small random masks with their pycocotools counts, for byte-exact codec tests.
            Pixels are column-major, one "0"/"1" string per column.
"""

import json
import re
from pathlib import Path

import cv2
import numpy as np
from pycocotools import mask as coco

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 1280, 720


def encode(mask: np.ndarray) -> str:
    return coco.encode(np.asfortranarray(mask.astype(np.uint8)))["counts"].decode("ascii")


def blank() -> np.ndarray:
    return np.zeros((HEIGHT, WIDTH), np.uint8)


def shapes() -> list[tuple[str, np.ndarray]]:
    rng = np.random.default_rng(7)
    out = []

    m = blank()
    cv2.ellipse(m, (320, 300), (120, 70), 20, 0, 360, 1, -1)
    out.append(("ellipse", m))

    m = blank()
    cv2.rectangle(m, (600, 200), (820, 420), 1, -1)
    out.append(("rectangle", m))

    m = blank()
    cv2.rectangle(m, (100, 400), (400, 650), 1, -1)
    cv2.rectangle(m, (180, 470), (300, 580), 0, -1)
    out.append(("rectangle-with-hole", m))

    m = blank()
    cv2.circle(m, (900, 500), 90, 1, -1)
    cv2.circle(m, (900, 500), 50, 0, -1)
    out.append(("ring", m))

    m = blank()
    cv2.circle(m, (200, 150), 40, 1, -1)
    cv2.circle(m, (420, 160), 55, 1, -1)
    out.append(("two-blobs", m))

    m = blank()
    cv2.line(m, (700, 600), (1100, 650), 1, 1)
    out.append(("thin-line", m))

    m = blank()
    for _ in range(14):
        cv2.circle(m, (int(rng.integers(500, 760)), int(rng.integers(250, 470))), int(rng.integers(15, 50)), 1, -1)
    out.append(("blob-union", m))

    m = blank()
    pts = np.array([[1000, 100], [1200, 100], [1200, 160], [1060, 160], [1060, 330], [1000, 330]], np.int32)
    cv2.fillPoly(m, [pts], 1)
    out.append(("l-shape", m))

    m = blank()
    angles = np.linspace(0, 2 * np.pi, 11)[:-1]
    radii = np.where(np.arange(10) % 2 == 0, 110, 45)
    star = np.stack([640 + radii * np.cos(angles), 360 + radii * np.sin(angles)], 1).round().astype(np.int32)
    cv2.fillPoly(m, [star], 1)
    out.append(("star", m))

    m = blank()
    m[0:120, 0:90] = 1
    out.append(("corner", m))

    m = blank()
    m[600:720, 1180:1280] = 1
    cv2.circle(m, (1230, 660), 20, 0, -1)
    out.append(("edge-with-hole", m))

    m = blank()
    m[50:670, 640:646] = 1
    out.append(("tall-bar", m))

    m = blank()
    for y in range(300, 420, 12):
        m[y : y + 6, 150:450] = 1
    out.append(("stripes", m))

    m = blank()
    cv2.ellipse(m, (800, 200), (200, 40), -15, 0, 360, 1, -1)
    cv2.ellipse(m, (800, 200), (60, 12), -15, 0, 360, 0, -1)
    out.append(("ellipse-with-slot", m))

    m = blank()
    noise = (rng.random((HEIGHT // 8, WIDTH // 8)) > 0.72).astype(np.uint8)
    m[:] = cv2.resize(noise, (WIDTH, HEIGHT), interpolation=cv2.INTER_NEAREST)
    m[:, : WIDTH // 2] = 0
    m[: HEIGHT // 2] = 0
    out.append(("noisy-quadrant", m))

    m = blank()
    pts = np.array([[300, 80], [520, 60], [560, 220], [430, 140], [330, 250]], np.int32)
    cv2.fillPoly(m, [pts], 1)
    out.append(("concave", m))

    m = blank()
    cv2.circle(m, (1100, 400), 70, 1, -1)
    cv2.rectangle(m, (1060, 390), (1140, 410), 0, -1)
    out.append(("split-disc", m))

    m = blank()
    cv2.ellipse(m, (450, 520), (160, 90), 0, 0, 360, 1, -1)
    for cx in (380, 450, 520):
        cv2.circle(m, (cx, 520), 18, 0, -1)
    out.append(("three-holes", m))

    return out


def reference_polygons(mask: np.ndarray) -> list[list[list[int]]]:
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    polygons = []
    for i, contour in enumerate(contours):
        if hierarchy[0][i][3] != -1:
            continue  # a hole: the reference keeps outer rings only
        ring = cv2.approxPolyDP(contour, 1, True).reshape(-1, 2)
        polygons.append(ring.tolist())
    return polygons


def iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / union) if union else 1.0


def mask_case(name: str, mask: np.ndarray) -> dict:
    polygons = reference_polygons(mask)
    raster = blank()
    cv2.fillPoly(raster, [np.array(p, np.int32) for p in polygons], 1)
    ys, xs = np.nonzero(mask)
    return {
        "base": name,
        "size": [HEIGHT, WIDTH],
        "counts": encode(mask),
        "area": int(mask.sum()),
        "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
        "polygons": polygons,
        "polygonsCounts": encode(raster),
        "roundtripIou": round(iou(mask, raster), 6),
    }


def codec_cases() -> list[dict]:
    rng = np.random.default_rng(11)
    cases = []
    for i in range(40):
        height, width = int(rng.integers(1, 30)), int(rng.integers(1, 30))
        density = [0.0, 1.0, 0.05, 0.5, 0.95][i % 5]
        mask = (rng.random((height, width)) < density).astype(np.uint8)
        if i % 7 == 3:
            mask[:] = 0
            mask[height // 3 :, width // 4 :] = 1  # long runs exercise multi-character deltas
        columns = ["".join(str(v) for v in mask[:, x]) for x in range(width)]
        cases.append({"size": [height, width], "counts": encode(mask), "columns": columns})
    return cases


def write(name: str, cases: list[dict]) -> None:
    body = {"source": f"Synthetic; regenerate with {Path(__file__).name}.", "cases": cases}
    text = json.dumps(body, indent=2)
    # One line per vertex pair and per short list keeps diffs reviewable.
    text = re.sub(r"\[\s+(-?\d+),\s+(-?\d+)\s+\]", r"[\1, \2]", text)
    text = re.sub(r"\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+),\s+(-?\d+)\s+\]", r"[\1, \2, \3, \4]", text)
    # Format the result with `yarn prettier --write` before committing it.
    (HERE / name).write_text(text + "\n")


if __name__ == "__main__":
    write("masks.json", [mask_case(name, mask) for name, mask in shapes()])
    write("codec.json", codec_cases())
