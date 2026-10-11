#!/bin/bash
# Double-click to start Open Hitster on a Mac (needed for Spotify).
cd "$(dirname "$0")"
( sleep 1 && open "http://127.0.0.1:8000/" ) &
echo "Open Hitster is running at http://127.0.0.1:8000/  (close this window to stop)"
python3 -m http.server 8000 --bind 127.0.0.1
