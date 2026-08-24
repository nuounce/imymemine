# 만화 페이지 생성 프롬프트 v2 — 대사 포함 페이지 단위

> **이 문서의 용도**: 만화 페이지 10장(인트로 3 · 막간 4 · 엔딩 3)의 GPT 이미지 생성
> 프롬프트. 장면·대사의 정본은 [`COMIC-SCRIPT.md`](./COMIC-SCRIPT.md)이고, 이 문서는
> 그것을 생성 프롬프트로 옮긴 것이다.
>
> **v1 대비 방식 전환**: v1은 "컷 낱장 + 글자는 코드 오버레이"였다. 팀이 실제로 돌린
> 결과(`comic-comment-gpt-image-2/`) **대사를 말풍선째 이미지에 굽는 페이지 단위 생성의
> 한글 렌더링 품질이 충분히 좋았으므로**, v2는 그 검증된 방식을 따른다. 컷 배치·풍선까지
> 프롬프트가 지정한다. 대사는 아래 자구를 **한 글자도 바꾸지 말고** 넣는다
> (2026-08-24 확정본 — 검수 2회 통과, 화면 용어 `수율`→`회수` 결정 반영).
> 엔딩 3장만 예외로 **무자막**(게임이 엔딩 텍스트를 위에 얹는다).

---

## 0. 공통 스타일 블록 — 모든 페이지 프롬프트 맨 앞에 붙인다

```
STYLE (apply strictly):
Black-and-white manga page, WHITE INK ON DARK PAPER — paper is near-black
(#080a11), lines and light are pale ink (#e6ecff). Darkness is the default;
light is what gets drawn.
Halftone screentone dots for mid-tones (fine pitch, ~-24 degree screen angle),
heavy solid blacks, thin slightly wobbly hand-inked outlines, visible ink
texture. Panel borders: hand-ruled white rectangles with slight wobble, dark
gutters between panels.
FIGURES: faceless silhouettes — no eyes, no mouth, no facial features, ever.
A plain simple coat shape, no hoods, no patterns. Emotion via posture, light,
composition only.
WORLD: underground concrete facility — fluorescent tubes as the only light,
pipes, stains, drains. Administrative neglect. Never gore, never monsters.
BALLOONS AND TEXT: Korean dialogue rendered INSIDE the image.
- Speech balloon: white rounded balloon, hand-inked wobbly outline, with a
  tail pointing to the speaker (or to off-panel bottom if speaker unseen).
- Thought balloon: cloud-shaped, small trailing bubbles instead of a tail.
- Text: clean legible Korean, dark ink on the white balloon, comfortable
  padding, MAXIMUM 3 lines per balloon. Break lines at natural phrase points.
- Render the dialogue EXACTLY as given — no paraphrasing, no added
  punctuation, ellipsis is three periods (...).
Reference tone: the previously approved page set — this page must look like
the same artist drew it.
```

**반려 기준**: ① 한글 오탈자·획 뭉개짐·자간 붕괴 ② 대사 자구 불일치(한 글자라도)
③ 얼굴·이목구비 ④ 풍선 3줄 초과 ⑤ 컬러 유입 ⑥ 기존 통과 페이지와 다른 작가로 보임
⑦ 지정 안 된 글자(간판·낙서 등)가 멋대로 생김. 하나라도 걸리면 사유를 붙여 재생성.

**연속성 지시(모든 페이지 공통, 프롬프트 끝에 붙임)**:
```
CONTINUITY: same protagonist silhouette (build, coat length) as the approved
pages; tally marks on walls are always vertical strokes grouped in FOURS;
fluorescent tubes are always cold and slightly flickering.
```

**생성 크기**: 인트로·막간·엔딩 전부 1536×1024 가로. 게임 캔버스(960×600)에 맞춰
후처리 크롭.

---

## 1. INTRO-PAGE-1 (컷 1·2·3)

