"""Create deterministic rounded desktop icons from a square raster source."""

from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).parents[1] / "assets")
    parser.add_argument("--template-only", action="store_true")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    with Image.open(args.source) as source:
        base = ImageOps.fit(source.convert("RGBA"), (1024, 1024), method=Image.Resampling.LANCZOS)

    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=184, fill=255)
    base.putalpha(mask)

    if not args.template_only:
        png = base.resize((512, 512), Image.Resampling.LANCZOS)
        png.save(args.output / "dsh-desktop.png", optimize=True)
        base.save(
            args.output / "dsh-desktop.ico",
            format="ICO",
            sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )

    grayscale = base.convert("L")
    darkness = grayscale.point(lambda value: max(0, min(255, (176 - value) * 3)))
    template_alpha = ImageChops.multiply(darkness, base.getchannel("A"))
    template = Image.new("RGBA", base.size, (0, 0, 0, 0))
    template.putalpha(template_alpha)
    template.resize((18, 18), Image.Resampling.LANCZOS).save(
        args.output / "dsh-desktopTemplate.png", optimize=True
    )
    template.resize((36, 36), Image.Resampling.LANCZOS).save(
        args.output / "dsh-desktopTemplate@2x.png", optimize=True
    )


if __name__ == "__main__":
    main()
