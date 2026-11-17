#!/usr/bin/env bash
# Quick-annotation SAM2 server (Apple Silicon MPS, or CPU). See README.md.
#   tools/seg-quick-annotation/run.sh [--port 18876] [--allow-origin REGEX]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="$HERE/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  uv venv -q --python 3.12 "$VENV"
  VIRTUAL_ENV="$VENV" uv pip install -q torch torchvision \
    "git+https://github.com/facebookresearch/sam2.git" \
    opencv-python-headless pycocotools aiohttp
fi
mkdir -p "$HERE/weights"
CKPT="$HERE/weights/sam2.1_hiera_small.pt"
if [ ! -s "$CKPT" ]; then
  curl -fSL -o "$CKPT.part" https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
  mv "$CKPT.part" "$CKPT"
fi
exec "$VENV/bin/python" "$HERE/server.py" --checkpoint "$CKPT" "$@"
