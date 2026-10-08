import numpy as np
from PIL import Image

T = (0, 0, 0, 0)
def C(*c): return tuple(c) + ((255,) if len(c) == 3 else ())

class Head:
    """Draws a pixel-art head in an upright local frame, then rotates it."""
    def __init__(s, size=120):
        s.n = size
        s.a = np.zeros((size, size, 4), np.uint8)
        s.c = size // 2
        yy, xx = np.mgrid[0:size, 0:size]
        s.X = xx - s.c; s.Y = yy - s.c
    def ell(s, cx, cy, rx, ry):
        return ((s.X - cx) / rx) ** 2 + ((s.Y - cy) / ry) ** 2 <= 1
    def put(s, mask, col):
        s.a[mask] = col
    def px(s, x, y, col, w=1, h=1):
        x += s.c; y += s.c
        s.a[y:y + h, x:x + w] = col
    def outline(s, col):
        a = s.a[..., 3] > 0
        o = np.zeros_like(a)
        o[1:] |= a[:-1]; o[:-1] |= a[1:]; o[:, 1:] |= a[:, :-1]; o[:, :-1] |= a[:, 1:]
        s.a[o & ~a] = col
    def rotated(s, deg):
        im = Image.fromarray(s.a, 'RGBA')
        k = 8
        big = im.resize((s.n * k, s.n * k), Image.NEAREST).rotate(-deg, Image.NEAREST)
        arr = np.asarray(big)[k // 2::k, k // 2::k]
        return arr

def paste(scene, arr, cx, cy):
    h, w = arr.shape[:2]
    x0, y0 = cx - w // 2, cy - h // 2
    H, W = scene.shape[:2]
    for y in range(h):
        sy = y0 + y
        if not 0 <= sy < H: continue
        for x in range(w):
            sx = x0 + x
            if 0 <= sx < W and arr[y, x, 3] > 0:
                scene[sy, sx, :3] = arr[y, x, :3]

def eyes(h, ex, ey, kind, P, closed=False, dx=0):
    """kind: open | squint | soft"""
    for side in (-1, 1):
        x = side * ex
        if closed:
            h.px(x - 2, ey, P['line'], 5, 1)
            h.px(x - 2 if side < 0 else x + 2, ey - 1, P['line'], 1, 1)
            continue
        if kind == 'open':
            h.px(x - 2, ey - 2, P['line'], 5, 1)       # upper lid
            h.px(x - 2, ey - 1, P['white'], 5, 2)
            h.px(x - 1 + dx, ey - 1, P['iris'], 3, 2)
            h.px(x + dx, ey - 1, P['pupil'], 1, 2)
            h.px(x - 1 + dx, ey - 1, P['white'], 1, 1)      # catch-light
            h.px(x - 3 if side < 0 else x + 3, ey - 2, P['line'], 1, 1)
        elif kind == 'squint':   # laughing, eyes creased
            h.px(x - 3, ey - 1, P['line'], 7, 1)
            h.px(x - 2, ey, P['white'], 5, 1)
            h.px(x - 1, ey, P['pupil'], 2, 1)
            h.px(x - 3, ey + 1, P['skin2'], 2, 1)
            h.px(x + 2, ey + 1, P['skin2'], 2, 1)
        elif kind == 'soft':
            h.px(x - 2, ey - 1, P['line'], 5, 1)
            h.px(x - 2, ey, P['white'], 5, 1)
            h.px(x - 1, ey, P['pupil'], 3, 1)
            h.px(x - 1, ey, P['iris'], 1, 1)
            h.px(x - 3 if side < 0 else x + 3, ey - 1, P['line'], 1, 1)

def brows(h, ex, by, P, w=6, th=2, arch=1):
    for side in (-1, 1):
        x0 = side * ex - w // 2
        for i in range(w):
            lift = arch if 1 <= i <= w - 2 else 0
            t = th if (i < w - 1 if side < 0 else i > 0) else 1
            h.px(x0 + i, by - lift, P['brow'], 1, t)

def shift(m, dy, dx):
    o = np.zeros_like(m)
    H, W = m.shape
    o[max(dy, 0):H + min(dy, 0), max(dx, 0):W + min(dx, 0)] = m[max(-dy, 0):H + min(-dy, 0), max(-dx, 0):W + min(-dx, 0)]
    return o

def hair_layer(h, shapes, P, lit, strands=False):
    m = np.zeros((h.n, h.n), bool)
    for sh in shapes:
        cx, cy, rx, ry = sh['e']
        e = h.ell(cx, cy, rx, ry)
        if 'ymax' in sh: e &= h.Y < sh['ymax'] + (h.X / max(rx, 1)) ** 2 * sh.get('curve', 0)
        if 'ymin' in sh: e &= h.Y >= sh['ymin']
        m |= e
    if not m.any(): return
    h.put(m, P['hair'])
    h.put(m & (h.X * lit < -6), P['hair2'])
    # sheen band just inside the top edge, on the lit side
    # short sheen strokes just inside the top edge, on the lit side
    sheen = m & shift(m, 2, 0) & ~shift(m, 4, 0) & (h.X * lit > -2) & ((h.X + 40) % 5 < 3)
    h.put(sheen, P['hair_hi'])
    if strands:
        for i in range(-40, 41, 4):
            h.put(m & (h.X == i) & (h.Y > 2) & ((h.Y + i) % 7 < 4), P['hair2'])
        h.put(m & (h.X * lit < -6) & (h.X % 4 == 2) & (h.Y > 6) & (h.Y % 6 < 3), P['hair_hi'])

def build(p, closed=False):
    h = Head(p.get('canvas', 120))
    P = p['pal']; rx, ry = p['rx'], p['ry']
    lit = p['lit']  # +1 light from the right, -1 from the left
    hair_layer(h, p.get('back', []), P, lit, strands=p.get('strands', False))
    # ears
    for side in (-1, 1):
        h.put(h.ell(side * rx, p.get('ear_y', 0), 3, 5), P['skin2'] if side != lit else P['skin'])
        h.px(side * rx, p.get('ear_y', 0) - 1, P['skin2'], 1, 3)
    # face
    face = h.ell(0, 0, rx, ry)
    h.put(face, P['skin'])
    h.put(face & (h.X * lit < -rx * 0.5), P['skin2'])
    h.put(face & (h.X * lit > rx * 0.15) & (h.X * lit < rx * 0.5) & (h.Y < 2) & (h.Y > -ry * 0.55), P['skin_hi'])
    # beard
    if p.get('beard'):
        B = p['beard']
        line = B['top'] + (h.X / rx) ** 2 * B['curve']
        jag = ((h.X % 3) == 0).astype(int)
        region = (h.ell(0, B['cy'], rx + B.get('wx', 0), B['ry']) & (h.Y > line - 6) & (h.Y > line + jag)) | (face & (h.Y > line + jag))
        # sideburns up to the hair
        for side in (-1, 1):
            region |= face & (h.X * side > rx - B.get('burn', 3)) & (h.Y > -ry * 0.45)
        h.put(region, P['beard'])
        h.put(region & (h.X * lit < -rx * 0.35), P['beard2'])
        h.put(region & (h.X * lit > 0) & (h.X * lit < rx * 0.5) & (h.Y > line + 3) & ((h.X * 2 + h.Y) % 5 == 0), P['beard_hi'])
        my = p['mouth_y'] - 3
        h.put(h.ell(0, my, p['mouth_w'] * 0.62, 2.0), P['beard'])
        h.put(h.ell(0, my, p['mouth_w'] * 0.62, 2.0) & (h.Y > my), P['beard2'])
    # nose
    nx = p.get('nose_x', 0)
    h.px(nx - lit, p['nose_y'] - 4, P['skin2'], 1, 4)
    h.px(nx - 2, p['nose_y'], P['skin2'], 5, 1)
    h.px(nx + 2 * lit, p['nose_y'] - 1, P['skin_hi'], 1, 1)
    # mouth
    mw, my = p['mouth_w'], p['mouth_y']
    if p['mouth'] == 'grin':
        mh = p.get('mouth_h', 3)
        m = h.ell(0, my, mw / 2, mh) & (h.Y >= my - 1)
        h.put(m, P['mouth'])
        h.put(m & (h.Y <= my + (1 if mh >= 4 else 0)), P['teeth'])
        h.put(m & (h.Y >= my + mh - 2) & (abs(h.X) < mw / 4), P['tongue'])
        h.put(h.ell(0, my, mw / 2 + 1, mh + 1) & ~m & (h.Y >= my - 1) & (h.Y < my + mh + 1), P['lip'])
    else:  # closed smile
        for i in range(-mw // 2, mw // 2 + 1):
            yy = my + (1 if abs(i) < mw / 3 else 0)
            h.px(i, yy, P['lip'], 1, 1)
        h.px(-mw // 2 - 1, my - 1, P['lip'], 1, 1)
        h.px(mw // 2 + 1, my - 1, P['lip'], 1, 1)
    if p.get('blush'):
        for side in (-1, 1):
            h.px(side * p['eye_x'] - 1, p['eye_y'] + 5, P['blush'], 3, 1)
    eyes(h, p['eye_x'], p['eye_y'], p['eyes'], P, closed, p.get('look', 0))
    brows(h, p['eye_x'], p['eye_y'] - p.get('brow_gap', 4), P, p.get('brow_w', 6), p.get('brow_th', 2), p.get('brow_arch', 1))
    hair_layer(h, p.get('front', []), P, lit)
    hair_layer(h, p.get('locks', []), P, lit, strands=True)
    h.outline(P['out'])
    return h

BASEPAL = dict(white=C(240, 236, 224), iris=C(70, 45, 30), pupil=C(20, 12, 10), line=C(40, 22, 18),
               mouth=C(90, 25, 30), teeth=C(245, 240, 225), tongue=C(200, 80, 80), lip=C(120, 45, 40),
               blush=C(232, 140, 120), out=C(28, 16, 18))
