#!/usr/bin/env bash
# Local PropagateAnnotation sidecar (SAM2.1 on Apple Silicon). See README.md.
#   tools/seg-local-propagation/run.sh [/path/to/record.mcap] [--port 18876]
# Without an MCAP it only serves quick annotation on frames the browser uploads.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MCAP_ARGS=()
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then MCAP_ARGS=(--mcap "$1"); shift; fi
VENV="$HERE/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  uv venv -q --python 3.12 "$VENV"
  VIRTUAL_ENV="$VENV" uv pip install -q torch torchvision \
    "git+https://github.com/facebookresearch/sam2.git" \
    opencv-python-headless pycocotools mcap aiohttp "protobuf>=5" googleapis-common-protos
fi
mkdir -p "$HERE/weights"
CKPT="$HERE/weights/sam2.1_hiera_small.pt"
if [ ! -s "$CKPT" ]; then
  curl -fSL -o "$CKPT.part" https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
  mv "$CKPT.part" "$CKPT"
fi
exec "$VENV/bin/python" "$HERE/server.py" ${MCAP_ARGS[@]+"${MCAP_ARGS[@]}"} --checkpoint "$CKPT" "$@"
