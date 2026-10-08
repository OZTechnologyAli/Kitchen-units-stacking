"""8-bit version of the dinner photo, with the table lamp painted out (a pixel candle is drawn in its place at runtime)."""
import numpy as np
from PIL import Image, ImageEnhance

def table_scene(photo):
    im = Image.open(photo).convert('RGB')
    W, H = 240, 180
    small = im.resize((W, H), Image.BOX)
    a = np.asarray(small).astype(float)
    sx = W / im.width; sy = H / im.height
    # paint out the lamp (original x 905..1025, y 440..870) by interpolating across it
    x0, x1 = int(905 * sx) - 1, int(1025 * sx) + 1
    y0, y1 = int(440 * sy) - 1, int(870 * sy) + 1
    for y in range(y0, y1 + 1):
        L = a[y, x0 - 1]; R = a[y, x1 + 1]
        for x in range(x0, x1 + 1):
            t = (x - x0 + 1) / (x1 - x0 + 2)
            a[y, x] = L * (1 - t) + R * t
    small = Image.fromarray(a.clip(0, 255).astype('uint8'))
    small = ImageEnhance.Color(ImageEnhance.Contrast(small).enhance(1.15)).enhance(1.5)
    small = ImageEnhance.Brightness(small).enhance(0.8)
    q = small.quantize(colors=48, method=Image.Quantize.MEDIANCUT, kmeans=4, dither=Image.Dither.NONE).convert('RGB')
    return np.asarray(q)
