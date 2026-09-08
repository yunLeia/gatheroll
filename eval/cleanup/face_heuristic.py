#!/usr/bin/env python3
"""Face-geometry baseline for the selfie-detection experiment.

Reads only local files named in the manifest. Never uploads or transmits
images. Writes face count/size/centering per photo -- not yet a selfie
decision; that's derived later against labels (see cleanup-selfie-compare.ts),
so thresholds can be swept without re-running detection.
"""

import argparse
import json
import sys
from pathlib import Path

import cv2

CASCADE = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"


def load_manifest(manifest_path: Path) -> list[tuple[str, str]]:
    data = json.loads(manifest_path.read_text())
    return [(row["photo_id"], row["source_file"]) for row in data["examples"]]


def resolve_source(root: Path, source_file: str) -> Path:
    root_resolved = root.resolve()
    resolved = (root_resolved / source_file).resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise SystemExit(f"Source escapes photo root: {source_file}")
    return resolved


def analyze(path: Path, detector: "cv2.CascadeClassifier") -> dict:
    image = cv2.imread(str(path))
    if image is None:
        return {"face_count": 0, "largest_face_area_ratio": 0.0, "centered": False, "error": "undecodable"}
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
    if len(faces) == 0:
        return {"face_count": 0, "largest_face_area_ratio": 0.0, "centered": False}
    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    area_ratio = (fw * fh) / (width * height)
    face_center_x, face_center_y = fx + fw / 2, fy + fh / 2
    centered = (
        0.25 * width <= face_center_x <= 0.75 * width
        and 0.15 * height <= face_center_y <= 0.85 * height
    )
    return {
        "face_count": int(len(faces)),
        "largest_face_area_ratio": float(area_ratio),
        "centered": bool(centered),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit(f"Refusing to overwrite existing artifact: {args.out}")

    detector = cv2.CascadeClassifier(CASCADE)
    if detector.empty():
        raise SystemExit("Failed to load bundled Haar Cascade -- check opencv-python-headless install")

    results = {}
    for photo_id, source_file in load_manifest(args.manifest):
        path = resolve_source(args.root, source_file)
        results[photo_id] = analyze(path, detector)
        print(f"analyzed {photo_id}: {results[photo_id]}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"technique": "haar_cascade_frontalface", "results": results}, indent=2) + "\n"
    )
    print(f"Wrote {len(results)} face-geometry results to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
