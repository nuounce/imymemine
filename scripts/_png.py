"""표준 라이브러리만 쓰는 최소 PNG 리더 (8bit RGBA/RGB/팔레트)."""
import struct, zlib

def read_png(path):
    data = open(path,'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8; idat = b''; plte = None; trns = None
    w=h=bd=ct=0
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w,h,bd,ct = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'PLTE': plte = chunk
        elif typ == b'tRNS': trns = chunk
        elif typ == b'IDAT': idat += chunk
        elif typ == b'IEND': break
        pos += 12+ln
    raw = zlib.decompress(idat)
    ch = {0:1, 2:3, 3:1, 4:2, 6:4}[ct]
    assert bd == 8, f"bitdepth {bd} 미지원"
    stride = w*ch
    out = bytearray(h*stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for i in range(ch, stride): line[i] = (line[i] + line[i-ch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]; c = prev[i-ch] if i >= ch else 0
                pp = a+b-c; pa=abs(pp-a); pb=abs(pp-b); pc=abs(pp-c)
                pr = a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    # RGBA 로 통일
    px = [[(0,0,0,0)]*w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            i = y*stride + x*ch
            if ct == 6: px[y][x] = tuple(out[i:i+4])
            elif ct == 2: px[y][x] = (out[i],out[i+1],out[i+2],255)
            elif ct == 3:
                idx = out[i]; r,g,b = plte[idx*3:idx*3+3]
                a = trns[idx] if trns and idx < len(trns) else 255
                px[y][x] = (r,g,b,a)
            elif ct == 4: px[y][x] = (out[i],out[i],out[i],out[i+1])
            else: px[y][x] = (out[i],out[i],out[i],255)
    return w,h,px
