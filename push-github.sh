#!/usr/bin/env bash
# Đẩy MuseRouter lên GitHub — tạo trước 1 repo trống tên "muserouter" tại https://github.com/new
set -e
cd "$(dirname "$0")"
read -rp "Nhập tên tài khoản GitHub của bạn: " GHUSER
REPO="${1:-muserouter}"
command -v git >/dev/null || { echo "[LỖI] Chưa cài Git."; exit 1; }
[ -d .git ] || git init -b main
git add -A
git diff --cached --quiet || git commit -m "MuseRouter"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${GHUSER}/${REPO}.git"
git push -u origin main
echo "=== XONG! https://github.com/${GHUSER}/${REPO} ==="
echo "Cài ở máy khác: npm install -g github:${GHUSER}/${REPO}  rồi chạy: muserouter"
