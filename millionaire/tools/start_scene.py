"""Pixel-art start screen: two kids building a toy house with a remote-control crane."""
import numpy as np, json, base64, io, sys
sys.path.insert(0, '.')
from PIL import Image
from heads import build, BASEPAL, C

W, H = 256, 160

class Layer:
    def __init__(s, w=W, h=H):
        s.a = np.zeros((h, w, 4), np.uint8)
        s.Y, s.X = np.mgrid[0:h, 0:w]
    def ell(s, cx, cy, rx, ry): return ((s.X - cx) / rx) ** 2 + ((s.Y - cy) / ry) ** 2 <= 1
    def rect(s, x0, y0, x1, y1): return (s.X >= x0) & (s.X <= x1) & (s.Y >= y0) & (s.Y <= y1)
    def put(s, m, c): s.a[m] = c
    def px(s, x, y, c, w=1, h=1): s.a[y:y + h, x:x + w] = c
    def line(s, x0, y0, x1, y1, c):
        n = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(n + 1):
            t = i / max(n, 1)
            s.a[round(y0 + (y1 - y0) * t), round(x0 + (x1 - x0) * t)] = c
    def outline(s, c):
        a = s.a[..., 3] > 0
        o = np.zeros_like(a)
        o[1:] |= a[:-1]; o[:-1] |= a[1:]; o[:, 1:] |= a[:, :-1]; o[:, :-1] |= a[:, 1:]
        s.a[o & ~a] = c
    def over(s, other):
        m = other.a[..., 3] > 0
        s.a[m] = other.a[m]

OUT = C(36, 22, 24)

def head_onto(L, p, cx, cy, closed=False):
    a = build(p, closed).a
    h, w = a.shape[:2]
    x0, y0 = cx - w // 2, cy - h // 2
    m = a[..., 3] > 0
    for y, x in np.argwhere(m):
        L.a[y0 + y, x0 + x] = a[y, x]
    return a, x0, y0

KID = dict(white=C(250, 248, 240), iris=C(80, 50, 30), pupil=C(20, 12, 10), line=C(40, 22, 18),
           mouth=C(120, 40, 40), teeth=C(250, 248, 240), tongue=C(220, 100, 100), lip=C(150, 60, 50),
           blush=C(250, 150, 140), out=OUT,
           skin=C(246, 200, 166), skin2=C(214, 158, 128), skin_hi=C(255, 222, 196))
BOY_A = dict(rx=12, ry=13, lit=1, canvas=60, look=1,
             pal={**KID, 'hair': C(52, 36, 30), 'hair2': C(34, 24, 20), 'hair_hi': C(96, 70, 56), 'brow': C(40, 26, 20)},
             front=[dict(e=(0, -3, 13, 12), ymax=-6, curve=3), dict(e=(-12, -3, 2, 4), ymax=-1), dict(e=(12, -3, 2, 4), ymax=-1)],
             eyes='open', eye_x=5, eye_y=1, brow_gap=5, brow_w=6, brow_th=2, brow_arch=1,
             nose_y=5, mouth='smile', mouth_w=6, mouth_y=9, blush=True, ear_y=1)
BOY_B = dict(rx=11, ry=13, lit=-1, canvas=60, look=-1,
             pal={**KID, 'hair': C(66, 42, 30), 'hair2': C(44, 28, 20), 'hair_hi': C(120, 84, 58), 'brow': C(50, 32, 24)},
             front=[dict(e=(0, -5, 13, 12), ymax=-5, curve=4), dict(e=(-4, -7, 9, 6), ymax=-1, curve=-2),
                    dict(e=(9, -5, 5, 8), ymax=1), dict(e=(-10, -4, 4, 7), ymax=2), dict(e=(2, -13, 9, 4))],
             eyes='open', eye_x=5, eye_y=1, brow_gap=4, brow_w=5, brow_th=1,
             nose_y=5, mouth='smile', mouth_w=6, mouth_y=9, blush=True, ear_y=1)

