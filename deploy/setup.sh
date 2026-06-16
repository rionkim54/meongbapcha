#!/usr/bin/env bash
# 멍이밥차 - Oracle Cloud(Ubuntu) 자동 설치 스크립트
# 사용법: VM에 코드를 받은 뒤, 그 폴더 안에서  bash deploy/setup.sh  실행
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=3000
cd "$APP_DIR"
echo "▶ 앱 폴더: $APP_DIR"

# ---- 1. 로그인 비밀번호 입력 (기본 dog0616) ----
read -p "로그인 비밀번호를 정하세요 [dog0616]: " APP_PASSWORD
APP_PASSWORD=${APP_PASSWORD:-dog0616}

# ---- 2. 시스템 패키지: Node 22 + Perl + 빌드도구 ----
echo "▶ Node.js 22 / Perl 설치 중…"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs perl git iptables-persistent

# ---- 3. 메모리 적은 VM 대비 스왑 2GB (이미 있으면 건너뜀) ----
if [ ! -f /swapfile ]; then
  echo "▶ 스왑 2GB 생성 중…"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ---- 4. 의존성 설치 ----
echo "▶ npm 패키지 설치 중… (exiftool/heic 변환 포함, 몇 분 걸릴 수 있어요)"
npm install --omit=dev

# ---- 5. 데이터 폴더 + .env ----
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
APP_PASSWORD=$APP_PASSWORD
SESSION_SECRET=$(openssl rand -hex 24)
DATA_DIR=$APP_DIR/data
PORT=$PORT
EOF
  echo "▶ .env 생성 완료 (비밀번호: $APP_PASSWORD)"
else
  echo "▶ .env 가 이미 있어 그대로 둡니다."
fi

# ---- 6. OS 방화벽 열기 (Oracle Ubuntu 는 기본 차단) ----
echo "▶ 방화벽에서 $PORT 포트 여는 중…"
sudo iptables -I INPUT -p tcp --dport $PORT -j ACCEPT
sudo netfilter-persistent save

# ---- 7. systemd 서비스 등록 (자동 재시작 / 부팅 시 자동 실행) ----
echo "▶ 서비스 등록 중…"
sudo tee /etc/systemd/system/meongbapcha.service >/dev/null <<EOF
[Unit]
Description=Meongbapcha support app
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --experimental-sqlite --env-file-if-exists=$APP_DIR/.env $APP_DIR/server.js
Restart=always
RestartSec=3
User=$USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now meongbapcha
sleep 2
sudo systemctl --no-pager --full status meongbapcha | head -n 12 || true

IP=$(curl -s ifconfig.me || echo "<공인IP>")
echo ""
echo "✅ 설치 완료!  http://$IP:$PORT  로 접속하세요. (비밀번호: $APP_PASSWORD)"
echo "   * Oracle 콘솔의 보안목록(Security List)에서도 $PORT 포트를 꼭 열어야 합니다 (가이드 참고)."
