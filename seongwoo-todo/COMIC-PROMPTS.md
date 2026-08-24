# 만화 제작 프롬프트 — 인트로 · 막간 · 엔딩 (컷별 전체)

> **이 문서의 용도**: 인트로 7컷, 막간 4종 8컷, 엔딩 3컷의 GPT 이미지 생성 프롬프트.
> 각 프롬프트는 §0 공통 블록 + 컷 프롬프트를 이어 붙여 ChatGPT(구독)에 넣는다.
> 톤 기준은 이미 생성돼 통과한 `assets/generated/source/C1-05-final-door-source.png` —
> **그 그림이 정답 톤이다.** 새 컷이 그것과 나란히 놓였을 때 한 작가의 그림으로 보여야 한다.
> (작성: 2026-08-24 · 장면·대사 근거: [`STORY-SURFACES.md`](./STORY-SURFACES.md) §1·§2,
> 잔인성 채택분: [`IMPLEMENT-CRUELTY.md`](./IMPLEMENT-CRUELTY.md))

---

## 0. 만화 공통 스타일 블록 — 모든 컷 프롬프트 앞에 붙인다

```
COMIC STYLE (apply strictly):
Black-and-white manga panel, WHITE INK ON DARK PAPER — the paper is near-black
(#080a11), lines and light are pale ink (#e6ecff). This is an inverted comic:
darkness is the default, light is drawn.
Halftone screentone dots for all mid-tones (fine dot pitch, screen angle about
-24 degrees), heavy solid black shadows, thin slightly wobbly hand-inked
outlines (no vector-clean lines), visible ink texture.
Figures are FACELESS silhouettes — no eyes, no mouth, no facial features ever.
Emotion comes only from posture, light, and composition. Clothing is a plain
simple coat shape, no hoods, no logos, no details.
The only light sources are cold fluorescent tubes. Industrial underground
concrete facility: pipes, stained walls, drains — administrative neglect,
never gore, never monsters.
NO TEXT anywhere in the image. No letters, no numbers, no signs — all captions
and printed labels are overlaid by the game engine later.
NO panel border — full-bleed single panel artwork (the engine draws the frame).
Leave the specified corner visually quiet (low detail, dark) for a caption box.
```

**반려 기준**: ① 글자·숫자가 그려짐 ② 얼굴·이목구비 ③ 하프톤 없이 매끈한 그라데이션
④ 컬러 유입 ⑤ 기준작(C1-05)과 나란히 놓았을 때 다른 작가 그림으로 보임 ⑥ 캡션 코너가
복잡함. 하나라도 걸리면 사유를 붙여 재생성.

**분업 원칙 (중요)**: 벽의 금(tally), 발판↔문 인과선, `출고` 태그, 일련번호, 라벨 같은
**정확해야 하는 그래픽과 모든 글자는 코드가 위에 그린다.** 이미지는 장면만 담는다 —
프롬프트마다 "그 자리를 비워 두라"로 지시돼 있다. 그래야 컷2↔컷7의 금이 같은 시드로
회수되는 기존 연출이 유지된다.

**생성 크기**: 가로 칸은 1536×1024로 받아 상하 크롭, 세로/정방 칸은 1024×1024.
각 프롬프트의 `COMPOSE FOR` 비율에 맞춰 중앙 밴드에 구도를 잡게 했다.

---

## 1. 인트로 7컷 (아무것도 모르는 사람 → "내가 남으면 되지"까지)

만화 문법 메모: 7컷의 샷 사이즈는 와이드 → 익스트림 클로즈업 → 미디엄 → 익스트림
클로즈업 → 투샷 → 와이드 → 전면으로 **넓힘/조임을 교대**한다. 같은 사이즈가 연속되면
호흡이 죽는다. 시선 유도는 각 컷의 광원 위치가 맡는다.

### I-1 낯선 천장 (와이드 892×238, 로우앵글) — 캡션 좌하

```
[§0 블록]
PANEL: Extreme low angle looking straight up at a concrete ceiling from the
floor, as seen by someone lying on their back. One fluorescent tube fixture
slightly off-center right, mid-flicker — half the tube lit, hard pale light,
the rest of the ceiling falling into black. Hairline cracks and a water stain
on the concrete, barely caught by the light. Wide letterbox composition.
COMPOSE FOR a very wide strip (about 15:4) in the center band. Lower-left
corner quiet for caption.
```

### I-2 벽의 금 (익스트림 클로즈업 442×288) — 캡션 우상 · **금은 그리지 않는다**

```
[§0 블록]
PANEL: Extreme close-up of a raw concrete wall surface at waist height,
grazing light from the left making every pore and aggregate grain visible.
Fine cracks, one old scrape mark. The center-right area of the wall is
deliberately EMPTY and evenly lit — a clean patch of concrete (the game
engine will draw tally marks there; do not draw any marks, lines or symbols).
COMPOSE FOR 3:2. Upper-right corner quiet for caption.
```

### I-3 손잡이 없는 문 (미디엄 436×288) — 캡션 좌하

