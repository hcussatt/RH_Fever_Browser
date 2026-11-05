#!/bin/sh
# Builds build/ctr/standin.bcfnt, the free stand-in for the 3DS system font (see font/README.md), from
# Inter and DejaVu Sans as released on GitHub (downloaded once into build/fonts, checked by SHA-256).
set -e
cd "$(dirname "$0")/../.."
out=build/ctr/standin.bcfnt
[ -s "$out" ] && [ "$out" -nt tools/ctr-harness/make-font.py ] && exit 0
PYTHON=${RHF_PYTHON:-python3}
mkdir -p build/fonts build/ctr
fetch(){ # url file sha256
  if [ ! -s "build/fonts/$2" ]; then curl -fsSL -o "build/fonts/$2.part" "$1" && mv "build/fonts/$2.part" "build/fonts/$2"; fi
  sum=$( (sha256sum "build/fonts/$2" 2>/dev/null || shasum -a 256 "build/fonts/$2") | cut -d' ' -f1)
  [ "$sum" = "$3" ] || { echo "build/fonts/$2: unexpected checksum $sum" >&2; exit 1; }; }
fetch https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip inter-4.0.zip ff970a5d4561a04f102a7cb781adbd6ac4e9b6c460914c7a101f15acb7f7d1a4
fetch https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip dejavu-2.37.zip 7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a
unzip -oqj build/fonts/inter-4.0.zip extras/otf/Inter-SemiBold.otf -d build/fonts
unzip -oqj build/fonts/dejavu-2.37.zip dejavu-fonts-ttf-2.37/ttf/DejaVuSans-Bold.ttf -d build/fonts
"$PYTHON" tools/ctr-harness/make-font.py build/fonts/Inter-SemiBold.otf build/fonts/DejaVuSans-Bold.ttf "$out"
