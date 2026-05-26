@echo off
chcp 65001 > nul
echo Verpacke Erweiterung mit 7-Zip...

set "SEVENZIP=C:\Program Files\7-Zip\7z.exe"

if not exist "%SEVENZIP%" (
    echo 7-Zip wurde unter "%SEVENZIP%" nicht gefunden.
    echo Versuche '7z' aus dem System-PATH...
    set "SEVENZIP=7z"
)

if exist extension.zip del extension.zip

"%SEVENZIP%" a -tzip extension.zip manifest.json background.js content_isolated.js content_main.js icon128.png jszip.min.js offscreen.html offscreen.js popup.html popup.js

if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo ERFOLG: "extension.zip" wurde erfolgreich erstellt!
    echo ===================================================
) else (
    echo.
    echo FEHLER: Die ZIP-Datei konnte nicht erstellt werden.
)
pause
