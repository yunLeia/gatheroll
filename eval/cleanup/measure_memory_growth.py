#!/usr/bin/env python3
"""Follow-up to measure_memory.py: is post-load RSS growth bounded (allocator
cache that plateaus) or does it keep climbing (a real leak)? Runs many more
images than a real batch would ever be, reusing the same small photo set,
and prints RSS at intervals so the growth curve's shape is visible."""

import sys
import time
from pathlib import Path

import torch
from PIL import Image
from pillow_heif import register_heif_opener
from transformers import AutoModel, AutoProcessor
import psutil

register_heif_opener()
proc = psutil.Process()
MB = 1024 * 1024


def rss_mb() -> float:
    return proc.memory_info().rss / MB


model_id = "google/siglip2-base-patch16-224"
processor = AutoProcessor.from_pretrained(model_id)
model = AutoModel.from_pretrained(model_id)
model.eval()
print(f"[after model load] RSS: {rss_mb():.1f} MB", file=sys.stderr)

photos_dir = Path("../../eval_data/photos")
photo_files = sorted(photos_dir.glob("*"))[:10]  # cycle through 10 real files repeatedly

texts = [
    "a screenshot of a mobile app or phone screen",
    "a natural photograph taken with a camera",
]

TOTAL = 200
CHECKPOINT_EVERY = 20

with torch.no_grad():
    text_inputs = processor(text=texts, padding="max_length", return_tensors="pt")
    text_features = model.get_text_features(**text_inputs)

    for i in range(TOTAL):
        f = photo_files[i % len(photo_files)]
        image = Image.open(f).convert("RGB")
        image_inputs = processor(images=image, return_tensors="pt")
        image_features = model.get_image_features(**image_inputs)
        _ = (image_features @ text_features.T)[0]
        del image, image_inputs, image_features
        if (i + 1) % CHECKPOINT_EVERY == 0:
            print(f"[n={i + 1}] RSS: {rss_mb():.1f} MB", file=sys.stderr)

print(f"[final, n={TOTAL}] RSS: {rss_mb():.1f} MB", file=sys.stderr)
