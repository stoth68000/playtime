#!/bin/bash

# MacOs:
# brew install cmake ninja
cd tmp

git clone https://github.com/MediaArea/MediaInfo.git
git checkout v26.05

cmake \
  -G Ninja \
  -S MediaInfo/Project/CMake/CLI \
  -B build-arm64 \
  -D CMAKE_BUILD_TYPE=Release \
  -D CMAKE_INSTALL_PREFIX="$PWD/install-arm64" \
  -D CMAKE_OSX_ARCHITECTURES=arm64 \
  -D CMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
  -D BUILD_ZENLIB=ON \
  -D BUILD_ZLIB=ON \
  -D ZLIB_BUILD_SHARED=OFF \
  -D ZLIB_BUILD_TESTING=OFF

cmake --build build-arm64 --parallel "$(sysctl -n hw.logicalcpu)"

cp ./build-arm64/mediainfo ..
