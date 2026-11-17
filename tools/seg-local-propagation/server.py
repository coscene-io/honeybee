"""Local PropagateAnnotation sidecar: SAM2.1 on Apple Silicon (MPS), frames read from a local MCAP.

Implements only `coscene.dataplatform.v1alpha3.services.AnnotationService/PropagateAnnotation`
(cosceneapis #866) over gRPC-Web, so the editor can point just that method at this process while
every other RPC keeps going to the real backend.

Frames come from the record's original MCAP. A request topic ending in `/h264` maps to the same
topic without the suffix (the source JPEG topic) when that one exists; for the Astribot recordings
both topics carry identical log times. frame_time is the log time truncated to microseconds.

    python server.py --mcap /path/record.mcap [--port 18876] [--checkpoint sam2.1_hiera_small.pt]
"""

import argparse
import asyncio
import json
import logging
import os
import shutil
import struct
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import cv2
import numpy as np
from aiohttp import web
from mcap.reader import make_reader
from pycocotools import mask as coco

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "gen"))
from coscene.dataplatform.v1alpha3.resources import annotation_pb2 as res  # noqa: E402
from coscene.dataplatform.v1alpha3.services import annotation_pb2 as svc  # noqa: E402

PATH = "/coscene.dataplatform.v1alpha3.services.AnnotationService/PropagateAnnotation"
log = logging.getLogger("seg-local-propagation")

# gRPC status codes
INVALID_ARGUMENT, FAILED_PRECONDITION, CANCELLED, INTERNAL, UNIMPLEMENTED, RESOURCE_EXHAUSTED = 3, 9, 1, 13, 12, 8


class RpcError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def micros_of(ts):
    if ts.nanos % 1000:
        raise RpcError(INVALID_ARGUMENT, "Frame time must be aligned to microseconds")
    return ts.seconds * 1_000_000 + ts.nanos // 1000


def set_micros(ts, micros):
    ts.seconds, ts.nanos = divmod(micros, 1_000_000)
    ts.nanos *= 1000


# ---------------------------------------------------------------- media


