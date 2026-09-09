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

# Prompt wording matters for zero-shot quality; these are deliberately
# mutually exclusive framings of "who is this photo of, from whose camera."
# v2 (2026-09-08): the original 3-way set had no "none of these" option, so
# every screenshot and blurry camera photo in the real 49-photo set was
# forced into one of the 3 person-photo labels -- it landed on "selfie" in
# 31/31 of those cases, which is what actually produced the earlier 96.9%
# false-positive rate, not a genuine selfie-vs-portrait confusion. Added
# screenshot and other_no_selfie as real competing categories so the model
# isn't forced to choose among only positive-class prompts.
#
# FROZEN 2026-09-08. Do not edit these prompts against the 49-photo
# development set (eval_data/cleanup-manifest.json) again -- they were
# already revised once after inspecting errors on those same 49 photos, so
# the resulting 1.00/1.00 result (report 008) is a development-set result,
# not a held-out one. Next change to this dict must be evaluated against a
# separate, not-yet-created holdout set (~15-25 photos, per direction),
# not this one. If you're tempted to tweak wording after looking at an
# error on one of these 49 photos, stop -- that's exactly the thing being
# guarded against here.
PROMPTS = {
    "selfie": "a selfie photograph taken by the person who appears in it, arm's length or mirror",
    "portrait_by_other": "a portrait photograph of one person, taken by someone else holding the camera",
    "group_photo": "a group photo of multiple people posing together",
    "screenshot": "a screenshot of a mobile app or phone screen, not a camera photo",
    "other_no_selfie": "a photograph of scenery, objects, food, or a blurry/out-of-focus camera shot with no clear posed subject",
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
    from pillow_heif import register_heif_opener
    from transformers import AutoModel, AutoProcessor

    register_heif_opener()  # lets Image.open() read HEIC/HEIF transparently
    processor = AutoProcessor.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model)
    model.eval()

    labels = list(PROMPTS.keys())
    texts = [PROMPTS[label] for label in labels]

    results = {}
    undecodable = []
    with torch.no_grad():
        text_inputs = processor(text=texts, padding="max_length", return_tensors="pt")
        text_features = model.get_text_features(**text_inputs)
        for photo_id, source_file in load_manifest(args.manifest):
            path = resolve_source(args.root, source_file)
            try:
                image = Image.open(path).convert("RGB")
            except Exception as error:  # noqa: BLE001 -- report and continue, never fabricate a score
                undecodable.append(photo_id)
                print(f"undecodable {photo_id} ({source_file}): {error}", file=sys.stderr)
                continue
            image_inputs = processor(images=image, return_tensors="pt")
            image_features = model.get_image_features(**image_inputs)
            logits = (image_features @ text_features.T)[0]
            scores = {label: float(score) for label, score in zip(labels, logits.tolist())}
            predicted = max(scores, key=scores.get)
            results[photo_id] = {**scores, "predicted_label": predicted}
            print(f"scored {photo_id}: {predicted}", file=sys.stderr)

    if undecodable:
        print(f"{len(undecodable)} photo(s) could not be decoded and were excluded: {undecodable}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"model": args.model, "prompts": PROMPTS, "results": results, "undecodable": undecodable}, indent=2) + "\n"
    )
    print(f"Wrote {len(results)} zero-shot results to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