def scene():
    L = Layer()
    # wall + wallpaper
    L.put(L.rect(0, 0, W, 104), C(232, 210, 168))
    L.put(L.rect(0, 0, W, 104) & (L.X % 8 == 0), C(220, 194, 150))
    L.put(L.rect(0, 0, W, 104) & (L.X % 8 == 4) & (L.Y % 6 == 0), C(244, 226, 190))
    # windows with sky
    for x0 in (14, 196):
        L.put(L.rect(x0 - 3, 15, x0 + 47, 65), C(250, 246, 236))
        L.put(L.rect(x0, 18, x0 + 44, 62), C(120, 190, 240))
        L.put(L.rect(x0, 46, x0 + 44, 62), C(150, 205, 245))
        L.put(L.rect(x0 + 21, 18, x0 + 23, 62) | L.rect(x0, 39, x0 + 44, 41), C(250, 246, 236))
        L.put(L.rect(x0 - 5, 64, x0 + 49, 67), C(210, 186, 150))   # sill
        L.put(L.rect(x0 - 5, 64, x0 + 49, 64), C(250, 240, 220))
    # skirting + wooden floor
    L.put(L.rect(0, 100, W, 105), C(250, 244, 230))
    L.put(L.rect(0, 105, W, 106), C(200, 180, 150))
    L.put(L.rect(0, 107, W, H), C(176, 118, 66))
    for y in range(107, H, 6):
        L.put(L.rect(0, y, W, y) , C(142, 92, 50))
        off = (y * 7) % 40
        for x in range(off, W, 40):
            L.put(L.rect(x, y, x, y + 5), C(142, 92, 50))
    L.put(L.rect(0, 107, W, H) & ((L.X + L.Y * 3) % 23 == 0), C(196, 140, 84))
    # rug
    rug = L.ell(128, 140, 112, 18)
    L.put(rug, C(170, 58, 58))
    L.put(L.ell(128, 140, 106, 15), C(240, 196, 84))
    L.put(L.ell(128, 140, 102, 13), C(60, 96, 170))
    L.put(L.ell(128, 140, 102, 13) & ((L.X + (L.Y % 4) * 2) % 8 == 0) & (L.Y % 4 == 0), C(84, 124, 196))
    # scattered toy blocks on the rug
    for (x, y, c) in [(26, 146, C(230, 70, 60)), (100, 150, C(70, 170, 90)), (90, 144, C(240, 200, 60)), (232, 152, C(70, 130, 220))]:
        L.put(L.rect(x, y, x + 6, y + 4), c)
        L.put(L.rect(x, y, x + 6, y), C(255, 255, 255))
        L.put(L.rect(x, y + 4, x + 6, y + 4), C(0, 0, 0))
    # hard hat on the floor
    hat = Layer(); hat.put(hat.ell(110, 141, 7, 6) & (hat.Y <= 141), C(250, 200, 30))
    hat.put(hat.rect(101, 141, 119, 142), C(250, 200, 30)); hat.put(hat.rect(108, 135, 111, 140), C(255, 230, 120))
    hat.outline(OUT); L.over(hat)
    return L

