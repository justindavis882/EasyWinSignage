@echo off
title Esports Signage
color 0A

echo =================================================
echo        STARTING EasyWin Signage SERVER
echo =================================================
echo.
echo [1/2] Booting Server Brain...
start /min cmd /k "node server/server.js"

echo [2/2] Waiting for connection...
timeout /t 2 >nul

echo.
echo SYSTEM ONLINE.
echo Opening Admin Studio...
start http://localhost:3000/index.html
echo http://localhost:3000/index.html
echo http://localhost:3000/admin.html
echo http://localhost:3000/receiver.html
echo http://localhost:3000/dashboard.html

echo.
echo =================================================
echo    DO NOT CLOSE THIS OR OTHER COMMAND PROMPT
echo          WINDOWS WHILE SCREENS ARE ON
echo =================================================
exit
