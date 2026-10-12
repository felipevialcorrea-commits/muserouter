@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Day MuseRouter len GitHub ===
echo Truoc do hay tao 1 repo TRONG ten "muserouter" tren https://github.com/new
echo (khong tich "Add a README file")
echo.
set /p GHUSER=Nhap ten tai khoan GitHub cua ban: 
set "REPO=muserouter"
if not "%~1"=="" set "REPO=%~1"

where git >nul 2>nul || (echo [LOI] Chua cai Git. Tai tai https://git-scm.com/download/win roi chay lai. & pause & exit /b 1)

if not exist ".git" git init -b main
git add -A
git diff --cached --quiet || git commit -m "MuseRouter"
git remote remove origin 2>nul
git remote add origin https://github.com/%GHUSER%/%REPO%.git
echo.
echo Dang push... Trinh duyet/cua so dang nhap GitHub co the bat len - dang nhap 1 lan la xong.
git push -u origin main
if %errorlevel% neq 0 (
  echo.
  echo [LOI] Push that bai. Kiem tra: repo "%REPO%" da tao chua, ten tai khoan dung chua, da dang nhap GitHub chua.
  pause & exit /b 1
)
echo.
echo === XONG! ===
echo Repo: https://github.com/%GHUSER%/%REPO%
echo Cai o may khac bang: npm install -g github:%GHUSER%/%REPO%
echo Sau do chay: muserouter setup  (lan dau)  va  muserouter
pause
