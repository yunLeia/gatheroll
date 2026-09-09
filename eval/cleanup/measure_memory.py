#!/usr/bin/env python3
"""One-off measurement script for the cleanup-v2 proposal's memory question.

Not part of the eval CLI, not imported anywhere -- a throwaway script whose
*printed numbers* are what matters, copied into the proposal doc. Measures
this same process's own RSS at each stage, plus a background sampler thread
for peak RSS during inference (resource.getrusage's ru_maxrss also reports
lifetime peak on macOS/BSD, used as a cross-check).
"""

import resource
import sys
import threading
import time
from pathlib import Path

import psutil

proc = psutil.Process()
MB = 1024 * 1024


def rss_mb() -> float:
    return proc.memory_info().rss / MB


def peak_rss_mb() -> float:
    # macOS ru_maxrss is bytes; Linux is KB. This machine is macOS.
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / MB


print(f"[baseline] RSS before any imports: {rss_mb():.1f} MB", file=sys.stderr)

import torch
from PIL import Image
from pillow_heif import register_heif_opener
from transformers import AutoModel, AutoProcessor

register_heif_opener()
print(f"[after ML imports] RSS: {rss_mb():.1f} MB", file=sys.stderr)

model_id = "google/siglip2-base-patch16-224"
t0 = time.time()
processor = AutoProcessor.from_pretrained(model_id)
model = AutoModel.from_pretrained(model_id)
model.eval()
load_s = time.time() - t0
print(f"[after model load] RSS: {rss_mb():.1f} MB (load took {load_s:.2f}s)", file=sys.stderr)

photos_dir = Path("../../eval_data/photos")
photo_files = sorted(photos_dir.glob("*"))[:30]
print(f"[info] using {len(photo_files)} real photos for the latency sweep", file=sys.stderr)

texts = [
    "a screenshot of a mobile app or phone screen",
    "a natural photograph taken with a camera",
]

# Background peak-RSS sampler: getrusage's ru_maxrss is a lifetime peak
# already, but sample explicitly too so peak-DURING-inference is reported
# even if some other phase (imports, model load) happened to peak higher.
peak_during_inference = {"mb": 0.0}
stop_sampling = threading.Event()


def sample_peak():
    while not stop_sampling.is_set():
        peak_during_inference["mb"] = max(peak_during_inference["mb"], rss_mb())
        time.sleep(0.02)


sampler = threading.Thread(target=sample_peak, daemon=True)

with torch.no_grad():
    text_inputs = processor(text=texts, padding="max_length", return_tensors="pt")
    text_features = model.get_text_features(**text_inputs)

    def classify_one(path: Path) -> None:
        image = Image.open(path).convert("RGB")
        image_inputs = processor(images=image, return_tensors="pt")
        image_features = model.get_image_features(**image_inputs)
        _ = (image_features @ text_features.T)[0]

    # warm-up (excluded from timing, matches earlier latency measurement)
    classify_one(photo_files[0])

    sampler.start()
    for n in (1, 10, len(photo_files)):
        batch = photo_files[:n]
        t0 = time.time()
        for f in batch:
            classify_one(f)
        elapsed = time.time() - t0
        print(
            f"[latency] n={n}: {elapsed:.2f}s total, {elapsed / n * 1000:.0f}ms/image avg",
            file=sys.stderr,
        )
    stop_sampling.set()
    sampler.join(timeout=1)

print(f"[after inference] RSS: {rss_mb():.1f} MB", file=sys.stderr)
print(f"[peak RSS during inference, sampled] {peak_during_inference['mb']:.1f} MB", file=sys.stderr)
print(f"[peak RSS, lifetime, ru_maxrss] {peak_rss_mb():.1f} MB", file=sys.stderr)
