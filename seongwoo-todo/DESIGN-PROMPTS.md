# GPT 이미지 생성 프롬프트 — 전체 에셋

> **이 문서의 용도**: 각 프롬프트를 GPT(이미지 생성)에 그대로 붙여 넣어 스프라이트 시트를
> 뽑는다. 판정·제약·에셋 목록·우선순위는 [`DESIGN-DIRECTION.md`](./DESIGN-DIRECTION.md).
> 프롬프트 본문은 영어다(이미지 모델이 영어 지시를 안정적으로 따른다). 각 프롬프트 앞의
> 한국어는 우리끼리의 설명이고 모델에 넣지 않는다.
> (작성: 2026-08-22 · 색상값은 코드의 실제 팔레트)

---

## 0. 공통 스타일 블록 — 모든 프롬프트 맨 앞에 반드시 붙인다

```
STYLE (apply strictly):
Top-down 2D stealth game sprite, dark industrial pixel-art style, crisp pixels,
no anti-aliasing blur, no outlines glow unless specified.
World materials never emit light: concrete and steel only, desaturated warm greys.
PALETTE (use these exact hexes, nothing outside them unless specified):
floor concrete #4b433a (light patches #5d5347, stains #2b2622, seams #211d18),
wall top #564e43, wall side #231f1a, edge highlight #8a7f6c,
steel #544b40 (shadow #241f1a, highlight #7e7361), faded hazard yellow #5c4c1c,
rust stain #4b2e19, grime #3a3b26, deep warm black #080706.
Accent lights ONLY where specified: device-on green #7dffb0, danger red #ff5a4d,
camera magenta #ff2fb0, cyan #6ce8ff, gold metal #ffe9a8/#d9a83a/#5d4113.
Mood: an indifferent underground processing facility — administrative, aged,
neglected (worn paint, rust streaks, cracks), never gory, never neon-cyberpunk.
OUTPUT FORMAT: transparent background PNG, sprite-sheet grid with EXACT cell
sizes as specified, no labels, no borders between cells, no drop shadows
(the game engine draws shadows), consistent shapes across every frame.
```

**반려 기준 (받은 이미지를 검수할 때)**: ① 격자가 지정 셀 크기와 안 맞음 ② 프레임 간
형태가 어긋남(드리프트) ③ 팔레트 밖 색이 면적으로 쓰임 ④ 배경이 불투명 ⑤ 그림자가
베이킹돼 있음 ⑥ 얼굴(이목구비)이 그려짐 → 하나라도 걸리면 재생성.

---

## A그룹 — 현재 화면에 없는 것들 (1순위)

### A1. 섬광탄 아이템 (바닥에 놓인 상태, 4프레임)

```
[공통 스타일 블록]
ASSET: Flashbang grenade pickup item, lying on the floor, seen from directly above.
A small matte steel cylinder (about 14x20 px within a 64x64 cell), worn metal
#544b40 with highlight #7e7361, a single faded hazard-yellow #5c4c1c band,
a tiny safety ring. It does NOT glow — it is dull ordnance on concrete.
SHEET: 1 row x 4 columns, each cell exactly 64x64, transparent background.
Frames 1-4: identical object with a very subtle idle shimmer on the metal
highlight only (a 2px glint moving along the band). Shape must not change.
```

### A2. 섬광 폭발 이펙트 (8프레임)

```
[공통 스타일 블록]
ASSET: Flashbang detonation effect, top-down. The ONLY moment this world is
allowed to be bright. A hard white core (#f2f8ff) expanding to a ring, with
a brief cyan fringe #6ce8ff at the rim, then collapsing into drifting smoke
wisps of desaturated grey #7c88ad at low opacity. No fire, no debris, no red.
SHEET: 1 row x 8 columns, each cell exactly 128x128, transparent background.
Frames: 1 pin-point flash, 2-3 full white burst filling ~80% of cell,
4-5 ring expands and thins, 6-8 smoke fades out. Radially symmetric.
```

