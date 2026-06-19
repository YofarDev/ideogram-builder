import math
import random
from typing import Sequence

from PIL import Image


def _srgb_to_linear(c: int) -> float:
    s = c / 255.0
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> int:
    s = c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1.0 / 2.4)) - 0.055
    return round(max(0.0, min(1.0, s)) * 255.0)


def _rgb_to_lab(r: int, g: int, b: int):
    lr, lg, lb = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)
    x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb
    y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb
    z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb
    fx = x / 0.95047
    fy = y / 1.00000
    fz = z / 1.08883
    eps, kappa = 0.008856, 903.3
    fx = fx ** (1 / 3) if fx > eps else (kappa * fx + 16) / 116
    fy = fy ** (1 / 3) if fy > eps else (kappa * fy + 16) / 116
    fz = fz ** (1 / 3) if fz > eps else (kappa * fz + 16) / 116
    return (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


def _lab_to_rgb(l: float, a: float, b: float):
    fy = (l + 16.0) / 116.0
    fx = a / 500.0 + fy
    fz = fy - b / 200.0
    eps, kappa = 0.008856, 903.3
    xr = fx ** 3 if fx ** 3 > eps else (116.0 * fx - 16.0) / kappa
    yr = l / kappa if l <= kappa * eps else ((l + 16.0) / 116.0) ** 3
    zr = fz ** 3 if fz ** 3 > eps else (116.0 * fz - 16.0) / kappa
    x, y, z = xr * 0.95047, yr * 1.00000, zr * 1.08883
    lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
    lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z
    lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    return (_linear_to_srgb(lr), _linear_to_srgb(lg), _linear_to_srgb(lb))


def _lab_distance_sq(lab_a, lab_b):
    dl = lab_a[0] - lab_b[0]
    da = lab_a[1] - lab_b[1]
    db = lab_a[2] - lab_b[2]
    return dl * dl + da * da + db * db


def _sample_pixels_as_lab(image: Image.Image, max_samples=5000, gray_threshold=8.0):
    total = image.width * image.height
    step = max(1, total // max_samples)
    pixels = []
    for y in range(image.height):
        for x in range(image.width):
            if (y * image.width + x) % step != 0:
                continue
            px = image.getpixel((x, y))
            r, g, b = px[0], px[1], px[2]
            lab = _rgb_to_lab(r, g, b)
            chroma = math.sqrt(lab[1] ** 2 + lab[2] ** 2)
            if chroma < gray_threshold:
                lab = (lab[0], 0.0, 0.0)
            pixels.append(lab)
    return pixels


def _kmeans_plus_plus_init(pixels: list, k: int, seed=42):
    rng = random.Random(seed)
    centroids = [pixels[rng.randint(0, len(pixels) - 1)]]
    for _ in range(1, k):
        dists = [
            min(_lab_distance_sq(p, c) for c in centroids) for p in pixels
        ]
        total = sum(dists)
        if total == 0:
            centroids.append(pixels[rng.randint(0, len(pixels) - 1)])
            continue
        target = rng.random() * total
        cumulative = 0.0
        for i, d in enumerate(dists):
            cumulative += d
            if cumulative >= target:
                centroids.append(pixels[i])
                break
    return centroids


def _kmeans_lab(pixels: list, k: int, max_iterations=20, seed=42):
    if len(pixels) <= k:
        return list(pixels[:k])
    centroids = _kmeans_plus_plus_init(pixels, k, seed)
    assignments = [0] * len(pixels)
    for _ in range(max_iterations):
        for i, p in enumerate(pixels):
            nearest = min(range(k), key=lambda ci: _lab_distance_sq(p, centroids[ci]))
            assignments[i] = nearest
        new_centroids = []
        for ci in range(k):
            cluster = [pixels[j] for j in range(len(pixels)) if assignments[j] == ci]
            if cluster:
                avg_l = sum(p[0] for p in cluster) / len(cluster)
                avg_a = sum(p[1] for p in cluster) / len(cluster)
                avg_b = sum(p[2] for p in cluster) / len(cluster)
                new_centroids.append((avg_l, avg_a, avg_b))
            else:
                rng = random.Random(seed + ci)
                new_centroids.append(pixels[rng.randint(0, len(pixels) - 1)])
        if all(_lab_distance_sq(centroids[i], new_centroids[i]) < 0.01 for i in range(k)):
            centroids = new_centroids
            break
        centroids = new_centroids
    counts = [0] * k
    for a in assignments:
        counts[a] += 1
    sorted_indices = sorted(range(k), key=lambda i: counts[i], reverse=True)
    return [centroids[i] for i in sorted_indices]


def _snap_gray(centroids: list, threshold=4.0):
    result = []
    for c in centroids:
        chroma = math.sqrt(c[1] ** 2 + c[2] ** 2)
        result.append((c[0], 0.0, 0.0) if chroma < threshold else c)
    return result


def _centroids_to_hex(centroids: list) -> list[str]:
    result = []
    for c in centroids:
        r, g, b = _lab_to_rgb(c[0], c[1], c[2])
        result.append(f"#{r:02X}{g:02X}{b:02X}")
    return result


def extract_palette(image_path: str, color_count: int = 6) -> list[str]:
    image = Image.open(image_path).convert("RGB")
    pixels = _sample_pixels_as_lab(image, max_samples=5000)
    if not pixels:
        return []
    centroids = _kmeans_lab(pixels, color_count, seed=42)
    centroids = _snap_gray(centroids)
    return _centroids_to_hex(centroids)


def extract_palette_from_region(image: Image.Image, color_count: int = 5) -> list[str]:
    rgb = image.convert("RGB")
    pixels = _sample_pixels_as_lab(rgb, max_samples=3000)
    if not pixels:
        return []
    centroids = _kmeans_lab(pixels, color_count, seed=42)
    centroids = _snap_gray(centroids)
    return _centroids_to_hex(centroids)
