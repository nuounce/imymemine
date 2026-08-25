from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
B_OUT = ROOT / "b-group"
C_OUT = ROOT / "c-group"

PALETTE = [
    "#4b433a", "#5d5347", "#2b2622", "#211d18", "#564e43", "#231f1a",
    "#8a7f6c", "#544b40", "#241f1a", "#7e7361", "#5c4c1c", "#4b2e19",
    "#3a3b26", "#080706", "#100e0c", "#3d445e", "#7dffb0", "#ff5a4d",
    "#ff9a90", "#2a0d0b", "#ff2fb0", "#6ce8ff", "#f2f8ff", "#0a1018",
    "#ffe9a8", "#d9a83a", "#5d4113", "#4a453c", "#c9e9ff", "#7c88ad",
]
PALETTE_RGB = [tuple(bytes.fromhex(color[1:])) for color in PALETTE]


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
            mapped = cache.get(source)
            if mapped is None:
                mapped = min(
                    PALETTE_RGB,
                    key=lambda color: sum((channel - target) ** 2 for channel, target in zip(color, source)),
                )
                cache[source] = mapped
            pixels[x, y] = (*mapped, alpha)
    return image


def alpha_trim(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else Image.new("RGBA", (1, 1), (0, 0, 0, 0))


def equal_slices(image: Image.Image, count: int) -> list[Image.Image]:
    return [
        image.crop((round(i * image.width / count), 0, round((i + 1) * image.width / count), image.height))
        for i in range(count)
    ]


def fit_center(
    image: Image.Image,
    cell_size: tuple[int, int],
    bounds: tuple[int, int],
    preserve_aspect: bool = True,
) -> Image.Image:
    image = alpha_trim(image)
    if preserve_aspect:
        scale = min(bounds[0] / image.width, bounds[1] / image.height)
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    else:
        size = bounds
    image = image.resize(size, Image.Resampling.NEAREST)
    cell = Image.new("RGBA", cell_size, (0, 0, 0, 0))
    cell.alpha_composite(image, ((cell_size[0] - image.width) // 2, (cell_size[1] - image.height) // 2))
    return quantize(cell)


def join_horizontal(cells: list[Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (sum(cell.width for cell in cells), max(cell.height for cell in cells)), (0, 0, 0, 0))
    x = 0
    for cell in cells:
        sheet.alpha_composite(cell, (x, 0))
        x += cell.width
    return sheet


def save_b(image: Image.Image, name: str) -> None:
    image.save(B_OUT / name, optimize=True)
    print(f"{name}: {image.width}x{image.height}")


def fill_opaque_rect(
    image: Image.Image,
    frame_column: int,
    frame_row: int,
    rect: tuple[int, int, int, int],
    color: tuple[int, int, int],
) -> None:
    pixels = image.load()
    left, top, right, bottom = rect
    for y in range(top, bottom):
        for x in range(left, right):
            target_x = frame_column * 64 + x
            target_y = frame_row * 64 + y
            if pixels[target_x, target_y][3] > 0:
                pixels[target_x, target_y] = (*color, pixels[target_x, target_y][3])


def remove_generated_face_marks(sheet: Image.Image, output_name: str) -> None:
    if output_name == "B1-player.png":
        for column in range(8):
            fill_opaque_rect(sheet, column, 1, (27, 19, 32, 23), (10, 16, 24))
            fill_opaque_rect(sheet, column, 2, (33, 20, 37, 24), (10, 16, 24))
    elif output_name == "B2-hound.png":
        for column in range(8):
            fill_opaque_rect(sheet, column, 0, (27, 49, 38, 55), (255, 90, 77))
            fill_opaque_rect(sheet, column, 1, (7, 27, 17, 35), (255, 90, 77))
            fill_opaque_rect(sheet, column, 2, (47, 23, 57, 31), (255, 90, 77))


def process_character(source_name: str, output_name: str) -> None:
    source = Image.open(SOURCE / source_name).convert("RGBA")
    sheet = quantize(source.resize((512, 256), Image.Resampling.NEAREST))
    remove_generated_face_marks(sheet, output_name)
    save_b(sheet, output_name)


def process_strip(
    source_name: str,
    output_name: str,
    frame_count: int,
    cell_size: tuple[int, int],
    bounds: tuple[int, int],
    preserve_aspect: bool = True,
) -> None:
    source = Image.open(SOURCE / source_name).convert("RGBA")
    cells = [fit_center(frame, cell_size, bounds, preserve_aspect) for frame in equal_slices(source, frame_count)]
    save_b(join_horizontal(cells), output_name)


def process_tileset() -> None:
    source = Image.open(SOURCE / "B11-tileset-source.png").convert("RGBA")
    sheet = Image.new("RGBA", (192, 256), (0, 0, 0, 255))
    for row in range(4):
        for column in range(3):
            left = round(column * source.width / 3)
            right = round((column + 1) * source.width / 3)
            top = round(row * source.height / 4)
            bottom = round((row + 1) * source.height / 4)
            tile = source.crop((left, top, right, bottom)).resize((64, 64), Image.Resampling.NEAREST)
            sheet.alpha_composite(quantize(tile), (column * 64, row * 64))
    save_b(sheet, "B11-tileset.png")


def process_c_group() -> None:
    scenes = [
        ("C1-01-shelf-room-source.png", "C1-01-shelf-room.png"),
        ("C1-02-outer-door-source.png", "C1-02-outer-door.png"),
        ("C1-03-wall-crack-source.png", "C1-03-wall-crack.png"),
        ("C1-04-grouped-core-source.png", "C1-04-grouped-core.png"),
        ("C1-05-final-door-source.png", "C1-05-final-door.png"),
    ]
    for source_name, output_name in scenes:
        image = Image.open(SOURCE / source_name).convert("RGB")
        image.save(C_OUT / output_name, optimize=True)
        print(f"{output_name}: {image.width}x{image.height}")

    title = Image.open(SOURCE / "C2-title-key-visual-source.png").convert("RGB")
    title = title.resize((1600, 1000), Image.Resampling.LANCZOS)
    title.save(C_OUT / "C2-title-key-visual.png", optimize=True)
    print("C2-title-key-visual.png: 1600x1000")


if __name__ == "__main__":
    B_OUT.mkdir(parents=True, exist_ok=True)
    C_OUT.mkdir(parents=True, exist_ok=True)

    process_character("B1-player-keyed.png", "B1-player.png")
    process_character("B2-sentry-keyed.png", "B2-sentry.png")
    process_character("B2-hound-keyed.png", "B2-hound.png")
    process_character("B2-brute-keyed.png", "B2-brute.png")
    process_character("B2-watcher-keyed.png", "B2-watcher.png")
    process_strip("B3-core-keyed.png", "B3-core.png", 8, (64, 64), (18, 18))
    process_strip("B4-gate-keyed.png", "B4-gate.png", 4, (64, 64), (62, 62), False)
    process_strip("B5-exit-keyed.png", "B5-exit.png", 4, (64, 64), (62, 62), False)
    process_strip("B6-wall-button-keyed.png", "B6-wall-button.png", 3, (64, 64), (36, 36))
    process_strip("B7-pressure-plate-keyed.png", "B7-pressure-plate.png", 2, (64, 64), (56, 56))
    process_strip("B8-lever-keyed.png", "B8-lever.png", 2, (64, 64), (52, 48))
    process_strip("B9-eye-keyed.png", "B9-eye.png", 9, (64, 64), (36, 36))
    process_strip("B10-crate-keyed.png", "B10-crate.png", 3, (64, 64), (58, 58))
    process_tileset()
    process_c_group()
