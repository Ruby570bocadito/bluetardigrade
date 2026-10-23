#!/usr/bin/env bash
# Turns the clips record_demo.mjs recorded (demo/raw/*.webm + trim.json)
# into what the README shows: one looping animated WebP per clip (GitHub
# renders it inline like a GIF at a quarter of the weight; a video only
# plays from an uploaded attachment) and the whole tour as a single
# H.264 MP4. Needs ffmpeg (with libwebp and libx264) and python3.
#
#   docs/assets/src/make_media.sh [raw-dir] [out-dir]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
raw="${1:-$here/../demo/raw}"
out="${2:-$here/../demo}"
mkdir -p "$out"

# the tour order, which is also the README's
clips=(login triage incidents hosts detection telemetry respond navigation)
width=1120
fps=12

trim_of() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], 0))' "$raw/trim.json" "$1"; }

list="$(mktemp)"
trap 'rm -f "$list"' EXIT
for name in "${clips[@]}"; do
  src="$raw/$name.webm"
  [ -f "$src" ] || { echo "missing $src" >&2; exit 1; }
  ss="$(trim_of "$name")"
  ffmpeg -v error -y -ss "$ss" -i "$src" -vf "fps=$fps,scale=$width:-1:flags=lanczos" \
    -c:v libwebp_anim -quality 72 -compression_level 6 -loop 0 "$out/$name.webp"
  # the same cut at full size for the tour
  ffmpeg -v error -y -ss "$ss" -i "$src" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -r 30 -an "$out/.$name.mp4"
  echo "file '$out/.$name.mp4'" >> "$list"
  printf '%-11s %s\n' "$name" "$(du -h "$out/$name.webp" | cut -f1)"
done

ffmpeg -v error -y -f concat -safe 0 -i "$list" -c copy -movflags +faststart "$out/bluetardigrade-demo.mp4"
rm -f "$out"/.*.mp4
echo "tour        $(du -h "$out/bluetardigrade-demo.mp4" | cut -f1)"
