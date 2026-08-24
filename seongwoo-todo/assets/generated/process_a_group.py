from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
OUT = ROOT / "a-group"

PALETTE = [
    "#4b433a",
    "#5d5347",
    "#2b2622",
    "#211d18",
    "#564e43",
    "#231f1a",
    "#8a7f6c",
    "#544b40",
    "#241f1a",
    "#7e7361",
    "#5c4c1c",
    "#4b2e19",
    "#3a3b26",
    "#080706",
    "#100e0c",
    "#3d445e",
    "#7dffb0",
    "#ff5a4d",
    "#6ce8ff",
    "#f2f8ff",
    "#7c88ad",
    "#c9e9ff",
]
PALETTE_RGB = [tuple(bytes.fromhex(color[1:])) for color in PALETTE]


def nearest_palette(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    return min(
        PALETTE_RGB,
        key=lambda color: sum((channel - target) ** 2 for channel, target in zip(color, rgb)),
    )


def quantize(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            source = (red, green, blue)
            mapped = cache.setdefault(source, nearest_palette(source))
            pixels[x, y] = (*mapped, alpha)
    return image


def alpha_trim(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    return image.crop(bbox)


def fit_center(image: Image.Image, size: tuple[int, int], bounds: tuple[int, int]) -> Image.Image:
    image = alpha_trim(image)
    scale = min(bounds[0] / image.width, bounds[1] / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.NEAREST,
    )
    cell = Image.new("RGBA", size, (0, 0, 0, 0))
    cell.alpha_composite(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    return quantize(cell)


def equal_slices(image: Image.Image, count: int) -> list[Image.Image]:
    width, height = image.size
    return [
        image.crop((round(index * width / count), 0, round((index + 1) * width / count), height))
        for index in range(count)
    ]


def join_horizontal(cells: list[Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (sum(cell.width for cell in cells), max(cell.height for cell in cells)), (0, 0, 0, 0))
    x = 0
    for cell in cells:
        sheet.alpha_composite(cell, (x, 0))
        x += cell.width
    return sheet


def save(sheet: Image.Image, filename: str) -> None:
    path = OUT / filename
    sheet.save(path, optimize=True)
    print(f"{filename}: {sheet.width}x{sheet.height}")


def process_flashbang() -> None:
    source = Image.open(SOURCE / "A1-flashbang-keyed.png").convert("RGBA")
    cells = [fit_center(frame, (64, 64), (18, 28)) for frame in equal_slices(source, 4)]
    save(join_horizontal(cells), "A1-flashbang.png")


def process_detonation() -> None:
    source = Image.open(SOURCE / "A2-flashbang-detonation-keyed.png").convert("RGBA")
    cells = []
    for frame in equal_slices(source, 8):
        side = frame.width
        top = (frame.height - side) // 2
        square = frame.crop((0, top, side, top + side))
        cells.append(quantize(square.resize((128, 128), Image.Resampling.NEAREST)))
    save(join_horizontal(cells), "A2-flashbang-detonation.png")


def process_grate() -> None:
    source = Image.open(SOURCE / "A3-grate-source.png").convert("RGBA")
    strip = source.crop((0, 205, source.width, 680))
    cells = [
        quantize(frame.resize((64, 64), Image.Resampling.NEAREST))
        for frame in equal_slices(strip, 5)
    ]
    save(join_horizontal(cells), "A3-grate.png")


def process_laser() -> None:
    source = Image.open(SOURCE / "A4-laser-keyed.png").convert("RGBA")
    upper = source.crop((0, 0, source.width, source.height // 2))
    emitters = [fit_center(frame, (64, 64), (30, 26)) for frame in equal_slices(upper, 2)]
    save(join_horizontal(emitters), "A4-laser-emitter.png")

    lower = source.crop((0, source.height // 2, source.width, source.height))
    beams = []
    for frame in equal_slices(lower, 4):
        frame = alpha_trim(frame)
        frame = frame.resize((64, 6), Image.Resampling.NEAREST)
        cell = Image.new("RGBA", (64, 16), (0, 0, 0, 0))
        cell.alpha_composite(frame, (0, 5))
        beams.append(quantize(cell))
    save(join_horizontal(beams), "A4-laser-beam.png")


def process_power_bus() -> None:
    source = Image.open(SOURCE / "A5-power-bus-keyed.png").convert("RGBA")
    cells = [fit_center(frame, (64, 64), (34, 48)) for frame in equal_slices(source, 6)]
    save(join_horizontal(cells), "A5-power-bus.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    process_flashbang()
    process_detonation()
    process_grate()
    process_laser()
    process_power_bus()
