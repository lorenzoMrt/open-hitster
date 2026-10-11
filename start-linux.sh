#!/bin/sh
# Start Open Hitster on Linux (needed for Spotify).
cd "$(dirname "$0")"
( sleep 1 && xdg-open "http://127.0.0.1:8000/" ) &
python3 -m http.server 8000 --bind 127.0.0.1
