"""Create deterministic rounded desktop icons from a square raster source."""

from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).parents[1] / "assets")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    with Image.open(args.source) as source:
        base = ImageOps.fit(source.convert("RGBA"), (1024, 1024), method=Image.Resampling.LANCZOS)

    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=184, fill=255)
    base.putalpha(mask)

    png = base.resize((512, 512), Image.Resampling.LANCZOS)
    png.save(args.output / "dsh-desktop.png", optimize=True)
    base.save(
        args.output / "dsh-desktop.ico",
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
