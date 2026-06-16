#!/usr/bin/env bash
# 코드 업데이트 후 다시 적용 (GitHub에 새 코드를 올린 뒤 VM에서 실행)
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
echo "▶ 최신 코드 받는 중…"
git pull
echo "▶ 패키지 갱신 중…"
npm install --omit=dev
echo "▶ 서비스 재시작…"
sudo systemctl restart meongbapcha
sudo systemctl --no-pager status meongbapcha | head -n 8
echo "✅ 업데이트 완료"
