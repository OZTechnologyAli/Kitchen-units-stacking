"""Table scene for the question screens: the 8-bit dinner image with its table lamp painted out
(a flickering pixel candle is drawn in its place at runtime)."""
import numpy as np
from PIL import Image

def table_scene(path):
    im = Image.open(path).convert('RGB')
    W, H = 241, 181
    a = np.asarray(im.resize((W, H), Image.BOX)).copy()

    def patch(x0, x1, y0, y1, dx):
        """Cover a box with the background copied from dx pixels to the side."""
        a[y0:y1 + 1, x0:x1 + 1] = a[y0:y1 + 1, x0 + dx:x1 + 1 + dx]

    patch(101, 131, 62, 80, 30)   # lamp shade and its glow
    patch(108, 126, 80, 87, 26)   # stem
    patch(108, 126, 88, 94, -16)
    # lamp foot: railing and table edge above, tablecloth below
    for y in range(95, 116):
        for x in range(108 if y < 103 else 110, 127 if y < 103 else 124):
            a[y, x] = a[y, 94] if y < 108 else a[117, x]
    return a