def crane():
    L = Layer()
    Y1, Y2 = C(248, 196, 40), C(206, 148, 20)
    # tracks
    L.put(L.rect(208, 134, 250, 143), C(60, 60, 66))
    for x in range(212, 250, 7): L.put(L.ell(x, 138, 2.5, 2.5), C(130, 130, 140))
    # body + cab
    L.put(L.rect(210, 116, 248, 133), Y1)
    L.put(L.rect(210, 128, 248, 133), Y2)
    L.put(L.rect(234, 106, 247, 127), Y1)
    L.put(L.rect(237, 109, 245, 117), C(160, 220, 250))
    L.put(L.rect(237, 109, 238, 110), C(255, 255, 255))
    L.put(L.rect(213, 120, 230, 124), C(40, 40, 40))  # stripe
    L.put(L.rect(213, 120, 230, 124) & ((L.X + L.Y) % 4 < 2), Y1)
    # mast (lattice)
    L.put(L.rect(222, 72, 229, 115), Y1)
    L.put(L.rect(224, 72, 227, 115) & ~(((L.Y - L.X) % 6 == 0) | ((L.Y + L.X) % 6 == 0)), (0, 0, 0, 0))
    L.put(L.rect(224, 72, 227, 115) & (((L.Y - L.X) % 6 == 0) | ((L.Y + L.X) % 6 == 0)), Y2)
    # jib + counter-jib
    L.put(L.rect(116, 72, 254, 76), Y1)
    L.put(L.rect(118, 73, 252, 75) & ~(((L.Y - L.X) % 4 == 0) | ((L.Y + L.X) % 4 == 0)), (0, 0, 0, 0))
    L.put(L.rect(118, 73, 252, 75) & (((L.Y - L.X) % 4 == 0) | ((L.Y + L.X) % 4 == 0)), Y2)
    L.put(L.rect(242, 77, 254, 86), C(120, 120, 130))     # counterweight
    L.put(L.rect(242, 77, 254, 78), C(160, 160, 170))
    # apex + ties
    L.put(L.rect(224, 62, 227, 71), Y1)
    L.line(225, 62, 120, 72, C(60, 50, 40))
    L.line(226, 62, 252, 72, C(60, 50, 40))
    L.outline(OUT)
    return L

def house():
    L = Layer()
    cols = [C(230, 70, 60), C(70, 130, 220), C(240, 200, 60), C(70, 170, 90)]
    x0, y_bot, bw, bh = 116, 140, 8, 6
    for r in range(3):
        y = y_bot - (r + 1) * bh
        off = 0 if r % 2 == 0 else -4
        for i in range(7):
            x = x0 + off + i * bw
            xa, xb = max(x, x0), min(x + bw - 1, x0 + 47)
            if xa > xb: continue
            if 136 <= xa <= 144 and r < 2:  # doorway
                continue
            c = cols[(i + r * 2) % 4]
            L.put(L.rect(xa, y, xb, y + bh - 1), c)
            L.put(L.rect(xa, y, xb, y), tuple(min(255, v + 50) for v in c[:3]) + (255,))
            L.put(L.rect(xa, y + bh - 1, xb, y + bh - 1), tuple(int(v * 0.65) for v in c[:3]) + (255,))
            L.put(L.rect(xb, y, xb, y + bh - 1), tuple(int(v * 0.65) for v in c[:3]) + (255,))
    # door
    L.put(L.rect(136, 128, 144, 139), C(110, 70, 40)); L.px(142, 133, C(250, 210, 80))
    # window block
    L.put(L.rect(121, 124, 126, 127), C(170, 225, 250))
    L.outline(OUT)
    return L