### A3. grate — 소음 격자 바닥 타일 (정지 1 + 파문 4)

```
[공통 스타일 블록]
ASSET: Metal grate floor tile for a stealth game — walking on it makes noise.
Top-down 32x32 px tile (render at 64x64, will be downscaled). Worn steel
crosshatch grating #544b40 over a dark void #100e0c beneath, edge frame with
highlight #7e7361, small rust spots #4b2e19. Must tile seamlessly on all sides.
SHEET: 1 row x 5 columns, each cell exactly 64x64.
Frame 1: idle tile. Frames 2-5: a faint circular noise ripple — thin concentric
ring in pale grey #c9e9ff at LOW opacity expanding from center and fading.
The grate itself must stay pixel-identical in all frames; only the ring changes.
```

### A4. 레이저 — 발사기 + 빔 (발사기 2 + 빔 4)

```
[공통 스타일 블록]
ASSET: Wall-mounted industrial laser emitter and its beam, top-down.
Emitter: a squat steel box 20x14 px in a 64x64 cell, #544b40 with #241f1a
shading, a single small lens. OFF state lens is dark #3d445e; ON state lens
glows danger red #ff5a4d with a 2px halo only.
Beam: a horizontal red laser beam strip for a 64x16 cell — hard 2px core
#ff5a4d with faint 1px outer glow, slight intensity shimmer across frames,
dust motes barely visible in the glow. The beam must be perfectly straight
and horizontally tileable.
SHEET: row 1 = emitter OFF, emitter ON (two 64x64 cells);
row 2 = beam frames 1-4 (four 64x16 cells stacked in a 64x64 area is NOT
acceptable — lay the four beam cells side by side, each exactly 64x16).
```

### A5. powerBus — 전력 채널 패널 (채널 램프 2 + 전환 4)

```
[공통 스타일 블록]
ASSET: Wall-mounted power distribution panel showing which single circuit is
live — the core visual of a "only one channel can be ON" mechanic. Top-down.
A steel junction box 24x24 px in a 64x64 cell, #544b40, with two stubby
conduit pipes leaving it, and ONE indicator lamp. Lamp ON = device green
#7dffb0 with small halo; lamp OFF = dead dark slot #3d445e, no glow.
SHEET: 1 row x 6 columns, each cell exactly 64x64.
Frame 1: lamp ON steady. Frame 2: lamp OFF steady.
Frames 3-6: power handover — lamp flickers out (3-4) and the residual glow
drains away (5-6). Box and pipes pixel-identical in all frames.
```

---

## B그룹 — 기존 코드 드로잉 교체 후보 (A그룹 톤 확인 후)

### B1. 주인공 I — 보행 32프레임 (표준 32분할 시트)

```
[공통 스타일 블록]
ASSET: The player character "I" — a faceless human silhouette, top-down view,
for a dark stealth game. Body reads as a person from above: head circle
smaller than shoulder oval (head ~13px, shoulders ~22px at final 32px scale;
render at 2x in 64x64 cells). Core body color near-white #f2f8ff with a thin
cyan rim light #6ce8ff on the facing edge, dark shade #0a1018 underneath.
NO face, NO eyes, NO mouth — direction is shown only by shoulder axis, head
offset, and a hair mass on the back of the head.
SHEET: 4 rows x 8 columns = 32 cells, each cell exactly 64x64, transparent.
Row 1 = walking DOWN (facing camera-south), row 2 = LEFT, row 3 = RIGHT,
row 4 = UP. Each row is one full 8-frame walk cycle: contact, down, passing,
up positions with opposite arm/leg phase. Silhouette volume and colors must be
identical across all 32 cells — only limb positions change.
```

**구현 메모(팀원용)**: 잔상(MY/ME/MINE)은 이 시트를 그대로 쓰고 코드에서 틴트+알파
(시안 `#4fd8ff` 0.62 / 보라 `#a97bff` 0.57 / 핑크 `#ff6b9d` 0.52)로 처리한다.
4색을 따로 생성하지 않는다 — 톤이 어긋난다.

