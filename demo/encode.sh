#!/bin/sh
# Turns .frames/ (from record.mjs) into gavil-demo.mp4: 30 fps, 1920x1200, H.264, plays everywhere.
set -e
cd "$(dirname "$0")"
ffmpeg -y -loglevel error -f concat -safe 0 -i .frames/list.txt \
  -vf "fps=30,scale=1920:1200:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart gavil-demo.mp4
ls -lh gavil-demo.mp4