```
[§0 블록]
PAGE LAYOUT: three panels — one full-width panel on top (wide letterbox),
two panels side by side below.

PANEL 1 (top, wide): Extreme low angle looking straight up at a concrete
ceiling from the floor, as someone lying on their back would see it. One
fluorescent tube slightly off-center right, mid-flicker — half lit, hard pale
light, rest of ceiling falling to black. Hairline cracks, one water stain.
Speech balloon upper-left: "...천장이 왜 이래."
Thought balloon right side: "우리 집엔, 야광별 있었는데."

PANEL 2 (bottom-left): Extreme close-up of a raw concrete wall at waist
height, grazing light from the left showing grain and pores. Vertical tally
strokes scratched into the wall, grouped in fours, rows continuing past the
panel edge. Speech balloon top-left: "하나, 둘... 넷씩이네."
Thought balloon bottom-right: "이걸 누가 세고 있었던 거야."

PANEL 3 (bottom-right): Medium shot — a faceless figure, back half-turned,
before a heavy steel door flush in concrete. The door has hinges and seams
but NO handle; the smooth patch where a handle should be catches the most
light. Figure's shoulders slightly raised, one hand half-lifted.
Speech balloon top-left: "손잡이부터 없애 놨네."
Thought balloon bottom-right: "일부러네. 전부."
[CONTINUITY]
```

## 2. INTRO-PAGE-2 (컷 4·5·6)

```
[§0 블록]
PAGE LAYOUT: two panels side by side on top, one full-width panel below.

PANEL 1 (top-left): Extreme close-up of a reaching hand and forearm, palm
open. Behind it, two fainter copies of the same hand at slight offsets — an
afterimage burned into the dark, the ONLY self-luminous thing in this comic.
The glow bleeds slightly past the panel border into the gutter.
Small speech balloon: "어?"
Thought balloon below: "방금... 뭐가 남았지."

PANEL 2 (top-right): Two-shot — on the right the figure walks away
mid-stride with thin horizontal speed lines; on the left a translucent paler
copy of the SAME figure repeats an earlier gesture (reaching toward a wall),
edges slightly unstable. It looks at no one; it only repeats.
Speech balloon top: "안 사라져."
Thought balloon bottom-right: "아까 나잖아, 저거."

PANEL 3 (bottom, wide): Wide room. Far left a steel floor plate in its own
small pool of tube light; far right the sealed heavy door in another pool;
between them darkness and pipes — two islands of light impossibly far apart.
One tiny faceless figure stands in the middle facing the door.
Speech balloon left: "밟으면 열리고... 떼면 닫히고."
Thought balloon right: "둘이어야 되는 건데."
[CONTINUITY]
```

## 3. INTRO-PAGE-3 (컷 7 — 전면)

```
[§0 블록]
PAGE LAYOUT: single full-bleed panel.

Four faceless figures stand in a loose row facing us in front of a concrete
wall washed by one long fluorescent tube. Each holds a DIFFERENT pose:
standing straight / slumped with head dropped / arms folded / one hand half
raised. Same body, four attitudes. On the wall just above their heads, tally
marks in groups of four — one group above each figure. Floor catches four
faint pools of reflected light.
Speech balloon upper-center: "그럼 내가 남으면 되지."
A SECOND smaller speech balloon just below-right of it: "나, 넷이나 있잖아."
(the second balloon noticeably smaller — a beat later, almost a joke)
[CONTINUITY]
```

## 4. M1-PAGE 「문 바깥쪽」 (2컷)

```
[§0 블록]
PAGE LAYOUT: one large panel on top, one smaller panel bottom-right with
extra dark gutter around it.

PANEL 1 (top): A faceless figure from behind, just past a doorway, turning
back to look at the door they came through. On THIS side the steel door has
a plain handle — the brightest light in the panel falls on the handle; the
figure stays dim. Speech balloon upper-right: "바깥쪽엔, 있네."

PANEL 2 (bottom-right): Close-up of a paper sheet taped to the concrete wall
at eye height, corner curling, flat tube light. On the paper, a small
HANDWRITTEN table: header row "배치 | 회수", then rows "04 | 3", "05 | 2",
"06 | 3" — shaky handwriting, pencil-line grid. Beside the sheet, an older
tape-shadow of a previous sheet.
Thought balloon bottom-right: "나오라고 열어 둔 거였어?"
[CONTINUITY]
```

## 5. M2-PAGE 「선반」 (2컷 · 컷1 무자막)

```
[§0 블록]
PAGE LAYOUT: one full-width panel on top, one panel bottom-right, generous
dark gutters.

PANEL 1 (top, wide, NO TEXT AT ALL): A wide low storage room. Rows of steel
shelving recede into darkness; each large cell holds ONE motionless faceless
silhouette in a different frozen pose — standing, crouched, reaching. One
tube light down the aisle. In the middle band, ONE cell is EMPTY — interior
slightly brighter, and on its edge a small printed paper tag reading "출고"
in clean machine type (the only printed text in the panel). The empty cell
should be the second thing the eye finds.

PANEL 2 (bottom-right): Closer, down one aisle. In the nearest cell a
silhouette frozen mid-gesture — one arm extended, weight on the left foot,
head slightly bowed. The viewer's own figure is NOT in frame.
Speech balloon upper-left: "저거, 아까 내가 한 자세잖아."
Thought balloon lower-right: "여기 다 모아 놨네. 내가 버리고 온 것들."
[CONTINUITY]
```

