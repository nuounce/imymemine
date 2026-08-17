/**
 * 고정 틱 accumulator 루프.
 *
 * 이 게임의 잔상은 "저장된 궤적"이 아니라 "저장된 입력 테이프"다(SPEC §1).
 * 테이프를 다시 먹여 오차 0으로 재현하려면 시뮬이 **프레임레이트와 무관하게**
 * 정확히 TICK_HZ 로만 전진해야 한다. 그래서 렌더 프레임과 틱을 분리한다.
 */
import { MAX_STEPS_PER_FRAME, TICK_MS } from '../sim/constants';

/**
 * 고정 틱 루프를 시작한다.
 *
 * @param onTick   1틱(1/60초) 전진. 프레임당 0~MAX_STEPS_PER_FRAME 회 호출된다.
 * @param onRender 프레임당 정확히 1회. `alpha` 는 다음 틱까지의 진행도 0..1.
 * @returns 루프를 멈추는 함수.
 */
export function startLoop(
  onTick: () => void,
  onRender: (alpha: number) => void,
): () => void {
  /** 아직 소비되지 않은 실제 경과 시간(ms). 틱 미만의 잔여분은 다음 프레임으로 이월된다. */
  let accumulator = 0;
  let last = performance.now();
  let handle = 0;
  let running = true;

  /**
   * 한 프레임이 감당할 수 있는 최대 시뮬 시간.
   * 탭 백그라운드 복귀처럼 dt 가 폭발하는 순간에 여기서 잘라내지 않으면
   * 프레임마다 MAX_STEPS_PER_FRAME 만 소화하면서 accumulator 가 영원히 자란다
   * (spiral of death). 잘린 시간은 버린다 — 시뮬 시간이 벽시계보다 느려질 뿐,
   * 틱 순서와 결정론은 그대로다.
   */
  const MAX_FRAME_MS = TICK_MS * MAX_STEPS_PER_FRAME;

  const frame = (now: number): void => {
    if (!running) return;
    handle = requestAnimationFrame(frame);

    let dt = now - last;
    last = now;
    if (dt < 0) dt = 0;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

    accumulator += dt;

    let steps = 0;
    while (accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      onTick();
      accumulator -= TICK_MS;
      steps++;
    }

    onRender(accumulator / TICK_MS);
  };

  handle = requestAnimationFrame(frame);

  return (): void => {
    running = false;
    cancelAnimationFrame(handle);
  };
}
