#!/bin/sh
# usage: compose.sh <judge.mp4> <admin.mp4>  ->  out/gavil-demo.mp4 (1080p) and out/gavil-demo-discord.mp4 (under 10 MB)
# Lays the two ndemo recordings on the brand backdrops from card.html (run render-cards.mjs first) between an intro and an outro.
# PRESET (default medium) sets the x264 preset of the full-quality file, DPRESET (default slow) the Discord one's.
# A recording can be any size, it is scaled to its card frame with lanczos (judge 390x844 or 780x1688, admin 1280x800 or 2560x1600),
# but its aspect ratio must match the frame's within 2% and it must carry an audio stream (the concat below joins audio and video).
set -e
[ $# -eq 2 ] || { echo "usage: compose.sh <judge.mp4> <admin.mp4>" >&2; exit 2; }
abs() { case $1 in /*) echo "$1";; *) echo "$PWD/$1";; esac; }
J=$(abs "$1"); A=$(abs "$2"); cd "$(dirname "$0")/out"
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
# The video stream's own length: a recording's audio can run a frame or two longer, and the fades are timed against the video.
vdur() { d=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$1"); case $d in ''|N/A) dur "$1";; *) echo "$d";; esac; }
check() { # <clip> <frame width> <frame height>: refuse a missing clip, one that would be squashed into its frame, or one with no sound
  [ -f "$1" ] || { echo "$1 not found" >&2; exit 1; }
  ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$1" | grep -q audio || { echo "$1 has no audio stream" >&2; exit 1; }
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$1" | awk -F, -v n="$1" -v w=$2 -v h=$3 \
    '{ r = ($1 / $2) / (w / h); if (r < 0.98 || r > 1.02) { printf "%s is %dx%d but its card frame is %dx%d: the aspect ratios differ\n", n, $1, $2, w, h > "/dev/stderr"; exit 1 } }'
}
check "$J" 446 965; check "$A" 1552 970
# The parts are intermediates: encode them on the Mac's media engine when there is one, so a busy CPU does not stall the
# compose, else x264 veryfast at near-lossless quality. Both finished files are x264.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox; then V="-c:v h264_videotoolbox -b:v 16M -profile:v high"
else V="-c:v libx264 -preset veryfast -crf 14"; fi
# Colour: ffmpeg turns RGB into YUV with the BT.601 matrix unless told otherwise, but players treat untagged HD video as BT.709,
# which shifts the brand reds by about +14 and the teals by about -12 levels. So every RGB -> YUV step below names BT.709 (the
# recordings are BT.601 JPEG-range and are read as such) and every output is tagged BT.709.
YUV="scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
TAG="-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
X264TAG="-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709" # libx264 writes primaries and transfer only through this
ENC="$V $TAG -r 30 -c:a aac -b:a 160k -ar 48000 -ac 2"
# Looped images are read at 30 fps (the image default, 25, would resample the 30 fps clips), the masks are one frame
# (a looped mask never ends, so neither would alphamerge), and every part has an explicit length. The cards fade in and out;
# a recording fades in and out of black too, over its first and last 0.4 s (its narration is silent there).
card() { ffmpeg -y -v error -loop 1 -framerate 30 -t $2 -i card-$1.png -f lavfi -t $2 -i anullsrc=r=48000:cl=stereo \
  -vf "fade=t=in:st=0:d=0.5,fade=t=out:st=$(echo "$2-0.5" | bc):d=0.5,$YUV" $ENC -shortest part-$1.mp4; }
card intro 3.5
card outro 4
ffmpeg -y -v error -loop 1 -framerate 30 -i card-judge.png -i "$J" -i mask-phone.png -filter_complex \
  "[1:v]scale=446:965:flags=lanczos,format=rgba[v];[2:v]format=gray[m];[v][m]alphamerge[vm];[0:v][vm]overlay=1192:57:format=gbrp:shortest=1,fade=t=in:st=0:d=0.4,fade=t=out:st=$(echo "$(vdur "$J")-0.4" | bc):d=0.4,$YUV[o]" \
  -map "[o]" -map 1:a -t "$(dur "$J")" $ENC part-judge.mp4
ffmpeg -y -v error -loop 1 -framerate 30 -i card-admin.png -i "$A" -i mask-admin.png -filter_complex \
  "[1:v]scale=1552:970:flags=lanczos,format=rgba[v];[2:v]format=gray[m];[v][m]alphamerge[vm];[0:v][vm]overlay=184:96:format=gbrp:shortest=1,fade=t=in:st=0:d=0.4,fade=t=out:st=$(echo "$(vdur "$A")-0.4" | bc):d=0.4,$YUV[o]" \
  -map "[o]" -map 1:a -t "$(dur "$A")" $ENC part-admin.mp4
ffmpeg -y -v error -stats -i part-intro.mp4 -i part-judge.mp4 -i part-admin.mp4 -i part-outro.mp4 -filter_complex \
  "[0:v][0:a][1:v][1:a][2:v][2:a][3:v][3:a]concat=n=4:v=1:a=1[v][a]" -map "[v]" -map "[a]" \
  -c:v libx264 -preset ${PRESET:-medium} -crf 20 -pix_fmt yuv420p $TAG $X264TAG -r 30 -c:a aac -b:a 128k -movflags +faststart gavil-demo.mp4
# Discord (free accounts upload up to 10 MB): 720p, two-pass to 9.3 MB (decimal, leaving room for the container).
D=$(dur gavil-demo.mp4)
VB=$(echo "9.3*8*1000/$D - 64" | bc -l | cut -d. -f1)
ffmpeg -y -v error -stats -i gavil-demo.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -preset ${DPRESET:-slow} -b:v ${VB}k $TAG $X264TAG -pass 1 -passlogfile x264 -an -f mp4 /dev/null
ffmpeg -y -v error -stats -i gavil-demo.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -preset ${DPRESET:-slow} -b:v ${VB}k $TAG $X264TAG -pass 2 -passlogfile x264 -c:a aac -b:a 64k -ac 1 -movflags +faststart gavil-demo-discord.mp4
rm -f x264*.log x264*.mbtree
S=$(wc -c < gavil-demo-discord.mp4); [ "$S" -lt 10000000 ] || { echo "gavil-demo-discord.mp4 is $S bytes, not under 10 MB" >&2; exit 1; }
ls -la gavil-demo.mp4 gavil-demo-discord.mp4; echo "duration ${D}s, discord video ${VB}k"
