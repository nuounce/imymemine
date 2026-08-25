#!/usr/bin/env bash
# 인게임용 만화 페이지 납품본 생성. **원본은 손대지 않는다.**
#
# comic+comment/ 의 페이지는 이미 960×600(캔버스와 동일)이라 크기는 줄이지 않는다.
# 문제는 용량이다 — 장당 800KB~1MB, 인게임에 쓰는 10장 합계 9MB 라 첫 진입이 느려진다.
# 흑백 만화라 유채색 픽셀이 거의 없으므로 8비트 그레이스케일로 다시 인코딩하면
# 화질 손실 없이 1/3 로 준다 (c-group 과 같은 방식).
#
# 재생성: bash scripts/derive-comic.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="seongwoo-todo/assets/generated/comic+comment"
OUT="$SRC/delivery"
mkdir -p "$OUT"

for n in INTRO-PAGE-1 INTRO-PAGE-2 INTRO-PAGE-3 M1-PAGE M2-PAGE M3-PAGE M4-PAGE END-1 END-2 END-3 CREDITS; do
  python3 scripts/to_gray.py "$SRC/$n.png" "$OUT/$n.png"
  echo "  $n.png → $(( $(wc -c < "$OUT/$n.png") / 1024 ))KB"
done
