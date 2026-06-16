# Render(또는 모든 Docker 호스트)용 이미지
FROM node:22-bookworm-slim

# 사진 EXIF 분석(exiftool-vendored)에 필요한 Perl 설치
RUN apt-get update \
  && apt-get install -y --no-install-recommends perl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 먼저 설치 (캐시 활용)
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