## 6. M3-PAGE 「셈」 (2컷)

```
[§0 블록]
PAGE LAYOUT: one large diagonal-feel panel on top, one tight close-up panel
bottom-center.

PANEL 1 (top): A concrete wall filling the frame at a slight diagonal,
receding right into darkness — the wall clearly continues beyond the panel.
Row upon row of tally strokes grouped in fours, dense, extending past every
edge. Grazing light. Faint hand-smudges at hand height.
Speech balloon upper-left: "넷씩... 이게 대체 몇이야."

PANEL 2 (bottom): Extreme close-up near the floor of the same wall. Below
the lowest tally group, a small stenciled serial number in clean machine
print: "0417-B-1177" — unmistakably machine-made against the hand-scratched
marks above it. A hairline crack passes nearby but avoids the stencil.
Thought balloon lower-right: "내가 센 게 아니었구나. 세어진 거였고."
[CONTINUITY]
```

## 7. M4-PAGE 「마지막 문」 (2컷)

```
[§0 블록]
PAGE LAYOUT: one tall vertical panel on the left, one wide panel on the
right, asymmetric.

PANEL 1 (left, tall): The final door — double-height steel, heavier than any
other — looming over a small faceless figure standing before it, back to us,
arms at their sides. One tube directly above makes a tight pool; the door's
top vanishes into darkness above the light.
Speech balloon lower-left: "여기서 나가면 끝이야."

PANEL 2 (right, wide): Reverse shot down the corridor just walked. Three
pale translucent silhouettes at different depths, each smaller and fainter
with distance, each frozen in its own working pose. Pools of tube light
alternate with darkness. The nearest one is three steps away.
Thought balloon upper-right: "...전부 데리고 나갈 수는 없나."
[CONTINUITY]
```

## 8. END-1 「TOGETHER」 (전면 1컷 · 무자막)

```
[§0 블록]
SINGLE full-bleed panel, NO TEXT (the game overlays its ending text in the
bottom band — keep the bottom fifth visually quiet).
Exterior — the only outdoor image in the whole game. Four figures walk away
from us up a shallow concrete ramp, side by side but with slightly irregular
human spacing, not a formation. Ahead, the darkness thins: the top third is
a faint grey pre-dawn gradient in sparse halftone — no sun, no sky detail,
just dark becoming less dark. The facility door is already out of frame.
[CONTINUITY]
```

## 9. END-2 「LEFT_BEHIND」 (전면 1컷 · 무자막)

```
[§0 블록]
SINGLE full-bleed panel, NO TEXT, bottom fifth quiet.
Inside the facility, facing the outer door which has just CLOSED — a thin
line of light dying along its seam. The corridor before it is empty. In the
dark middle distance, the faintest suggestion of shapes standing very still —
barely more than screentone, deniable. One tube flickers.
[CONTINUITY]
```

## 10. END-3 「YIELD」 (전면 1컷 · 무자막)

```
[§0 블록]
SINGLE full-bleed panel, NO TEXT, bottom fifth quiet.
Recreate INTRO-PAGE-1's first panel almost exactly — extreme low angle,
concrete ceiling, one fluorescent tube mid-flicker — but framed slightly
tighter and darker, and with TWO water stains instead of one. Time has
passed; the room has been used again. Someone is waking under this ceiling.
It is not the same someone.
[CONTINUITY]
```

---

## 사용 순서

1. ChatGPT(구독)에서 §0 + 페이지 프롬프트를 한 대화에 넣고 순서대로 생성 — 같은
   대화를 유지해야 화풍이 이어진다. 기존 통과 페이지 1~2장을 대화에 첨부해 "이
   작가의 다음 페이지"로 요청하면 연속성이 더 좋다.
2. 반려 기준 7개로 검수 — 특히 **대사 자구**(이 문서가 아니라 COMIC-SCRIPT 자구와
   대조)와 한글 렌더링.
3. 통과분을 `assets/generated/source/`에 같은 이름(INTRO-PAGE-1 …)으로 교체 저장.
4. 인게임 문자열 동기화는 COMIC-SCRIPT 체크리스트를 따른다 — 이미지와 게임이 다른
   문장이면 안 된다.
