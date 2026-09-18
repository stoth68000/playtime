#!/bin/bash

git clone https://git.ffmpeg.org/ffmpeg.git build-ffmpeg
cd build-ffmpeg
git checkout n9.0.1

./configure \
    --prefix="target-root" \
    --cc=clang \
    --arch=arm64 \
    --enable-static \
    --disable-shared \
    --disable-autodetect \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --enable-pthreads \
    --enable-videotoolbox \
    --enable-audiotoolbox \
    --enable-securetransport \
    --extra-cflags="-O3 -mmacosx-version-min=11.0" \
    --extra-ldflags="-mmacosx-version-min=11.0"

make -j

cp ffmpeg ..
cp ffprobe ..
