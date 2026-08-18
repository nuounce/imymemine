import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceIntro,
  createIntro,
  CUT_COUNT,
  CUT_TICKS,
  tickIntro,
} from '../src/render/intro';

describe('인트로: 읽을 때까지 기다리고 입력으로 다음 칸을 넘긴다', () => {
  it('현재 칸의 연출이 끝나면 자동으로 다음 칸으로 넘어가지 않는다', () => {
    const intro = createIntro();

    for (let i = 0; i < CUT_TICKS * 3; i++) tickIntro(intro);

    assert.equal(intro.tick, CUT_TICKS - 1);
    assert.equal(intro.done, false);
  });

  it('진행 입력 한 번이 정확히 다음 칸의 시작으로 옮긴다', () => {
    const intro = createIntro();
    for (let i = 0; i < CUT_TICKS; i++) tickIntro(intro);

    advanceIntro(intro);

    assert.equal(intro.tick, CUT_TICKS);
    assert.equal(intro.done, false);
  });

  it('마지막 칸까지는 끝나지 않고 마지막 입력에서만 완료된다', () => {
    const intro = createIntro();

    for (let cut = 1; cut < CUT_COUNT; cut++) {
      advanceIntro(intro);
      assert.equal(intro.tick, cut * CUT_TICKS);
      assert.equal(intro.done, false);
    }

    advanceIntro(intro);
    assert.equal(intro.done, true);
  });
});
