# Logic Mapper - Tauri + PyInstaller Windows Build Script
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1

param(
    [switch]$SkipBackend,
    [switch]$DevMode
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Write-Step($msg) {
    Write-Host "`n>> $msg" -ForegroundColor Cyan
}

function Assert-Command($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] '$cmd' not found. $hint" -ForegroundColor Red
        exit 1
    }
}

Write-Step "Checking prerequisites"
Assert-Command "cargo"  "Install Rust: https://rustup.rs"
Assert-Command "npm"    "Install Node.js: https://nodejs.org"
Assert-Command "python" "Install Python: https://python.org"

Write-Step "1/5 - npm install"
Set-Location "$Root\frontend"
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] npm install failed" -ForegroundColor Red; exit 1 }

if ($DevMode) {
    Write-Step "Starting dev mode (npm run tauri:dev)"
    npm run tauri:dev
    exit 0
}

if (-not $SkipBackend) {
    Write-Step "2/5 - Build FastAPI backend with PyInstaller"
    Set-Location "$Root\backend"
    python -m pip install pyinstaller --quiet
    python -m PyInstaller backend.spec --distpath "$Root\dist-backend" --workpath "$Root\build-backend" --noconfirm
    if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] PyInstaller failed" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "  (--SkipBackend flag set)" -ForegroundColor DarkGray
}

Write-Step "3/5 - Copy backend binary to src-tauri/binaries/"
$TargetTriple = "x86_64-pc-windows-msvc"
$BinDir = "$Root\frontend\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$SrcBin = "$Root\dist-backend\backend.exe"
$DstBin = "$BinDir\backend-$TargetTriple.exe"

if (-not (Test-Path $SrcBin)) {
    Write-Host "[ERROR] $SrcBin not found." -ForegroundColor Red
    exit 1
}

Copy-Item $SrcBin $DstBin -Force
Write-Host "  Copied: $DstBin" -ForegroundColor Green

Write-Step "4/5 - Check icons"
$IconDir = "$Root\frontend\src-tauri\icons"
if (-not (Test-Path "$IconDir\32x32.png")) {
    Write-Host "  icons/ folder is empty. Please add icon files manually." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $IconDir | Out-Null
}

Write-Step "5/5 - Build Tauri app (with sidecar)"
Set-Location "$Root\frontend"
npx tauri build --config src-tauri/tauri.build.conf.json
if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] Tauri build failed" -ForegroundColor Red; exit 1 }

Write-Host "`n============================================" -ForegroundColor Green
Write-Host " Build complete!" -ForegroundColor Green
Write-Host " Output:" -ForegroundColor Green
Write-Host "   MSI  : frontend\src-tauri\target\release\bundle\msi\" -ForegroundColor Green
Write-Host "   NSIS : frontend\src-tauri\target\release\bundle\nsis\" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