```
[§0 블록]
PANEL: Medium shot. A faceless figure stands with their back half-turned to
us, looking at a heavy steel door set flush in a concrete wall. The door has
hinges and a seam but NO handle — its surface is uncannily smooth where a
handle should be; let the empty smooth patch catch the most light.
A single fluorescent tube above the door. The figure's posture: shoulders
slightly raised, one hand half-lifted, hesitating. COMPOSE FOR 3:2.
Lower-left corner quiet for caption.
```

### I-4 발현 (익스트림 클로즈업 442×290) — 캡션 좌상 · 빛이 번지는 컷

```
[§0 블록]
PANEL: Extreme close-up of a reaching hand and forearm, palm open, fingers
spread — and from the hand a pale double-exposure: two fainter copies of the
same hand trailing behind it at slight offsets, like an afterimage burned
into the dark. The light comes FROM the hand copies themselves — the only
self-luminous thing in this whole comic. Edges of the panel stay almost
black so the glow feels contained. COMPOSE FOR 3:2. Upper-left corner quiet.
```

### I-5 되풀이 (투샷 436×290) — 캡션 우상

```
[§0 블록]
PANEL: Two-shot. On the right, the faceless figure walking away mid-stride.
On the left, a translucent paler copy of the SAME figure repeating an earlier
gesture (reaching toward a wall), drawn lighter, edges slightly unstable.
Thin horizontal speed lines behind the walking figure only. The copy does not
look at anyone — it just repeats. Cold tube light from above center.
COMPOSE FOR 3:2. Upper-right corner quiet.
```

### I-6 발판과 문 (와이드 892×236) — 캡션 좌하 · **인과선은 그리지 않는다**

```
[§0 블록]
PANEL: Wide establishing shot of a long room. Far left: a steel pressure
plate set into the floor, lit by its own small pool of tube light. Far right:
the heavy sealed door, lit by another pool. Between them: darkness, pipes,
distance — the two lit islands feel impossibly far apart. One small faceless
figure stands in the middle, tiny in the composition, facing the door.
Do NOT draw any connecting line between plate and door (the engine draws it).
COMPOSE FOR a very wide strip (about 15:4). Lower-left corner quiet.
```

### I-7 넷 (전면 960×600) — 캡션 하단 중앙 · **머리 위 벽은 비워 둔다**

```
[§0 블록]
PANEL: Full-bleed final page. Four faceless figures stand in a loose row
facing us, evenly spaced, in front of a concrete wall washed by one long
fluorescent tube. Each figure holds a DIFFERENT pose: one standing straight,
one slumped with head dropped, one with arms folded, one with a hand half
raised. Same body, four attitudes. The wall area just above their heads is
kept clean and evenly lit (the engine draws marks there — draw nothing).
The floor catches four faint pools of reflected light. COMPOSE FOR 8:5.
Bottom-center kept quiet for a final caption.
```

---

## 2. 막간 4종 × 2컷

막간은 인트로보다 **한 뼘 더 어둡고 조용하다** — 인물이 등장해도 항상 작거나 등을 보인다.

### M1-1 문 바깥쪽 (컷1) — 캡션 우상

```
[§0 블록]
PANEL: A faceless figure seen from behind, just past a doorway, turning back
to look at the door they came through. On THIS side the steel door has a
plain handle, hit by the brightest light in the panel — the handle is the
subject; the figure is dim. Corridor walls converge behind. COMPOSE FOR 3:2.
Upper-right corner quiet.
```

### M1-2 수율 표 (컷2) — 캡션 우하 · **글자는 코드가 얹는다**

```
[§0 블록]
PANEL: Close-up of a sheet of paper taped to a concrete wall at eye height,
slightly curled at one corner, lit flatly by a tube above. The paper is
BLANK — draw only its texture, tape, and a faint pencil-line grid ghosting
(the engine overlays the handwritten table). A second, older tape-shadow
beside it hints other sheets hung here before. COMPOSE FOR 3:2.
Lower-right quiet.
```

### M2-1 선반 (컷1) — 무자막 · **빈 칸 하나 + 태그 자리 비움** (잔인성 채택분 반영)

```
[§0 블록]
PANEL: Wide low storage room. Rows of steel shelving recede into darkness,
each large cell holding ONE motionless faceless silhouette in a different
frozen pose — standing, crouched, reaching. One tube light down the aisle.
In the middle band of the composition, ONE cell is EMPTY — nothing inside,
its interior slightly brighter than the others, with a small blank paper tag
on its edge (draw the tag blank; the engine prints the word). The empty cell
should be the second thing the eye finds, not the first. COMPOSE FOR 3:2.
No caption corner needed — this panel has no text at all.
```

### M2-2 내 자세 (컷2) — 캡션 좌하

```
[§0 블록]
PANEL: Closer shot down one shelf aisle. In the nearest cell, a silhouette
frozen mid-gesture — one arm extended, weight on the left foot, head slightly
bowed — held in the exact instant of an action that no longer has a purpose.
The viewing figure is NOT in frame; we are their eyes. Cell edges hard-lit,
contents soft. COMPOSE FOR 3:2. Lower-left quiet.
```

