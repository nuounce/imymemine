"""납품용 장면 이미지를 8비트 그레이스케일 PNG 로 다시 인코딩한다.

C그룹은 흑백 만화(잉크 + 하프톤)라 유채색 픽셀이 0.03% 뿐인데, 원본은 RGBA 로
저장돼 있어 채널 셋을 헛되이 싣고 있다. 그레이스케일로 바꾸면 화질 손실 없이
용량이 1/3 로 준다 (1041KB → 353KB 실측).

사용: python3 scripts/to_gray.py <입력.png> <출력.png>
"""
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _png import read_png  # noqa: E402


def write_gray(path, w, h, rows):
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # 필터 없음 — 하프톤은 예측 필터로 이득이 거의 없다
        raw.extend(rows[y])

    def chunk(tag, data):
        body = struct.pack('>I', len(data)) + tag + data
        return body + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    Path(path).write_bytes(out)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    w, h, px = read_png(src)
    rows = []
    for y in range(h):
        row = bytearray(w)
        for x in range(w):
            r, g, b, _ = px[y][x]
            row[x] = (r * 299 + g * 587 + b * 114) // 1000
        rows.append(row)
    write_gray(dst, w, h, rows)


if __name__ == '__main__':
    main()
