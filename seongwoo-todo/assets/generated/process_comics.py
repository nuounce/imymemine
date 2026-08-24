from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
OUTPUT = ROOT / "comic"

PANELS = {
    "INTRO-01.png": (892, 238),
    "INTRO-02.png": (442, 288),
    "INTRO-03.png": (436, 288),
    "INTRO-04.png": (442, 290),
    "INTRO-05.png": (436, 290),
    "INTRO-06.png": (892, 236),
    "INTRO-07.png": (960, 600),
    "M1-1.png": (768, 512),
    "M1-2.png": (768, 512),
    "M2-1.png": (768, 512),
    "M2-2.png": (768, 512),
    "M3-1.png": (768, 512),
    "M3-2.png": (768, 512),
    "M4-1.png": (512, 768),
    "M4-2.png": (768, 512),
    "END-1.png": (960, 600),
    "END-2.png": (960, 600),
    "END-3.png": (960, 600),
}


def export_panel(name: str, size: tuple[int, int]) -> None:
    source = Image.open(SOURCE / name).convert("RGB")
    panel = ImageOps.fit(
        source,
        size,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    panel.save(OUTPUT / name, optimize=True)
    print(f"{name}: {panel.width}x{panel.height}")


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, dimensions in PANELS.items():
        export_panel(filename, dimensions)
