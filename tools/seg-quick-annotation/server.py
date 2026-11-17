"""Quick-annotation server: SAM2.1 point prompts on Apple Silicon (MPS) or CPU.

The editor's quick-annotation tool uploads the frame it displays plus positive/negative clicks and
gets back one mask as COCO RLE. This is a stopgap until the AnnotationService serves the same
operation (cosceneapis #870); propagation already goes through the AnnotationService.

    POST /segment  multipart: `request` JSON + optional `image` (the displayed frame)
      request: {frameToken, points: [{x, y, positive}]}   x, y in source pixels
      → {counts, width, height, score, area}               COCO RLE at the image size

The embedding of the last uploaded frame is cached under the client's random `frameToken`, so
further clicks on the same frame can omit `image`. A request without `image` whose token is not
the cached one is rejected, and the client uploads again.

    python server.py [--port 18876] [--checkpoint sam2.1_hiera_small.pt] [--allow-origin REGEX]
"""

import argparse
import asyncio
import json
import logging
import os
import re
import threading
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import cv2
import numpy as np
from aiohttp import web
from pycocotools import mask as coco

HERE = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 16 * 1024 * 1024
# coScene web apps and local development servers.
DEFAULT_ALLOWED_ORIGINS = (
    r"https://([a-z0-9-]+\.)*coscene\.(cn|io)|https?://(localhost|127\.0\.0\.1)(:\d+)?"
)
log = logging.getLogger("seg-quick-annotation")


class BadRequest(Exception):
    pass


class Segmenter:
    def __init__(self, checkpoint, config):
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        self.torch = torch
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        started = time.time()
        self.image = SAM2ImagePredictor(build_sam2(config, str(checkpoint), device=device))
        self.frame_token = None
        # One model call at a time on the shared device.
        self.lock = threading.Lock()
        log.info("SAM2 %s on %s loaded in %.1fs", Path(checkpoint).name, device, time.time() - started)

    def segment(self, frame_token, jpeg, points, labels):
        """Best mask for clicks in pixel coordinates (label 1 positive, 0 negative)."""
        with self.lock, self.torch.inference_mode():
            if jpeg is not None:
                decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
                if decoded is None:
                    raise BadRequest("`image` is not a decodable image")
                self.image.set_image(cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB))
                self.frame_token = frame_token
            elif self.frame_token != frame_token:
                raise BadRequest("Upload the displayed frame as `image`")
            masks, scores, _ = self.image.predict(
                point_coords=np.array(points, np.float32),
                point_labels=np.array(labels, np.int32),
                # One click is ambiguous: take the best of three. More clicks pin it down.
                multimask_output=len(points) <= 1,
            )
            best = int(np.argmax(scores))
            return masks[best] > 0, float(scores[best])


def rle_counts(mask):
    return coco.encode(np.asfortranarray(mask.astype(np.uint8)))["counts"].decode("ascii")


def cors(request):
    origin = request.headers.get("Origin", "")
    if not request.app["allowed_origins"].fullmatch(origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers", "*"),
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }


async def options(request):
    return web.Response(status=204, headers=cors(request))


async def segment(request):
    headers = cors(request)
    try:
        if not request.content_type.startswith("multipart/"):
            raise BadRequest("Send multipart form data with `request` and `image`")
        form = await request.post()
        body = json.loads(form["request"])
        upload = form.get("image")
        image = upload.file.read() if upload is not None else None
        # Clients without a token cannot reuse a cached frame; each of their requests uploads.
        frame_token = str(body.get("frameToken") or "")
        if image is None and not frame_token:
            raise BadRequest("Upload the displayed frame as `image`")
        points = [[float(p["x"]), float(p["y"])] for p in body.get("points", [])]
        labels = [1 if p.get("positive", True) else 0 for p in body.get("points", [])]
        if not any(labels):
            raise BadRequest("Add at least one positive point")
        started = time.time()
        segmenter = request.app["segmenter"]
        mask, score = await asyncio.get_running_loop().run_in_executor(
            None, segmenter.segment, frame_token or None, image, points, labels
        )
        height, width = mask.shape
        area = int(mask.sum())
        log.info(
            "segment %s: %d points, %.0f ms, area %d",
            body.get("topic", "?"), len(points), (time.time() - started) * 1000, area,
        )
        return web.json_response(
            {"counts": rle_counts(mask), "width": width, "height": height, "score": score, "area": area},
            headers=headers,
        )
    except BadRequest as error:
        return web.json_response({"error": str(error)}, status=400, headers=headers)
    except (KeyError, ValueError, TypeError) as error:
        return web.json_response({"error": f"bad request: {error}"}, status=400, headers=headers)
    except Exception as error:  # noqa: BLE001 - report model failures to the browser
        log.exception("segment failed")
        return web.json_response({"error": f"segment failed: {error}"}, status=500, headers=headers)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18876)
    parser.add_argument("--checkpoint", default=str(HERE / "weights" / "sam2.1_hiera_small.pt"))
    parser.add_argument("--config", default="configs/sam2.1/sam2.1_hiera_s.yaml")
    parser.add_argument("--allow-origin", default=DEFAULT_ALLOWED_ORIGINS, help="regex of allowed browser origins")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # The image limit plus room for the request JSON and multipart framing.
    app = web.Application(client_max_size=MAX_IMAGE_BYTES + 1024 * 1024)
    app["allowed_origins"] = re.compile(args.allow_origin)
    app["segmenter"] = Segmenter(args.checkpoint, args.config)
    app.router.add_route("OPTIONS", "/{tail:.*}", options)
    app.router.add_post("/segment", segment)
    web.run_app(app, host=args.host, port=args.port, access_log=None)


if __name__ == "__main__":
    main()
