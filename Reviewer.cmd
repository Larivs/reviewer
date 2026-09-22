@echo off
chcp 65001 >nul
title Reviewer
cd /d "%~dp0"
call npm run serve
echo.
echo Le serveur est arrete.
pause
