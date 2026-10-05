/**
 * 先読み式のステップ・クロック。
 *
 * ブラウザのタイマーは数十ms〜1秒単位でぶれる（非表示タブでは1秒に制限される）ため、
 * 音は「いま鳴らす」のではなく、オーディオの時計に対して少し先の時刻へ予約する。
 * tick() のたびに、先読み時間内に入った16分音符を順番に onStep へ渡す。
 */
export class StepClock {
  private nextStepTime = 0;
  private stepIndex = 0;
  private started = false;

  constructor(
    private readonly options: {
      stepSeconds: number;
      /** この秒数だけ先の音まで予約する。タイマーの最大遅延より長くすること */
      lookaheadSeconds: number;
      /** オーディオ時計の現在時刻（秒） */
      now: () => number;
      /** 通し番号 stepIndex（曲の頭が0）の音を time に鳴らす */
      onStep: (stepIndex: number, time: number) => void;
      /** 開始から最初の音までの余裕（秒） */
      startDelaySeconds?: number;
    },
  ) {}

  /** 最初から数え直す。 */
  reset() {
    this.started = false;
    this.stepIndex = 0;
    this.nextStepTime = 0;
  }

  tick() {
    const { stepSeconds, lookaheadSeconds, now, onStep } = this.options;
    const current = now();

    if (!this.started) {
      this.nextStepTime = current + (this.options.startDelaySeconds ?? 0.06);
      this.started = true;
    } else if (this.nextStepTime < current) {
      // タイマーが長く止まっていた。遅れを取り戻そうと連打せず、いまから再開する。
      const missed = Math.ceil((current - this.nextStepTime) / stepSeconds);
      this.stepIndex += missed;
      this.nextStepTime += missed * stepSeconds;
    }

    while (this.nextStepTime < current + lookaheadSeconds) {
      onStep(this.stepIndex, this.nextStepTime);
      this.stepIndex += 1;
      this.nextStepTime += stepSeconds;
    }
  }
}
