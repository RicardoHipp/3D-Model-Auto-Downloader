#!/bin/bash
# Wie bauen.sh, aber mit dauerhaftem Bauordner: /work ist ein Docker-Volume,
# das zwischen den Laeufen erhalten bleibt. Der erste Lauf baut alles (wie
# bauen.sh), jeder weitere nur, was sich durch aendern.py geaendert hat.
#
#   docker volume create occt-bau
#   docker run --rm -v occt-bau:/work -v "<dieser Ordner>:/patch:ro" ^
#       -v "<Ausgabeordner>:/out" emscripten/emsdk:3.1.69 bash /patch/bauen_schnell.sh [threads]
#
# Ohne Angabe entstehen beide Fassungen, mit "threads" nur die mit Threads -
# fuer Versuche reicht die, die Erweiterung nutzt sie. Fuer einen Stand, der
# veroeffentlicht wird, bleibt bauen.sh der Massstab: frische Quellen, nichts
# aus frueheren Laeufen.
set -euo pipefail

FASSUNGEN="${1:-einfach threads}"

mkdir -p /work
cd /work
if [ ! -d src/.git ]; then
  git clone -q --depth 1 --branch 0.0.23 https://github.com/kovacsv/occt-import-js.git src
  cd src
  git config submodule.occt.url https://github.com/Open-Cascade-SAS/OCCT.git
  git submodule update --init --depth 1 occt
else
  cd src
  # Zurueck auf den Originalstand: Nur die Dateien, die aendern.py anfasst,
  # bekommen dadurch eine neue Zeit - und werden neu uebersetzt.
  git checkout -q -- .
  git -C occt checkout -q -- .
  git -C occt clean -fdq
fi

python3 /patch/aendern.py /work/src

for fassung in $FASSUNGEN; do
  if [ "$fassung" = threads ]; then schalter=ON; else schalter=OFF; fi
  echo "== Fassung $fassung"
  if [ ! -f "build-$fassung/CMakeCache.txt" ]; then
    emcmake cmake -B "build-$fassung" -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release \
      -DOCCT_IMPORT_THREADS=$schalter . > "/out/cmake-$fassung.log" 2>&1
  else
    # Neu einlesen: aendern.py kann Dateien hinzufuegen (BRepMesh_Statistik).
    emcmake cmake "build-$fassung" > "/out/cmake-$fassung.log" 2>&1
  fi
  cmake --build "build-$fassung" -j"$(nproc)" > "/out/build-$fassung.log" 2>&1
  cp build-$fassung/Release/occt-import-js*.js build-$fassung/Release/occt-import-js*.wasm /out/
done

ls -la /out
echo "FERTIG"
