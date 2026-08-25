#!/usr/bin/env bash
# C그룹 장면 이미지 납품본 생성. **원본은 손대지 않는다.**
#
# 원본(c-group/*.png)은 1536×1024·1600×1000 이고 장당 1.6~2.7MB 라, 여섯 장을
# 그대로 실으면 첫 화면까지 14.5MB 를 받아야 한다. 캔버스는 960×600 고정이므로
# 그 이상의 해상도는 화면에 닿지도 않는다.
#
#   1) 납품 크기로 축소 — C1(3:2) → 960×640(960×600 을 cover 하는 최소 크기),
#      C2(16:10) → 960×600(캔버스와 비율이 같아 잘림이 없다)
#   2) 8비트 그레이스케일로 재인코딩 — 흑백 만화라 유채색 픽셀이 0.03% 뿐이다
#
# 결과: 14.5MB → 약 2MB. 재생성은 `bash scripts/derive-scenes.sh`.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="seongwoo-todo/assets/generated/c-group"
OUT="$SRC/delivery"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

derive() {  # $1=파일명  $2=너비  $3=높이
  sips --resampleHeightWidth "$3" "$2" "$SRC/$1" --out "$TMP/$1" >/dev/null
  python3 scripts/to_gray.py "$TMP/$1" "$OUT/$1"
  echo "  $1 → ${2}×${3} 그레이스케일 $(( $(wc -c < "$OUT/$1") / 1024 ))KB"
}

for f in "$SRC"/C1-*.png; do derive "$(basename "$f")" 960 640; done
derive C2-title-key-visual.png 960 600
