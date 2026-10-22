@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto directory_error

title Aurora - Local Test Server
where node.exe >nul 2>&1
if errorlevel 1 goto node_error
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_error
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto node_error

if not exist "package.json" goto package_error
if not exist "package-lock.json" goto package_error
if not exist "public\index.html" goto package_error
if not exist "scripts\serve.mjs" goto package_error
if not exist "server\app.mjs" goto package_error
node -e "process.exit(JSON.parse(require('fs').readFileSync('package.json','utf8')).name === 'aurora-runtime' ? 0 : 1)"
if errorlevel 1 goto package_error

call npm.cmd ls --omit=dev --depth=0 >nul 2>&1
if not errorlevel 1 goto start_server
echo Installing locked runtime dependencies. Please wait...
call npm.cmd ci --omit=dev
if errorlevel 1 goto install_error

:start_server
echo Starting the local TEST server. Keep this window open.
echo Use the browser address printed below. Press Ctrl+C to stop.
call npm.cmd start
if errorlevel 1 goto start_error
echo Server stopped.
pause
exit /b 0

:directory_error
echo ERROR: Cannot open the extracted application directory.
goto failure
:node_error
echo ERROR: Install Node.js 24 or newer with npm, then reopen this file.
goto failure
:package_error
echo ERROR: This launcher requires the complete prebuilt SERVER zip.
echo Extract all files first. Do not run it inside a zip or source archive.
echo Required: package.json, package-lock.json, public, scripts and server.
goto failure
:install_error
echo ERROR: Dependency installation failed. The server was not started.
echo Keep the error above. Check your network and try this launcher again.
goto failure
:start_error
echo ERROR: Server startup failed. Read the error above.
echo If the port is occupied, check whether this application is already running.
:failure
echo Do not delete package-lock.json, .env or .data to resolve this error.
pause
exit /b 1
