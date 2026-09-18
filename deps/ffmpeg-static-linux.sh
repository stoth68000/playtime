#!/bin/bash

git clone https://git.ffmpeg.org/ffmpeg.git build-ffmpeg
cd build-ffmpeg
git checkout n9.0.1

./configure \
    --prefix="target-root" \
    --enable-static \
    --disable-shared \
    --disable-autodetect \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --enable-pthreads \
    --disable-videotoolbox \
    --disable-audiotoolbox

make -j

cp ffmpeg ..
cp ffprobe ..