### B2. 경비 4종 (각각 별도 프롬프트로 실행, 시트 규격은 B1과 동일)

공통 꼬리표(각 프롬프트 끝에 붙임):
```
SHEET: 4 rows x 8 columns, 64x64 cells, same row order and cycle rules as a
standard 4-direction walk sheet. Guard body color warm red #ff5a4d with pale
outline #ff9a90 and dark shade #2a0d0b. Faceless. No weapons, no gore.
```

- **SENTRY** `A patrol guard, broad-shouldered humanoid silhouette (~28px shoulders at final scale), steady confident walk, upright posture.`
- **HOUND** `A four-legged tracker unit shaped like a lean dog: body LONGER than wide (~14x28px), small head with a short snout, thin tail swinging at half the leg rate, galloping stretch-and-compress cycle.`
- **BRUTE** `A massive wide unit (~51px shoulders at final scale) — a walking slab, shoulders far wider than depth, tiny slow steps, heavy sway, cannot fit narrow corridors and must look like it.`
- **WATCHER** `A legless sensor unit on a tripod mount: no legs at all, a tripod base, an enlarged head-sensor (~16px), almost motionless — its 8 frames are a slow sensor swivel, not a walk. It never chases; it only watches and calls.`

### B3. CORE — 금색 마름모 (회전 8프레임)

```
[공통 스타일 블록]
ASSET: The suppression core — a small gold diamond (rhombus) artifact,
top-down, about 14x16 px at final scale (render in 64x64 cells).
CRITICAL: it is lit metal, NOT a glowing gem — light face #ffe9a8, mid
#d9a83a, shadow face #5d4113, one tiny specular stroke on the upper edge,
a thin darker outer shell ring rotating the opposite way.
SHEET: 1 row x 8 columns, 64x64 cells: one full smooth rotation of the diamond
(and counter-rotation of the shell), constant size, no trail, no sparkle.
```

### B4. 게이트 셔터 (개폐 4) / B5. 출구 문 (SEALED·EXIT 각 2)

```
[공통 스타일 블록]
ASSET: Industrial sliding steel shutter gate, top-down, closing from both
sides toward the middle. Panels in worn steel #544b40 with 45-degree faded
hazard stripes #5c4c1c (dirty, chipped), top lip highlight #7e7361, frame
always visible in #241f1a.
SHEET: 1 row x 4 columns, each cell exactly 64x32 (a 2-tile-wide doorway at
2x): frame 1 fully open (only the frame and a faint green #7dffb0 floor tint),
frames 2-3 panels sliding in, frame 4 fully shut.
```

```
[공통 스타일 블록]
ASSET: The facility's outer exit door, top-down, 2 states x 2 frames.
SEALED state: heavy dead-grey steel slab #4a453c, dashed border, faded hazard
stripes, absolutely no light. OPEN state: the slab is gone — the doorway
carries a calm device-green #7dffb0 edge glow and a slow flowing dashed
outline. SHEET: 1 row x 4 columns, 64x32 cells: sealed 1-2 (subtle dust
shimmer only), open 1-2 (dash flow offset).
```

### B6. 벽 버튼(문 여는 클릭 버튼, 3) / B7. 발판(2) / B8. 레버(2)

```
[공통 스타일 블록]
ASSET: Round industrial wall button in a steel housing, top-down. Housing
circle ~22px (in 64x64 cell), #544b40 with top-half highlight rim #7e7361,
bottom-half shadow. Center lamp circle ~12px.
SHEET: 1 row x 3 columns, 64x64: frame 1 OFF (lamp is a dark machined
recess #3d445e, no glow), frame 2 ON (lamp green #7dffb0 with small halo),
frame 3 PRESSED (housing dips 1px, lamp bright, halo slightly larger).
```

