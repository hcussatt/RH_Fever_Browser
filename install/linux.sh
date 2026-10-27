#!/bin/sh
# Install everything needed to build and run the games on Ubuntu or Debian (including
# Ubuntu under WSL on Windows, which install/windows.ps1 sets up), except the game itself.
#
#   install/linux.sh
#
# Python 3, venv, Git, curl, unzip and xz come from your distribution's apt repositories;
# the rest is install/finish.sh (PyPI packages, Emscripten with Node.js, PowerPC binutils).
# Nothing from the game is downloaded: you supply your own ISO to ./build.sh afterwards.
set -eu
cd "$(dirname "$0")/.."

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer needs apt (Ubuntu or Debian). Install Python 3.10+ with venv, git, curl, unzip and xz yourself, then run: install/finish.sh python3" >&2
  exit 1
fi

echo "== Python, Git, curl, unzip (from apt; asks for your password)"
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip git curl unzip xz-utils ca-certificates

if ! python3 -c 'import sys; sys.exit(sys.version_info < (3,10))'; then
  echo "This system's Python 3 is $(python3 --version); Python 3.10 or newer is needed (Ubuntu 22.04 or newer has it)." >&2
  exit 1
fi

install/finish.sh "$(command -v python3)"

cat <<'EOF'

Next, build the games from your own disc image and play:

  ./build.sh "/path/to/Rhythm Heaven Fever (USA).iso"
  ./serve.sh --open
EOF
