# Source this file to put the local toolchain on PATH:  . tools/env.sh
_rhf_root=$(cd "$(dirname "${BASH_SOURCE:-$0}")/.." 2>/dev/null && pwd)
[ -d "$_rhf_root/.toolchain" ] || _rhf_root=$(pwd)
export PATH="$_rhf_root/.toolchain/emsdk/upstream/emscripten:$_rhf_root/.toolchain/binutils:$PATH"
if [ -x "$_rhf_root/.venv/bin/python3" ]; then
  export PATH="$_rhf_root/.venv/bin:$PATH"
fi
# Apple's system Python is too old for current Emscripten. Prefer the project's
# venv, then a supported interpreter already installed on this machine.
if [ -n "${RHF_PYTHON:-}" ]; then
  _rhf_python=$RHF_PYTHON
else
  _rhf_python=
  for _rhf_candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10; do
    if command -v "$_rhf_candidate" >/dev/null 2>&1 && "$_rhf_candidate" -c 'import sys; sys.exit(sys.version_info < (3,10))' 2>/dev/null; then
      _rhf_python=$(command -v "$_rhf_candidate")
      break
    fi
  done
fi
if [ -z "$_rhf_python" ] || ! "$_rhf_python" -c 'import sys; sys.exit(sys.version_info < (3,10))' 2>/dev/null; then
  echo 'Python 3.10+ is required. Install it or set RHF_PYTHON to its executable.' >&2
  return 1
fi
export RHF_PYTHON="$_rhf_python"
export EMSDK_PYTHON="$_rhf_python"
if [ -z "${EM_CONFIG:-}" ] && [ -f "$_rhf_root/.toolchain/emsdk/.emscripten" ]; then
  export EM_CONFIG="$_rhf_root/.toolchain/emsdk/.emscripten"
fi
unset _rhf_python _rhf_candidate
unset _rhf_root
