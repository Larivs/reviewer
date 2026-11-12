@echo off
rem ---------------------------------------------------------------------
rem  Reviewer : un double-clic pour installer, mettre a jour et lancer.
rem
rem  Sur une machine neuve il fait tout : il verifie Node, installe les
rem  dependances si elles manquent ou si le projet a ete mis a jour, puis
rem  demarre le serveur. Les fois suivantes, il demarre directement.
rem
rem  Pas d'accents dans ce fichier : cmd.exe les lit dans la page de code
rem  du systeme avant que "chcp" n'ait pris effet.
rem ---------------------------------------------------------------------
chcp 65001 >nul
title Reviewer
cd /d "%~dp0"

rem -- 1. Node est-il la, et assez recent ? ------------------------------
where node >nul 2>nul
if errorlevel 1 goto :pas_de_node

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 goto :node_trop_vieux

rem -- 2. Dependances : a installer la premiere fois, et apres une mise a
rem      jour. On compare le fichier de verrou a la copie gardee lors de
rem      la derniere installation reussie.
if not exist "node_modules\.reviewer-lock" goto :installer
fc /b "package-lock.json" "node_modules\.reviewer-lock" >nul 2>nul
if errorlevel 1 goto :installer
goto :lancer

:installer
echo.
echo   Installation des dependances, quelques minutes la premiere fois...
echo.
call npm ci
if errorlevel 1 goto :echec_installation
copy /y "package-lock.json" "node_modules\.reviewer-lock" >nul

:lancer
rem  "npm run serve" compile si le code a change, refuse de demarrer sans
rem  authentification, et affiche les adresses a donner aux autres.
call npm run serve
echo.
echo   Le serveur est arrete.
pause
exit /b 0

:pas_de_node
echo.
echo   Node.js n'est pas installe sur cette machine.
echo.
echo   Installe la version LTS depuis https://nodejs.org
echo   ou, dans un terminal :  winget install OpenJS.NodeJS.LTS
echo.
echo   Puis relance ce fichier.
echo.
pause
exit /b 1

:node_trop_vieux
echo.
echo   Node.js est trop ancien : il faut la version 22.18 ou plus.
for /f "delims=" %%v in ('node -v') do echo   Version installee : %%v
echo.
echo   Mets-le a jour depuis https://nodejs.org puis relance ce fichier.
echo.
pause
exit /b 1

:echec_installation
echo.
echo   L'installation des dependances a echoue, rien n'a ete demarre.
echo   Verifie la connexion a Internet, puis relance ce fichier.
echo.
pause
exit /b 1
