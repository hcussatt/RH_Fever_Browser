# Source this file to put the local toolchain on PATH:  . tools/env.sh
_rhf_root=$(cd "$(dirname "${BASH_SOURCE:-$0}")/.." 2>/dev/null && pwd)
[ -d "$_rhf_root/.toolchain" ] || _rhf_root=$(pwd)
export PATH="$_rhf_root/.toolchain/emsdk/upstream/emscripten:$_rhf_root/.toolchain/binutils:$PATH"
unset _rhf_root
