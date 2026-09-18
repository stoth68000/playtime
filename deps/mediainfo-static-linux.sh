#!/bin/bash

# Linux:
# dnf install ninja-build

cd tmp

git clone https://github.com/MediaArea/MediaInfo.git
git checkout v26.05

cmake \
  -G Ninja \
  -S MediaInfo/Project/CMake/CLI \
  -B build-x86_64 \
  -D CMAKE_BUILD_TYPE=Release \
  -D CMAKE_INSTALL_PREFIX="$PWD/install-x86_64" \
  -D BUILD_ZENLIB=ON \
  -D BUILD_ZLIB=ON \
  -D ZLIB_BUILD_SHARED=OFF \
  -D ZLIB_BUILD_TESTING=OFF \
  -D CMAKE_CXX_STANDARD_LIBRARIES="-ldl"

cmake --build build-x86_64

cp ./build-x86_64/mediainfo ..
