@echo off
title Esports Signage
color 0A

echo =================================================
echo        STARTING Esports Signage SERVER
echo =================================================
echo.
echo [1/2] Booting Server Brain...
start /min cmd /k "node server/server.js"

echo [2/2] Waiting for connection...
timeout /t 2 >nul

echo.
echo SYSTEM ONLINE.
echo Opening Admin Studio...
start http://localhost:3000/admin.html
echo http://localhost:3000/receirver.html
echo http://localhost:3000/dashboard.html

echo.
echo =================================================
echo    DO NOT CLOSE THIS OR OTHER COMMAND PROMPT
echo          WINDWOS WHILE SCREENS ARE ON
echo =================================================
pause