```
[공통 스타일 블록]
ASSET: Floor pressure plate — a steel plate set flush into concrete,
top-down, 32x32 tile (render 64x64). A 1px dark groove around it, beveled
edges: light on top/left, dark on bottom/right.
SHEET: 1 row x 2 columns: frame 1 RAISED (bevel normal, inner rim is an
unlit machined groove), frame 2 PRESSED (bevel inverted — light/dark swap,
plate darkened ~15%, inner rim glows green #7dffb0).
```

```
[공통 스타일 블록]
ASSET: Industrial lever on a small steel base, top-down. Base plate ~18x6px,
handle arm ~16px with a round knob. SHEET: 1 row x 2 columns, 64x64:
frame 1 handle tilted LEFT, knob dark #3d445e; frame 2 handle tilted RIGHT,
knob green #7dffb0. Base identical in both.
```

### B9. EYE/CCTV (스윕 8) / B10. 상자 (1+2) / B11. 타일셋

```
[공통 스타일 블록]
ASSET: Ceiling surveillance eye, top-down: a round steel housing ~20px with
a lens. Lens glows magenta #ff2fb0 (the ONLY magenta thing in this world).
SHEET: 1 row x 8 columns, 64x64: one slow left-to-right-and-back lens sweep.
Housing pixel-identical; only the lens highlight position moves. Add a 9th
variant cell if possible: DISABLED — lens dark, a pale X #7e7361 across it.
```

```
[공통 스타일 블록]
ASSET: Pushable steel crate, top-down, exactly one 32x32 tile (render 64x64).
Worn steel lid #544b40, two plank seams #211d18, one vertical steel band,
corner highlights #7e7361. No neon, no markings.
SHEET: 1 row x 3 columns: idle, and two subtle push-jitter frames (1px offset
wobble) for when it is being shoved.
```

```
[공통 스타일 블록]
ASSET: Top-down floor-and-wall tileset for an underground concrete facility.
Each tile exactly 64x64 (final 32px). 12 tiles in one 3x4 grid:
(1) plain floor, (2) floor light patch, (3) floor dark stain, (4) floor with
irregular slab seam, (5) floor crack, (6) floor drain groove, (7) round drain
cover, (8) wall top plain, (9) wall top with brick seams offset per row,
(10) wall side face (7px lip at bottom), (11) wall base with rust streaks
#4b2e19, (12) wall base with grime #3a3b26. Floors must tile seamlessly;
NO grid lines, NO repeating obvious pattern.
```

---

## C그룹 — 연출 소스

### C1. 인트로/막간 만화 배경 (예: 선반 방 — 막간 2)

```
Black-and-white manga panel background, ink on paper style: a wide low storage
room in an industrial facility, rows of steel shelving receding into darkness,
each shelf cell holding one motionless faceless human silhouette in a
different frozen pose. Screentone halftone dots (6px pitch, ~-24 degree angle)
for mid-tones, heavy black ink shadows, thin wobbly hand-inked outlines,
single hanging fluorescent tube as the only light source. No text, no faces,
no gore. Composition leaves the lower-left third emptier for a caption box.
Aspect 3:2, monochrome only (paper #080a11 as black, ink #e6ecff as white —
this comic is white-ink-on-dark-paper).
```

(다른 컷은 같은 틀에서 장면 문장만 교체: 손잡이 달린 문 바깥쪽 / 벽의 금 클로즈업 /
넷씩 묶인 금과 인쇄체 일련번호 / 마지막 문과 복도의 세 실루엣.)

### C2. 타이틀 키 비주얼

```
[공통 스타일 블록의 팔레트 부분만 유지]
Key visual illustration, top-down-ish elevated angle: a dark concrete corridor
lit by sparse cold fluorescent pools; one bright white-cyan figure walking
toward a heavy sealed door, followed by three translucent echoes of the same
figure in cyan #4fd8ff, violet #a97bff, pink #ff6b9d, each fading further
back. On the wall, tally marks grouped in fours stretch into darkness.
Administrative horror mood — quiet, indifferent, no monsters. Title space
left clear in the upper third. 16:10 aspect.
```

