#!/bin/sh
# The steps every installer ends with, once Python 3.10+, Git, curl and unzip exist:
# the project's Python packages in .venv, the decomp submodule, the commit hook,
# and Emscripten plus the PowerPC binutils in .toolchain/ (tools/setup-toolchain.sh).
#
#   install/finish.sh /path/to/python3
#
# Node.js comes with Emscripten, so it needs no separate install. Nothing here
# downloads anything from the game: you still supply your own ISO to ./build.sh.
set -eu
cd "$(dirname "$0")/.."
python=$1

if [ ! -d .git ]; then
  echo "This folder is not a Git checkout. Clone the repository with git (not a ZIP download) and run the installer from there." >&2
  exit 1
fi

echo "== Python packages (from PyPI) into .venv"
if [ ! -x .venv/bin/python3 ] || ! .venv/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3,10))' 2>/dev/null; then
  rm -rf .venv
  "$python" -m venv .venv
fi
.venv/bin/python3 -m pip install --upgrade --quiet pip
.venv/bin/python3 -m pip install --quiet -r requirements.txt

echo "== Decomp submodule (github.com/conhlee/rhf) and commit hook"
git submodule update --init third_party/rhf-decomp
git config core.hooksPath hooks

echo "== Emscripten 5.0.7 (with Node.js) and PowerPC binutils into .toolchain/"
RHF_PYTHON="$PWD/.venv/bin/python3" tools/setup-toolchain.sh

# Check the same things build.sh checks before it starts.
. ./tools/env.sh
for tool in git node emcc "${RHF_OBJDUMP:-powerpc-eabi-objdump}"; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Setup finished but $tool is still missing." >&2; exit 1; }
done
"$RHF_PYTHON" -c 'import numpy, PIL, cryptography'
echo
echo "Everything is installed: Python $("$RHF_PYTHON" -c 'import platform; print(platform.python_version())'), Node.js $(node --version), $(emcc --version | head -n 1)."
