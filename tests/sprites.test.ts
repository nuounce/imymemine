/**
 * 스프라이트 에셋 검증.
 *
 * 그림은 눈으로 봐야 알지만, **눈으로 봐도 모르는 것**이 몇 가지 있다.
 *   - 경로 오타: 브라우저에서 조용한 404 로 끝나 그 시트만 안 뜬다. 코드 드로잉
 *     폴백이 자리를 메우므로 화면은 멀쩡해 보이고, 아무도 눈치채지 못한다.
 *   - 시트 규격 착오: 8열짜리를 4열로 적으면 절반만 쓰거나 옆 칸이 새어 나온다.
 *   - 방향 매핑: HOUND 가 사람처럼 걷거나, 오른쪽으로 가는데 왼쪽을 보는 문제.
 *
 * 셋 다 자동으로 잡는다. DOM 이 없는 node 에서 도는 검사라 **그리기는 건드리지
 * 않고** 매니페스트와 순수 함수만 본다.
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { DIR_STEPS } from '../src/sim/constants';
import { assetUrls, rowOfFacing, sheetIds, sheetSpec, walkFrame } from '../src/render/sprites';

/** PNG 헤더에서 크기만 읽는다 (IHDR 은 항상 첫 청크다). */
function pngSize(path: string): { w: number; h: number } {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n', `${path} 이 PNG 가 아니다`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ── 1. 경로 누락 탐지 ──────────────────────────────────────────────────────

describe('스프라이트 — 에셋 경로', () => {
  it('매니페스트의 모든 파일이 실제로 존재한다', () => {
    const missing: string[] = [];
    for (const { id, url } of assetUrls()) {
      const p = fileURLToPath(url);
      if (!existsSync(p)) missing.push(`${id} → ${p}`);
    }
    assert.deepEqual(missing, [], `없는 에셋:\n  ${missing.join('\n  ')}`);
  });

  it('런타임은 최종 폴더(a/b/c-group)만 참조한다', () => {
    // source/·comic/·process_*.py 는 작업 원본이라 게임에 실려서는 안 된다.
    for (const { id, url } of assetUrls()) {
      assert.ok(
        /\/(a-group|b-group|c-group)\//.test(url),
        `${id} 가 최종 폴더 밖을 가리킨다: ${url}`,
      );
      assert.ok(!/\/source\/|\/comic/.test(url), `${id} 가 작업 원본을 가리킨다: ${url}`);
    }
  });
});

// ── 2. 시트 규격이 실제 PNG 와 맞는가 ──────────────────────────────────────

describe('스프라이트 — 시트 규격', () => {
  it('선언한 열×행×셀 크기가 실제 이미지 크기와 정확히 일치한다', () => {
    const urls = new Map(assetUrls().map((a) => [a.id, a.url]));
    for (const id of sheetIds()) {
      const spec = sheetSpec(id);
      const { w, h } = pngSize(fileURLToPath(urls.get(id)!));
      assert.equal(w, spec.cols * spec.cw, `${id} 가로: ${w} ≠ ${spec.cols}×${spec.cw}`);
      assert.equal(h, spec.rows * spec.ch, `${id} 세로: ${h} ≠ ${spec.rows}×${spec.ch}`);
    }
  });

  it('모든 셀이 짝수 크기다 — 절반으로 구울 때 반 픽셀이 남으면 안 된다', () => {
    for (const id of sheetIds()) {
      const { cw, ch } = sheetSpec(id);
      assert.equal(cw % 2, 0, `${id} 셀 가로 ${cw} 가 홀수다`);
      assert.equal(ch % 2, 0, `${id} 셀 세로 ${ch} 가 홀수다`);
    }
  });
});

// ── 3. 방향 → 행 매핑 ──────────────────────────────────────────────────────

describe('스프라이트 — 방향별 행 선택', () => {
  // 시트 행 순서: 0 아래 · 1 왼쪽 · 2 오른쪽 · 3 위 (DESIGN-PROMPTS B1)
  it('네 정방향이 각각 제 행을 고른다', () => {
    assert.equal(rowOfFacing(0), 2, '+X(오른쪽)');
    assert.equal(rowOfFacing(DIR_STEPS / 4), 0, '+Y(아래)');
    assert.equal(rowOfFacing(DIR_STEPS / 2), 1, '−X(왼쪽)');
    assert.equal(rowOfFacing((DIR_STEPS * 3) / 4), 3, '−Y(위)');
  });

  it('facing 전 범위가 0~3 행 안에만 떨어진다', () => {
    for (let f = 0; f < DIR_STEPS; f++) {
      const r = rowOfFacing(f);
      assert.ok(r >= 0 && r <= 3, `facing ${f} → 행 ${r}`);
    }
  });

  it('음수와 한 바퀴 넘는 값도 같은 행으로 돌아온다', () => {
    for (let f = 0; f < DIR_STEPS; f++) {
      assert.equal(rowOfFacing(f - DIR_STEPS), rowOfFacing(f), `${f} 와 ${f - DIR_STEPS}`);
      assert.equal(rowOfFacing(f + DIR_STEPS * 3), rowOfFacing(f), `${f} 와 ${f + DIR_STEPS * 3}`);
    }
  });

  it('네 행이 모두 쓰인다 — 한 방향도 빠지지 않는다', () => {
    const seen = new Set<number>();
    for (let f = 0; f < DIR_STEPS; f++) seen.add(rowOfFacing(f));
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
  });
});

// ── 4. 보행 프레임이 범위를 넘지 않는가 ────────────────────────────────────

describe('스프라이트 — 보행 프레임', () => {
  it('멈춰 있으면 대표 정지 프레임에 고정된다', () => {
    for (const d of [0, 1000, 999999]) {
      assert.equal(walkFrame(d, false), 0, `거리 ${d}`);
    }
  });

  it('아무리 멀리 걸어도 프레임이 시트 밖으로 나가지 않는다', () => {
    for (let d = 0; d < 200000; d += 137) {
      const f = walkFrame(d, true, 8);
      assert.ok(f >= 0 && f < 8, `거리 ${d} → 프레임 ${f}`);
      assert.equal(Number.isInteger(f), true, `거리 ${d} 프레임이 정수가 아니다`);
    }
  });

  it('음수 거리에서도 프레임이 음수로 내려가지 않는다', () => {
    assert.ok(walkFrame(-5000, true, 8) >= 0);
  });

  it('한 타일을 걸으면 사이클이 정확히 한 바퀴 돈다', () => {
    // 걷기 512/틱 · 한 타일 8192 = 16틱. 8프레임이면 1024 마다 한 칸이다.
    const seen: number[] = [];
    for (let d = 0; d < 8192; d += 1024) seen.push(walkFrame(d, true, 8));
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(walkFrame(8192, true, 8), 0, '한 타일 뒤 처음으로 돌아와야 한다');
  });
});
