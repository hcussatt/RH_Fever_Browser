#!/bin/bash
# Install everything needed to build and run the games on a Mac, except the game itself.
# Double-click this file in Finder, or run:  install/macos.command
#
# What it installs, and from where:
#   - Xcode Command Line Tools (Git), from Apple, through macOS's own installer dialog.
#   - Python 3.13 from python.org, only when no Python 3.10+ is installed already.
#     The package's Python Software Foundation signature is checked before it is installed.
#   - numpy, Pillow and cryptography from PyPI, into .venv in this folder.
#   - Emscripten 5.0.7 (which includes Node.js) from Emscripten's official GitHub and
#     storage.googleapis.com, and the PowerPC binutils from github.com/encounter/gc-wii-binutils,
#     into .toolchain/ in this folder (tools/setup-toolchain.sh).
# Nothing from the game is downloaded: you supply your own ISO to ./build.sh afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

python_version=3.13.7
python_pkg_url="https://www.python.org/ftp/python/$python_version/python-$python_version-macos11.pkg"

echo "== Xcode Command Line Tools (Git)"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install 2>/dev/null || true
  echo "A macOS dialog asks to install the Command Line Tools. Click Install; this waits until it finishes."
  until xcode-select -p >/dev/null 2>&1; do sleep 10; done
fi
git --version

echo "== Python 3.10 or newer"
find_python() {
  for candidate in "$PWD/.venv/bin/python3" python3.14 python3.13 python3.12 python3.11 python3.10 python3 \
      /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,10))' 2>/dev/null; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}
if ! python=$(find_python); then
  echo "No Python 3.10+ found (macOS's own python3 is 3.9). Installing Python $python_version from python.org."
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fL --progress-bar -o "$tmp/python.pkg" "$python_pkg_url"
  if ! pkgutil --check-signature "$tmp/python.pkg" | grep -q 'Developer ID Installer: Python Software Foundation'; then
    echo "The downloaded Python package is not signed by the Python Software Foundation. Stopping." >&2
    exit 1
  fi
  echo "macOS asks for your password to install Python."
  sudo installer -pkg "$tmp/python.pkg" -target /
  python=/Library/Frameworks/Python.framework/Versions/${python_version%.*}/bin/python3
fi
"$python" --version

install/finish.sh "$python"

cat <<'EOF'

Next, build the games from your own disc image and play:

  ./build.sh "/path/to/Rhythm Heaven Fever (USA).iso"
  ./serve.sh --open
EOF
