from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source" / "comic-comment-gpt-image-2"
OUTPUT = ROOT / "comic+comment"
PAGE_SIZE = (960, 600)

PAGES = {
    "INTRO-PAGE-1-source.png": "INTRO-PAGE-1.png",
    "INTRO-PAGE-2-source.png": "INTRO-PAGE-2.png",
    "INTRO-PAGE-3-source.png": "INTRO-PAGE-3.png",
    "M1-PAGE-source.png": "M1-PAGE.png",
    "M2-PAGE-source.png": "M2-PAGE.png",
    "M3-PAGE-source.png": "M3-PAGE.png",
    "M4-PAGE-source.png": "M4-PAGE.png",
    "END-1-source.png": "END-1.png",
    "END-2-source.png": "END-2.png",
    "END-3-source.png": "END-3.png",
}


def export(source_name: str, output_name: str) -> None:
    source = Image.open(SOURCE / source_name).convert("RGB")
    fitted = ImageOps.contain(source, PAGE_SIZE, method=Image.Resampling.LANCZOS)
    page = Image.new("RGB", PAGE_SIZE, "#080a11")
    page.paste(fitted, ((PAGE_SIZE[0] - fitted.width) // 2, (PAGE_SIZE[1] - fitted.height) // 2))
    page.save(OUTPUT / output_name, optimize=True)
    print(f"{output_name}: {page.width}x{page.height}")


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for old in OUTPUT.glob("*.png"):
        old.unlink()
    for source_name, output_name in PAGES.items():
        export(source_name, output_name)
