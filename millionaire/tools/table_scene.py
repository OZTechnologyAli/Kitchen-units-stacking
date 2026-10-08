"""8-bit, cel-shaded version of the dinner photo with the four people redrawn as pixel characters."""
import cv2, numpy as np, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from heads import render_people

def table_scene(photo):
    W, H, K = 320, 240, 32
    im = cv2.imread(photo)
    f = np.power(im.astype(np.float32) / 255, 0.8); im = (f * 255).astype(np.uint8)
    for _ in range(4): im = cv2.bilateralFilter(im, 15, 40, 15)
    sm = cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    # remove the table lamp: interpolate horizontally across it
    sx, sy = W / 2000, H / 1500
    x0, x1 = int(905 * sx) - 1, int(1025 * sx) + 1
    y0, y1 = int(440 * sy) - 1, int(875 * sy) + 1
    for y in range(y0, y1 + 1):
        Lc, Rc = sm[y, x0 - 1].copy(), sm[y, x1 + 1].copy()
        for x in range(x0, x1 + 1):
            t = (x - x0 + 1) / (x1 - x0 + 2); sm[y, x] = Lc * (1 - t) + Rc * t
    sm = sm.astype(np.uint8)
    hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.35, 0, 255)
    sm = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    Z = sm.reshape(-1, 3).astype(np.float32)
    _, lab, cen = cv2.kmeans(Z, K, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1), 4, cv2.KMEANS_PP_CENTERS)
    q = cen[lab.flatten()].reshape(sm.shape).astype(np.uint8)
    q = cv2.medianBlur(q, 3)
    big = cv2.resize(im, (W * 2, H * 2), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
    e = cv2.resize(cv2.Canny(g, 30, 80), (W, H), interpolation=cv2.INTER_AREA) > 40
    e[y0:y1 + 1, x0:x1 + 1] = False
    out = q.astype(np.float32); out[e] *= 0.35
    rgb = cv2.cvtColor(out.astype(np.uint8), cv2.COLOR_BGR2RGB)
    blinks = render_people(rgb)
    return rgb, blinks
