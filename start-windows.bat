@echo off
rem Double-click to start Open Hitster on Windows (needed for Spotify). Requires Python: https://www.python.org/downloads/
cd /d "%~dp0"
start "" "http://127.0.0.1:8000/"
echo Open Hitster is running at http://127.0.0.1:8000/  (close this window to stop)
py -m http.server 8000 --bind 127.0.0.1 || python -m http.server 8000 --bind 127.0.0.1
pause