---

## Codex에 이미지 생성을 시키는 법

Codex는 코딩 에이전트라 **이미지를 직접 그리지 못한다.** Codex에게 시킬 일은
"OpenAI 이미지 API(`gpt-image-1`)를 호출하는 스크립트를 만들어 실행하고, 결과 PNG를
정리하는 것"이다. 이렇게 하면 프롬프트 17개를 손으로 붙여 넣는 대신 일괄 생성·재생성이
된다.

**준비물**: `OPENAI_API_KEY` 환경변수 (이미지 API는 과금 대상 — 후보 수 × 에셋 수만큼
호출된다는 점 유의).

**Codex에 붙여 넣을 지시문 (이 저장소 루트에서 실행)**:

```
seongwoo-todo/DESIGN-PROMPTS.md 를 읽어라. A그룹(A1~A5)의 각 코드 블록이
이미지 생성 프롬프트다. 다음을 수행하라:

1. Node 스크립트 seongwoo-todo/assets/generate.mjs 를 작성한다.
   - OpenAI Images API, 모델 "gpt-image-1" 사용.
   - 각 프롬프트 = [공통 스타일 블록] 자리에 문서 §0의 STYLE 블록 전문을 이어 붙인
     하나의 문자열.
   - 파라미터: size는 시트 비율에 맞는 최근접 지원 크기(정방형 시트는 1024x1024,
     가로 시트는 1536x1024), background "transparent", quality "high", n=2.
   - 출력: seongwoo-todo/assets/{에셋ID}/cand-{n}.png 로 저장.
2. A1~A5를 실행하고, 결과 파일 목록과 각 파일의 실제 크기를 보고하라.
3. 게임 코드는 절대 수정하지 마라. assets 폴더 밖에 쓰지 마라.
```

**받은 뒤 할 일 (사람 검수 — Codex에 맡기지 않는다)**: 문서 §0의 반려 기준 6개로
후보를 거른다. 특히 격자 정렬은 이미지 모델이 자주 틀리므로, 셀 경계에 32/64px 눈금을
겹쳐 확인한다. 불합격이면 Codex에 `A3만 다시 생성. 이전 결과는 셀 경계가 6px씩
밀렸다 — 프롬프트에 "grid must align exactly to 64px cell boundaries" 를 덧붙여라`
처럼 **반려 사유를 명시해** 재실행시킨다.

**한계 (정직하게)**: ① `gpt-image-1`은 지원 해상도가 고정돼 있어(1024/1536 계열)
"셀당 정확히 64px"은 생성 후 크롭·리사이즈로 맞춰야 할 수 있다 — 이 후처리 스크립트도
Codex에 시키면 된다(`sharp`로 격자 슬라이스). ② 프레임 간 일관성은 프롬프트로 강제해도
완벽하지 않다 — A그룹(프레임 수 적음)이 1순위인 이유다. ③ 가장 간단한 대안은 Codex
없이 **ChatGPT에 §0 + 에셋 프롬프트를 그대로 붙여 넣는 것** — 소량 테스트는 이쪽이
빠르고, 일괄·반복 생성부터 Codex가 값을 한다.

---

## 사용 순서 (재확인)

1. A1→A5부터 생성 (교체 비용 0, 순수 추가)
2. 반려 기준으로 검수 → 통과분만 `seongwoo-todo/assets/`에 저장
3. 에셋별 구현 지시 1줄(프레임 순서·재생 틱·앵커)을 붙여 개발 팀원 전달
4. 톤 확인 후 B그룹 진행 여부 결정 — 에셋 단위로만 교체
5. B그룹 도입 확정 시 README·PITCH "에셋 0" 문구 수정 (DESIGN-DIRECTION §1-①)