### M3-1 셈 (컷1) — 캡션 좌상 · **금은 코드가 그린다**

```
[§0 블록]
PANEL: A concrete wall filling the frame at a slight diagonal, receding
toward the right edge into darkness — the sense that the wall continues far
beyond the panel. Grazing light reveals texture. Keep the whole marked band
of the wall EMPTY (engine draws the tally rows). Draw only faint smudges and
fingerprints at hand height, as if many hands touched this wall.
COMPOSE FOR 3:2. Upper-left quiet.
```

### M3-2 일련번호 (컷2) — 캡션 우하 · **번호는 코드가 얹는다**

```
[§0 블록]
PANEL: Extreme close-up, bottom section of the same wall near the floor.
A small clean rectangular patch where something was stenciled — draw the
patch EMPTY but framed by a sprayed edge shadow, unmistakably machine-made
against the hand-worn concrete around it. A hairline crack passes close by
but respectfully avoids the patch. COMPOSE FOR 3:2. Lower-right quiet.
```

### M4-1 마지막 문 (컷1) — 캡션 좌하

```
[§0 블록]
PANEL: Tall composition. The final door — larger and heavier than any other,
double-height steel — looms over a small faceless figure standing before it,
back to us, arms at their sides. One tube directly above the figure makes a
tight pool; the top of the door disappears into darkness above the light.
COMPOSE FOR 2:3 vertical (generate 1024x1536 if available, else 1024x1024
and crop sides). Lower-left quiet.
```

### M4-2 돌아본 복도 (컷2) — 캡션 우상

```
[§0 블록]
PANEL: Reverse shot — looking back down the corridor just walked. Three pale
translucent silhouettes stand at different depths, each smaller and fainter
with distance, each frozen in its own working pose. Between them, pools of
tube light alternate with darkness. The nearest one is three steps away.
COMPOSE FOR 3:2. Upper-right quiet.
```

---

## 3. 엔딩 3컷 (신규 — 현행 텍스트 화면 위에 1컷씩 얹는 제안)

현행 엔딩은 인쇄체 텍스트 화면이다. 각 분기에 만화 1컷을 배경으로 깔면(텍스트는 기존
그대로 위에) 3분기가 시각적으로도 갈린다. 채택 시 구현 지시는 별도로 작성한다.

### E-1 TOGETHER (DEBT 0) — 넷이서, 처음의 빛이 아닌 빛

```
[§0 블록]
PANEL: Exterior, the only outdoor image in the whole game. Four figures walk
away from us up a shallow concrete ramp, side by side, not in file — their
spacing slightly irregular, human. Ahead of them the darkness thins: the top
third of the panel is a faint grey gradient of pre-dawn, rendered in sparse
halftone — no sun, no sky detail, just dark becoming less dark. The facility
door behind them is already out of frame. COMPOSE FOR 8:5. Bottom band quiet
for the existing ending text.
```

### E-2 LEFT_BEHIND (DEBT 1~2) — 닫힌 문 이쪽

```
[§0 블록]
PANEL: Inside the facility, facing the outer door which has just CLOSED —
a thin line of light dying along its seam. The corridor in front of it is
empty. In the dark middle distance, the faint suggestion of shapes standing
very still — barely more than tone, deniable. One tube flickers.
COMPOSE FOR 8:5. Bottom band quiet.
```

### E-3 YIELD (DEBT 3+) — 다음 배치가 깨어난다 (인트로 컷1의 재현)

```
[§0 블록]
PANEL: Recreate the intro's first panel almost exactly — extreme low angle
looking up at a concrete ceiling, one fluorescent tube mid-flicker — but
framed a touch tighter and darker than before, and this time TWO faint water
stains instead of one: time has passed, the room has been used again.
Someone is waking up under this ceiling. It is not the same someone.
COMPOSE FOR 8:5. Bottom band quiet.
```

이 컷이 STORY-SURFACES §8-2(YIELD 후 인트로 회귀 미구현)의 대체 해법이기도 하다 —
실제로 인트로로 되돌아가는 대신, **인트로의 첫 그림이 엔딩에 돌아온다.**

---

## 4. 진행 순서

1. 기준작(C1-05) 옆에 두고 비교하며 인트로 7컷부터 생성 (I-2·I-6·I-7은 "그리지 않을
   것" 지시가 핵심 — 금·인과선·글자가 그려져 있으면 즉시 반려)
2. 통과분을 `assets/generated/source/`에 `INTRO-01`~`INTRO-07`, `M1-1`~`M4-2`,
   `END-1`~`END-3` 이름으로 저장
3. 엔딩 3컷은 신규 제안이므로 팀 확인 후 구현 지시서 작성 (기존 인트로·막간은 코드
   연출과의 합성 방식을 개발 팀원과 협의 — 이미지 배경 + 코드 오버레이가 원칙)
