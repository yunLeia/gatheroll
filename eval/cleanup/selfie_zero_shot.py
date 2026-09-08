#!/usr/bin/env python3
"""SigLIP2 zero-shot baseline for the selfie-detection experiment.

Reads only local files named in the manifest. Never uploads or transmits
images. Uses a pretrained SigLIP2 checkpoint's image and text encoders
directly (zero-shot) -- no fine-tuning, no training loop.
"""

import argparse
import json
import sys
from pathlib import Path

DEFAULT_MODEL = "google/siglip2-base-patch16-224"

# Prompt wording matters for zero-shot quality; these three are deliberately
# mutually exclusive framings of "who is this photo of, from whose camera."
PROMPTS = {
    "selfie": "a selfie photograph taken by the person who appears in it, arm's length or mirror",
    "portrait_by_other": "a portrait photograph of one person, taken by someone else holding the camera",
    "group_photo": "a group photo of multiple people posing together",
}


def load_manifest(manifest_path: Path) -> list[tuple[str, str]]:
    data = json.loads(manifest_path.read_text())
    return [(row["photo_id"], row["source_file"]) for row in data["examples"]]


def resolve_source(root: Path, source_file: str) -> Path:
    root_resolved = root.resolve()
    resolved = (root_resolved / source_file).resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise SystemExit(f"Source escapes photo root: {source_file}")
    return resolved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face checkpoint id")
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit(f"Refusing to overwrite existing artifact: {args.out}")

    import torch
    from PIL import Image
    from transformers import AutoModel, AutoProcessor

    processor = AutoProcessor.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model)
    model.eval()

    labels = list(PROMPTS.keys())
    texts = [PROMPTS[label] for label in labels]

    results = {}
    with torch.no_grad():
        text_inputs = processor(text=texts, padding="max_length", return_tensors="pt")
        text_features = model.get_text_features(**text_inputs)
        for photo_id, source_file in load_manifest(args.manifest):
            path = resolve_source(args.root, source_file)
            image = Image.open(path).convert("RGB")
            image_inputs = processor(images=image, return_tensors="pt")
            image_features = model.get_image_features(**image_inputs)
            logits = (image_features @ text_features.T)[0]
            scores = {label: float(score) for label, score in zip(labels, logits.tolist())}
            predicted = max(scores, key=scores.get)
            results[photo_id] = {**scores, "predicted_label": predicted}
            print(f"scored {photo_id}: {predicted}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"model": args.model, "prompts": PROMPTS, "results": results}, indent=2) + "\n"
    )
    print(f"Wrote {len(results)} zero-shot results to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
