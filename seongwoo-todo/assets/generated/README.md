# Generated A-group assets

Generated from `seongwoo-todo/DESIGN-PROMPTS.md` using the built-in image generator,
then normalized to the documented sprite-cell sizes.

| File | Frames | Cell size | Playback / anchor note |
| --- | ---: | ---: | --- |
| `a-group/A1-flashbang.png` | 4 | 64×64 | Loop the idle glint slowly; center anchor. |
| `a-group/A2-flashbang-detonation.png` | 8 | 128×128 | Play once from frame 1 through 8; center anchor. |
| `a-group/A3-grate.png` | 5 | 64×64 | Frame 1 idle; play 2–5 once on noise; tile anchor. |
| `a-group/A4-laser-emitter.png` | 2 | 64×64 | Frame 1 off, frame 2 on; center anchor. |
| `a-group/A4-laser-beam.png` | 4 | 64×16 | Loop while enabled; horizontally tileable strip. |
| `a-group/A5-power-bus.png` | 6 | 64×64 | Frames 1–2 steady states; 3–6 handover; center anchor. |

The `source/` directory preserves the generated originals and chroma-keyed intermediates.
`process_a_group.py` performs nearest-neighbor resizing and restricts visible pixels to the
palette documented in `DESIGN-PROMPTS.md`.

## B-group assets

The `b-group/` directory contains the complete B1–B11 set. Character sheets are 4 rows ×
8 columns of 64×64 cells. Device sheets follow the frame counts and cell sizes in
`DESIGN-PROMPTS.md`; the CCTV sheet includes the optional ninth disabled frame.

## C-group assets

The `c-group/` directory contains five 3:2 monochrome manga backgrounds and one 16:10 title
key visual. `process_b_c.py` reproduces the B-group normalization and C-group export.
