#!/bin/sh
# Download the build toolchain into .toolchain/ (git-ignored):
#   Emscripten 5.0.7 and the GameCube/Wii PowerPC binutils used by the decomp.
# Then run:  . tools/env.sh
set -eu
cd "$(dirname "$0")/.."
. ./tools/env.sh
mkdir -p .toolchain
cd .toolchain

if [ ! -x emsdk/upstream/emscripten/emcc ]; then
  [ -d emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git
  "$RHF_PYTHON" emsdk/emsdk.py install 5.0.7
fi
if [ ! -f emsdk/.emscripten ]; then
  "$RHF_PYTHON" emsdk/emsdk.py activate 5.0.7
fi

if [ ! -x binutils/powerpc-eabi-objdump ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-*) asset=macos-universal ;;
    Linux-x86_64) asset=linux-x86_64 ;;
    Linux-aarch64|Linux-arm64) asset=linux-aarch64 ;;
    *) echo "No prebuilt PowerPC binutils for $(uname -sm); install powerpc-eabi-objdump and set RHF_OBJDUMP." >&2; exit 1 ;;
  esac
  mkdir -p binutils
  curl -sSLf -o binutils.zip "https://github.com/encounter/gc-wii-binutils/releases/download/2.42-1/$asset.zip"
  unzip -oq binutils.zip -d binutils
  rm binutils.zip
  chmod +x binutils/powerpc-eabi-*
fi
echo "Toolchain ready. Run: . tools/env.sh"
