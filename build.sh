#!/bin/sh
# Bundle src/ into one self-contained page: index.html (no dependencies except web fonts).
cd "$(dirname "$0")"
{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' '<meta charset="utf-8">' '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' '<style>body{margin:0}[hidden]{display:none!important}</style>'
  cat src/page.html
  echo '<script>'
  for f in core missions glx shaders world aircraft render panel audio app; do cat "src/$f.js"; echo; done
  echo '</script>'
  printf '%s\n' '</body>' '</html>'
} > index.html
wc -c index.html
