#!/usr/bin/env sh
# Regenerates e2e/assets/stick-squat.webm: a 2 s, 360x640 rendered stick figure that
# drops and rises once. Synthetic on purpose (no real person, SPEC §8). Needs ffmpeg.
set -eu
out="$(dirname "$0")/assets/stick-squat.webm"
# d = hip drop in px, one smooth down-and-up over the 2 s clip.
d='(60*(1-cos(PI*t)))'
ffmpeg -y -loglevel error -f lavfi -i "color=c=0xdddddd:s=360x640:r=15:d=2" -vf "\
drawbox=x=160:y=110+$d:w=40:h=40:color=black:t=fill,\
drawbox=x=172:y=150+$d:w=16:h=150:color=black:t=fill,\
drawbox=x=120:y=170+$d:w=120:h=10:color=black:t=fill,\
drawbox=x=150:y=300+$d:w=12:h=170-$d:color=black:t=fill,\
drawbox=x=198:y=300+$d:w=12:h=170-$d:color=black:t=fill,\
drawbox=x=140:y=470:w=24:h=110:color=black:t=fill,\
drawbox=x=196:y=470:w=24:h=110:color=black:t=fill" \
  -c:v libvpx-vp9 -b:v 0 -crf 45 -pix_fmt yuv420p -an "$out"
echo "wrote $out"
