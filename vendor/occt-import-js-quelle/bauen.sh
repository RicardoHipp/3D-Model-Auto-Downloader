#!/bin/bash
# Baut occt-import-js 0.0.23 mit den Aenderungen aus aendern.py - in zwei
# Fassungen: einfaedig (occt-import-js.js/.wasm) und mit Threads
# (occt-import-js-mt.js/.wasm).
# Laeuft im Docker-Abbild emscripten/emsdk:3.1.69 - derselben Fassung, mit
# der die Bibliothek selbst gebaut wird. /patch enthaelt aendern.py,
# nach /out kommen die fertigen Dateien.
set -euo pipefail

mkdir -p /work
cd /work
git clone -q --depth 1 --branch 0.0.23 https://github.com/kovacsv/occt-import-js.git src
cd src

# OpenCascade auf genau dem Stand, den 0.0.23 festlegt. Vom GitHub-Spiegel,
# weil der das Holen eines einzelnen Standes erlaubt.
OCCT_STAND=$(git ls-tree HEAD occt | awk '{print $3}')
echo "OpenCascade-Stand: $OCCT_STAND"
git config submodule.occt.url https://github.com/Open-Cascade-SAS/OCCT.git
git submodule update --init --depth 1 occt

python3 /patch/aendern.py /work/src

for fassung in einfach threads; do
  if [ "$fassung" = threads ]; then schalter=ON; else schalter=OFF; fi
  echo "== Fassung $fassung"
  emcmake cmake -B "build-$fassung" -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release \
    -DOCCT_IMPORT_THREADS=$schalter . > "/out/cmake-$fassung.log" 2>&1
  cmake --build "build-$fassung" -j"$(nproc)" > "/out/build-$fassung.log" 2>&1
  cp build-$fassung/Release/occt-import-js*.js build-$fassung/Release/occt-import-js*.wasm /out/
done

ls -la /out
echo "FERTIG"