def roof():
    L = Layer(60, 24)
    for y in range(20):
        hw = int(y * 1.45) + 1
        L.put(L.rect(29 - hw, y + 2, 29 + hw, y + 2), C(214, 60, 50))
    tri = L.a[..., 3] > 0
    L.put(tri & (L.Y % 4 == 1), C(170, 40, 36))
    L.put(tri & (L.Y % 4 == 3) & (L.X % 6 == (L.Y // 4) % 2 * 3), C(170, 40, 36))
    L.put(tri & (L.Y >= 20), C(150, 34, 30))
    L.put(L.rect(27, 0, 31, 2), C(150, 150, 160))  # lifting eye
    L.outline(OUT)
    return L

def kid_a():
    cx, gy = 62, 146
    L = Layer()
    # crossed legs, jeans
    L.put(L.ell(cx, gy - 6, 19, 7), C(60, 84, 140))
    L.put(L.ell(cx - 12, gy - 7, 8, 5) | L.ell(cx + 12, gy - 7, 8, 5), C(72, 100, 160))
    L.put(L.ell(cx - 20, gy - 4, 4, 3) | L.ell(cx + 20, gy - 4, 4, 3), C(236, 236, 240))
    L.put(L.rect(cx - 24, gy - 2, cx - 16, gy - 1) | L.rect(cx + 16, gy - 2, cx + 24, gy - 1), C(200, 60, 60))
    # torso: grey plaid jacket over navy shirt
    torso = L.rect(cx - 11, gy - 30, cx + 11, gy - 8) & ~(L.rect(cx - 11, gy - 30, cx - 10, gy - 29) | L.rect(cx + 10, gy - 30, cx + 11, gy - 29))
    L.put(torso, C(138, 140, 150))
    L.put(torso & ((L.X - cx) % 4 == 0), C(96, 98, 110))
    L.put(torso & ((L.Y - gy) % 4 == 0), C(96, 98, 110))
    L.put(torso & ((L.X - cx) % 4 == 2) & ((L.Y - gy) % 4 == 2), C(176, 120, 110))
    L.put(L.rect(cx - 3, gy - 30, cx + 3, gy - 21) & (abs(L.X - cx) <= (L.Y - (gy - 31)) * 0.6), C(40, 52, 96))
    L.put(L.rect(cx, gy - 29, cx, gy - 9), C(70, 72, 84))  # zip
    # arms reaching to the remote
    sleeve = L.ell(cx - 12, gy - 20, 4, 9) | L.ell(cx + 12, gy - 20, 4, 9) | L.ell(cx - 7, gy - 14, 6, 3) | L.ell(cx + 7, gy - 14, 6, 3)
    L.put(sleeve, C(150, 152, 162))
    L.put(sleeve & ((L.X - cx) % 4 == 0), C(108, 110, 122))
    L.put(L.ell(cx - 5, gy - 15, 2.5, 2.5) | L.ell(cx + 5, gy - 15, 2.5, 2.5), KID['skin'])
    # remote control
    L.put(L.rect(cx - 6, gy - 20, cx + 6, gy - 13), C(50, 54, 64))
    L.put(L.rect(cx - 6, gy - 20, cx + 6, gy - 20), C(90, 96, 110))
    L.px(cx - 3, gy - 18, C(230, 60, 60)); L.px(cx - 1, gy - 18, C(240, 200, 60))
    L.put(L.ell(cx + 3, gy - 17, 1.5, 1.5), C(150, 150, 160))
    L.line(cx + 5, gy - 21, cx + 7, gy - 30, C(40, 40, 44))
    # re-draw hands over the remote edges
    L.put(L.ell(cx - 6, gy - 15, 2, 2) | L.ell(cx + 6, gy - 15, 2, 2), KID['skin'])
    L.outline(OUT)
    return L, (cx + 7, gy - 31), (cx, gy - 42)

def kid_b():
    cx, gy = 190, 146
    L = Layer()
    L.put(L.ell(cx, gy - 6, 18, 7), C(84, 76, 70))
    L.put(L.ell(cx - 12, gy - 7, 8, 5) | L.ell(cx + 12, gy - 7, 8, 5), C(100, 90, 82))
    L.put(L.ell(cx - 19, gy - 3, 4, 3) | L.ell(cx + 19, gy - 3, 4, 3), C(90, 56, 36))
    # dark pinstripe jacket, brown cardigan with buttons
    torso = L.rect(cx - 11, gy - 30, cx + 11, gy - 8) & ~(L.rect(cx - 11, gy - 30, cx - 10, gy - 29) | L.rect(cx + 10, gy - 30, cx + 11, gy - 29))
    L.put(torso, C(44, 46, 60))
    L.put(torso & ((L.X - cx) % 3 == 0), C(76, 80, 98))
    L.put(L.rect(cx - 4, gy - 30, cx + 4, gy - 8), C(110, 72, 48))
    L.put(L.rect(cx - 4, gy - 30, cx + 4, gy - 8) & ((L.X - cx) % 2 == 0) & (L.Y % 2 == 0), C(92, 60, 40))
    for y in (gy - 25, gy - 19, gy - 13): L.px(cx, y, C(220, 200, 160))
    L.put(L.rect(cx - 2, gy - 30, cx + 2, gy - 28), C(60, 40, 30))
    # right arm resting on knee, holding a spare block
    L.put(L.ell(cx + 12, gy - 20, 4, 9) | L.ell(cx + 13, gy - 12, 3, 4), C(52, 54, 70))
    L.put(L.ell(cx + 14, gy - 9, 2.5, 2.5), KID['skin'])
    L.put(L.rect(cx + 15, gy - 12, cx + 20, gy - 8), C(70, 170, 90))
    L.put(L.rect(cx + 15, gy - 12, cx + 20, gy - 12), C(140, 220, 150))
    L.outline(OUT)
    return L, (cx, gy - 42)

def hammer_arm(frame):
    cx, gy = 190, 146
    L = Layer()
    sleeve = C(52, 54, 70)
    L.put(L.ell(cx - 12, gy - 24, 4, 5), sleeve)
    if frame == 0:   # raised
        L.put(L.ell(cx - 17, gy - 24, 6, 3), sleeve)
        L.put(L.ell(cx - 22, gy - 25, 2.5, 2.5), KID['skin'])
        L.put(L.rect(cx - 23, gy - 35, cx - 22, gy - 25), C(150, 100, 60))
        L.put(L.rect(cx - 27, gy - 38, cx - 18, gy - 35), C(150, 155, 170))
        L.put(L.rect(cx - 27, gy - 38, cx - 18, gy - 38), C(200, 205, 220))
    else:            # striking the wall
        L.put(L.ell(cx - 17, gy - 21, 6, 3), sleeve)
        L.put(L.ell(cx - 22, gy - 20, 2.5, 2.5), KID['skin'])
        L.put(L.rect(cx - 31, gy - 21, cx - 22, gy - 20), C(150, 100, 60))
        L.put(L.rect(cx - 35, gy - 25, cx - 32, gy - 16), C(150, 155, 170))
        L.put(L.rect(cx - 35, gy - 25, cx - 35, gy - 16), C(200, 205, 220))
    L.outline(OUT)
    return L

def to_uri(a):
    b = io.BytesIO(); Image.fromarray(a, 'RGBA').save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

def crop(L):
    ys, xs = np.nonzero(L.a[..., 3])
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    return dict(src=to_uri(L.a[y0:y1 + 1, x0:x1 + 1]), x=int(x0), y=int(y0))

def blink_pixels(p, cx, cy):
    o = build(p).a; c = build(p, True).a
    h, w = o.shape[:2]
    pix = []
    for y, x in np.argwhere(np.any(o != c, axis=2)):
        if c[y, x, 3]: pix.append((int(cx - w // 2 + x), int(cy - h // 2 + y), '#%02x%02x%02x' % tuple(c[y, x, :3])))
    return pix

def main():
    bg = scene()
    bg.over(crane())
    bg.over(house())
    a, led, headA = kid_a()
    bg.over(a)
    b, headB = kid_b()
    bg.over(b)
    head_onto(bg, BOY_A, *headA)
    head_onto(bg, BOY_B, *headB)
    rgb = bg.a.copy(); rgb[..., 3] = 255
    data = dict(
        bg=to_uri(rgb), w=W, h=H,
        roof=crop(roof()), arm=[crop(hammer_arm(0)), crop(hammer_arm(1))],
        led=led, jibY=76, trolleyX=140, wallTop=122,
        blinks=[blink_pixels(BOY_A, *headA), blink_pixels(BOY_B, *headB)],
    )
    return data