class Media:
    """Per-topic source frame index of one local MCAP: microsecond frame_time → raw log time."""

    def __init__(self, path):
        self.path = path
        self.topics = {}  # topic -> sorted [log_time_ns]
        t = time.time()
        with open(path, "rb") as f:
            reader = make_reader(f)
            summary = reader.get_summary()
            image_topics = [
                ch.topic
                for ch in summary.channels.values()
                if (summary.schemas[ch.schema_id].name if ch.schema_id in summary.schemas else "")
                .endswith("CompressedImage")
            ]
            for _, channel, message in reader.iter_messages(topics=image_topics):
                self.topics.setdefault(channel.topic, []).append(message.log_time)
        for topic, times in self.topics.items():
            times.sort()
            micros = [x // 1000 for x in times]
            if len(set(micros)) != len(micros):
                log.warning("%s has log times that collide after truncation; it will be refused", topic)
        log.info("indexed %d image topics in %.1fs", len(self.topics), time.time() - t)

    def frame(self, topic, micros):
        """JPEG bytes of the one source frame whose log time truncates to `micros`."""
        times = self.topics[topic]
        hits = [t for t in times if t // 1000 == micros]
        if len(hits) != 1:
            raise RpcError(INVALID_ARGUMENT, "frame_time does not match exactly one source frame")
        with open(self.path, "rb") as f:
            for _, _, message in make_reader(f).iter_messages(topics=[topic], start_time=hits[0], end_time=hits[0] + 1):
                return ros1_compressed_image_data(message.data)
        raise RpcError(INVALID_ARGUMENT, "Source frame not found")

    def source_topic(self, topic):
        if topic in self.topics:
            return topic
        if topic.endswith("/h264") and topic[: -len("/h264")] in self.topics:
            return topic[: -len("/h264")]
        raise RpcError(INVALID_ARGUMENT, f"Topic {topic} is not an image topic of the local MCAP")

    def frames(self, topic, seed_micros, end_micros):
        """[(log_time_ns, jpeg_bytes)] for the seed frame and every frame with seed < t <= end."""
        times = self.topics[topic]
        micros = [x // 1000 for x in times]
        if len(set(micros)) != len(micros):
            raise RpcError(FAILED_PRECONDITION, "Source frames collide after truncation to microseconds")
        try:
            start = micros.index(seed_micros)
        except ValueError:
            raise RpcError(INVALID_ARGUMENT, "Seed frame_time does not match a source frame") from None
        last = start
        while last + 1 < len(micros) and micros[last + 1] <= end_micros:
            last += 1
        out = []
        with open(self.path, "rb") as f:
            for _, _, message in make_reader(f).iter_messages(
                topics=[topic], start_time=times[start], end_time=times[last] + 1
            ):
                out.append((message.log_time, ros1_compressed_image_data(message.data)))
        out.sort(key=lambda item: item[0])
        return out


def ros1_compressed_image_data(buf):
    """sensor_msgs/CompressedImage (ROS1): header{seq,stamp,frame_id}, format, data."""
    at = 4 + 8  # seq, stamp
    (n,) = struct.unpack_from("<I", buf, at)
    at += 4 + n  # frame_id
    (n,) = struct.unpack_from("<I", buf, at)
    at += 4 + n  # format
    (n,) = struct.unpack_from("<I", buf, at)
    at += 4
    return bytes(buf[at : at + n])


# ---------------------------------------------------------------- model


class Tracker:
    def __init__(self, checkpoint, config):
        import torch
        from sam2.build_sam import build_sam2, build_sam2_video_predictor
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        self.torch = torch
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        t = time.time()
        self.predictor = build_sam2_video_predictor(config, str(checkpoint), device=device)
        self.image = SAM2ImagePredictor(build_sam2(config, str(checkpoint), device=device))
        self.image_key = None
        # One model call at a time on the shared device.
        self.lock = threading.Lock()
        log.info("SAM2 %s on %s loaded in %.1fs", Path(checkpoint).name, device, time.time() - t)

    def segment(self, key, jpeg, points, labels, box):
        """Best mask for clicks (pixel coords, 1 positive / 0 negative) and an optional box."""
        with self.lock, self.torch.inference_mode():
            if self.image_key != key or jpeg is not None:
                if jpeg is None:
                    raise RpcError(INVALID_ARGUMENT, "Upload the displayed frame as `image`")
                rgb = cv2.cvtColor(cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
                self.image.set_image(rgb)
                self.image_key = key
            masks, scores, low_res = self.image.predict(
                point_coords=np.array(points, np.float32) if points else None,
                point_labels=np.array(labels, np.int32) if points else None,
                box=np.array(box, np.float32) if box else None,
                # One click is ambiguous: take the best of three. More clicks pin it down.
                multimask_output=len(points) <= 1 and not box,
            )
            best = int(np.argmax(scores))
            return masks[best] > 0, float(scores[best])

    def run(self, directory, seeds, emit, cancelled):
        """seeds: [(obj_id, bool mask)] on frame 0. emit(frame_idx, {obj_id: bool mask})."""
        torch = self.torch
        with torch.inference_mode():
            state = self.predictor.init_state(directory, offload_video_to_cpu=True)
            try:
                for obj_id, mask in seeds:
                    self.predictor.add_new_mask(state, frame_idx=0, obj_id=obj_id, mask=torch.from_numpy(mask))
                for frame_idx, obj_ids, logits in self.predictor.propagate_in_video(state):
                    if cancelled.is_set():
                        return
                    if frame_idx == 0:
                        continue
                    emit(frame_idx, {oid: (logits[i, 0] > 0).cpu().numpy() for i, oid in enumerate(obj_ids)})
            finally:
                self.predictor.reset_state(state)


def seed_mask(frame, width, height):
    geometry = frame.WhichOneof("geometry")
    if geometry == "mask":
        rle = {"size": [height, width], "counts": frame.mask.counts.encode("ascii")}
        try:
            mask = coco.decode(rle).astype(bool)
        except Exception as error:  # noqa: BLE001
            raise RpcError(INVALID_ARGUMENT, f"Seed mask does not decode at {width}x{height}: {error}") from None
    elif geometry == "polygons":
        mask = np.zeros((height, width), np.uint8)
        for polygon in frame.polygons.polygons:
            if len(polygon.points) < 3:
                raise RpcError(INVALID_ARGUMENT, "Polygon requires at least three vertices")
            points = np.array([[p.x, p.y] for p in polygon.points], np.float64)
            cv2.fillPoly(mask, [np.round(points).astype(np.int32)], 1)
        mask = mask.astype(bool)
    else:
        raise RpcError(INVALID_ARGUMENT, "Seed requires polygons or a mask")
    if not mask.any():
        raise RpcError(INVALID_ARGUMENT, "Seed geometry has no foreground pixels")
    return mask


def rle_counts(mask):
    return coco.encode(np.asfortranarray(mask.astype(np.uint8)))["counts"].decode("ascii")


# ---------------------------------------------------------------- gRPC-Web


def data_frame(message):
    payload = message.SerializeToString()
    return b"\x00" + struct.pack(">I", len(payload)) + payload


def trailer_frame(code, message=""):
    text = f"grpc-status:{code}\r\ngrpc-message:{message.replace(chr(13), ' ').replace(chr(10), ' ')}\r\n"
    payload = text.encode()
    return b"\x80" + struct.pack(">I", len(payload)) + payload


def cors(request):
    return {
        "Access-Control-Allow-Origin": request.headers.get("Origin", "*"),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers", "*"),
        "Access-Control-Expose-Headers": "grpc-status, grpc-message",
        "Access-Control-Max-Age": "600",
    }


async def options(request):
    return web.Response(status=204, headers=cors(request))


async def propagate(request):
    app = request.app
    headers = {**cors(request), "Content-Type": "application/grpc-web+proto"}
    body = await request.read()
    if len(body) < 5 or body[0] != 0:
        return web.Response(headers={**headers, "grpc-status": str(INVALID_ARGUMENT), "grpc-message": "bad frame"})
    req = svc.PropagateAnnotationRequest.FromString(body[5 : 5 + struct.unpack(">I", body[1:5])[0]])
    started = time.time()
    try:
        p = req.propagation
        if not p.seeds:
            raise RpcError(INVALID_ARGUMENT, "Propagation requires seeds")
        seed_micros = {micros_of(s.frame_time) for s in p.seeds}
        if len(seed_micros) != 1:
            raise RpcError(INVALID_ARGUMENT, "All seeds must share one frame_time")
        seed_micros = seed_micros.pop()
        end_micros = micros_of(p.end_time)
        if end_micros <= seed_micros:
            raise RpcError(INVALID_ARGUMENT, "end_time must be later than the seed frame")
        if len({s.instance for s in p.seeds}) != len(p.seeds):
            raise RpcError(INVALID_ARGUMENT, "Duplicate seed instance")
        if app["media"] is None:
            raise RpcError(FAILED_PRECONDITION, "Started without --mcap: propagation is not served here")
        topic = app["media"].source_topic(p.topic)
        if app["lock"].locked():
            raise RpcError(RESOURCE_EXHAUSTED, "Another propagation is running on this machine")
    except RpcError as error:
        log.info("rejected: %s", error)
        return web.Response(headers={**headers, "grpc-status": str(error.code), "grpc-message": str(error)})

    response = web.StreamResponse(headers=headers)
    await response.prepare(request)
    async with app["lock"]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        cancelled = threading.Event()
        directory = tempfile.mkdtemp(prefix="seg-prop-")

        def work():
            try:
                frames = app["media"].frames(topic, seed_micros, end_micros)
                for index, (_, jpeg) in enumerate(frames):
                    Path(directory, f"{index:05d}.jpg").write_bytes(jpeg)
                first = cv2.imdecode(np.frombuffer(frames[0][1], np.uint8), cv2.IMREAD_UNCHANGED)
                height, width = first.shape[:2]
                seeds = [(i + 1, seed_mask(s, width, height)) for i, s in enumerate(p.seeds)]
                names = {i + 1: s.instance for i, s in enumerate(p.seeds)}
                total = len(frames) - 1
                loop.call_soon_threadsafe(queue.put_nowait, ("ready", total))
                if total == 0:
                    return

                def emit(frame_idx, masks):
                    micros = frames[frame_idx][0] // 1000
                    event = svc.PropagateAnnotationResponse()
                    set_micros(event.frame.frame_time, micros)
                    for oid, mask in sorted(masks.items()):
                        if mask.any():
                            observation = event.frame.annotations.add()
                            observation.instance = names[oid]
                            set_micros(observation.frame_time, micros)
                            observation.mask.counts = rle_counts(mask)
                    loop.call_soon_threadsafe(queue.put_nowait, ("frame", event))

                with app["tracker"].lock:
                    app["tracker"].run(directory, seeds, emit, cancelled)
            except RpcError as error:
                loop.call_soon_threadsafe(queue.put_nowait, ("error", error))
            except Exception as error:  # noqa: BLE001
                log.exception("propagation failed")
                loop.call_soon_threadsafe(queue.put_nowait, ("error", RpcError(INTERNAL, str(error))))
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, ("end", None))

        worker = loop.run_in_executor(None, work)
        processed, total = 0, 0
        try:
            while True:
                kind, value = await queue.get()
                if kind == "ready":
                    total = value
                    event = svc.PropagateAnnotationResponse()
                    event.ready.total_frames = total
                    await response.write(data_frame(event))
                elif kind == "frame":
                    processed += 1
                    await response.write(data_frame(value))
                elif kind == "error":
                    event = svc.PropagateAnnotationResponse()
                    event.error.code, event.error.message = value.code, str(value)
                    await response.write(data_frame(event))
                    await response.write(trailer_frame(0))
                    log.info("error after %d frames: %s", processed, value)
                    return response
                elif kind == "end":
                    break
            event = svc.PropagateAnnotationResponse()
            event.done.processed_frames, event.done.total_frames = processed, total
            await response.write(data_frame(event))
            await response.write(trailer_frame(0))
            log.info("%s: %d/%d frames in %.1fs", p.topic, processed, total, time.time() - started)
        except (ConnectionResetError, asyncio.CancelledError):
            log.info("client stopped after %d/%d frames", processed, total)
            raise
        finally:
            cancelled.set()
            await asyncio.shield(worker)
            shutil.rmtree(directory, ignore_errors=True)
    return response


async def segment(request):
    """Quick annotation (not in the contract): {topic, frameTimeMicros, points:[{x,y,positive}], box?}
    in source pixels → {counts, width, height, score}. COCO RLE at the source frame size.

    The browser uploads the frame it displays as multipart (`image` file + `request` JSON), so any
    recording works. A plain JSON body reads the frame from --mcap instead (local recording only)."""
    headers = cors(request)
    try:
        image = None
        multipart = request.content_type.startswith("multipart/")
        if multipart:
            form = await request.post()
            body = json.loads(form["request"])
            upload = form.get("image")
            if upload is not None:
                image = upload.file.read()
                if len(image) > 16 * 1024 * 1024:
                    raise RpcError(INVALID_ARGUMENT, "Image larger than 16 MiB")
        else:
            body = await request.json()
        media = request.app["media"]
        micros = int(body["frameTimeMicros"])
        if multipart:
            # Browser uploads: a request without `image` may only reuse the cached embedding of
            # the same frame; it never falls back to --mcap, which may be another recording.
            topic = str(body["topic"])
            if image is None and request.app["tracker"].image_key != (topic, micros):
                raise RpcError(INVALID_ARGUMENT, "Upload the displayed frame as `image`")
        elif media is None:
            raise RpcError(INVALID_ARGUMENT, "Upload the displayed frame as `image`")
        else:
            topic = media.source_topic(body["topic"])
        points = [[float(p["x"]), float(p["y"])] for p in body.get("points", [])]
        labels = [1 if p.get("positive", True) else 0 for p in body.get("points", [])]
        box = body.get("box")
        if not points and not box:
            raise RpcError(INVALID_ARGUMENT, "Add at least one point or a box")
        if labels and not any(labels) and not box:
            raise RpcError(INVALID_ARGUMENT, "Add at least one positive point")
        started = time.time()
        loop = asyncio.get_running_loop()

        def work():
            tracker = request.app["tracker"]
            # The embedding of the last clicked frame is cached; skip the MCAP read too.
            if image is not None:
                jpeg = image
            elif multipart:
                jpeg = None  # checked against the cache in segment(), under the model lock
            else:
                jpeg = None if tracker.image_key == (topic, micros) else media.frame(topic, micros)
            return tracker.segment((topic, micros), jpeg, points, labels, box)

        mask, score = await loop.run_in_executor(None, work)
        height, width = mask.shape
        log.info("segment %s @%d: %d points, %.0f ms, area %d", topic, micros, len(points), (time.time() - started) * 1000, int(mask.sum()))
        return web.json_response(
            {"counts": rle_counts(mask), "width": width, "height": height, "score": score, "area": int(mask.sum())},
            headers=headers,
        )
    except RpcError as error:
        return web.json_response({"error": str(error)}, status=400, headers=headers)
    except (KeyError, ValueError, TypeError) as error:
        return web.json_response({"error": f"bad request: {error}"}, status=400, headers=headers)
    except Exception as error:  # noqa: BLE001 - report model failures to the browser
        log.exception("segment failed")
        return web.json_response({"error": f"segment failed: {error}"}, status=500, headers=headers)


async def unimplemented(request):
    return web.Response(
        headers={**cors(request), "Content-Type": "application/grpc-web+proto",
                 "grpc-status": str(UNIMPLEMENTED), "grpc-message": "Only PropagateAnnotation is served locally"}
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcap", help="local MCAP for propagation and JSON quick segment; optional")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18876)
    parser.add_argument("--checkpoint", default=str(HERE / "weights" / "sam2.1_hiera_small.pt"))
    parser.add_argument("--config", default="configs/sam2.1/sam2.1_hiera_s.yaml")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app["media"] = Media(args.mcap) if args.mcap else None
    app["tracker"] = Tracker(args.checkpoint, args.config)
    app["lock"] = asyncio.Lock()
    app.router.add_route("OPTIONS", "/{tail:.*}", options)
    app.router.add_post(PATH, propagate)
    app.router.add_post("/segment", segment)
    app.router.add_post("/{tail:.*}", unimplemented)
    web.run_app(app, host=args.host, port=args.port, access_log=None)


if __name__ == "__main__":
    main()
