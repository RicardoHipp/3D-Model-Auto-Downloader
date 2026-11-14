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

"%SEVENZIP%" a -tzip extension.zip manifest.json LICENSE LIZENZEN-DRITTER.txt background.js content_isolated.js content_main.js content_dl_main.js content_dl_isolated.js progress_banner.js icon128.png icon_startup.png icons _locales jszip.min.js offscreen.html offscreen.js popup.html popup.js options.html options.js library.html library.js model.html model.js model_zip.js model_stl.js model_3mf.js model_view.js model_step_worker.js vendor welcome.html welcome.js target_dir.js explorer_link.js explorer_setup.js -xr!occt-import-js-quelle

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
