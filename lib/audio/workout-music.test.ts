import { describe, expect, it, vi } from "vitest";

import { StepClock } from "./step-clock";
import {
  barDurationSeconds,
  loopDurationSeconds,
  midiToFrequency,
  songBarEvents,
  stepDurationSeconds,
  STEPS_PER_BAR,
  WORKOUT_SONGS,
  type StepEvent,
} from "./workout-music";

const drumSteps = (events: StepEvent[], hit: string) =>
  events.flatMap((event) => (event.type === "drum" && event.hit === hit ? [event.step] : []));

describe("workout songs", () => {
  it("offers distinct, well-formed songs", () => {
    expect(WORKOUT_SONGS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(WORKOUT_SONGS.map((song) => song.id)).size).toBe(WORKOUT_SONGS.length);
    expect(new Set(WORKOUT_SONGS.map((song) => song.title)).size).toBe(WORKOUT_SONGS.length);

    for (const song of WORKOUT_SONGS) {
      expect(song.title.length).toBeGreaterThan(0);
      expect(song.description.length).toBeGreaterThan(0);
      expect(song.bpm).toBeGreaterThanOrEqual(100);
      expect(song.bpm).toBeLessThanOrEqual(160);
      expect(song.progression.length).toBe(4);
    }
  });

});

describe("timing", () => {
  it("derives step and bar length from the tempo", () => {
    const song = { bpm: 120 };
    expect(stepDurationSeconds(song)).toBeCloseTo(0.125, 6);
    expect(barDurationSeconds(song)).toBeCloseTo(2, 6);
  });

  it("makes an eight-bar loop of a sensible length", () => {
    for (const song of WORKOUT_SONGS) {
      const seconds = loopDurationSeconds(song);
      expect(seconds).toBeGreaterThan(10);
      expect(seconds).toBeLessThan(25);
    }
  });

  it("converts MIDI notes to frequencies", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(57)).toBeCloseTo(220, 6);
    expect(midiToFrequency(45)).toBeCloseTo(110, 6);
  });
});

describe("songBarEvents", () => {
  it("is deterministic", () => {
    for (const song of WORKOUT_SONGS) {
      for (let bar = 0; bar < 16; bar += 1) {
        expect(songBarEvents(song, bar)).toEqual(songBarEvents(song, bar));
      }
    }
  });

  it("repeats every 8 bars so the loop never drifts", () => {
    for (const song of WORKOUT_SONGS) {
      for (let bar = 0; bar < 8; bar += 1) {
        expect(songBarEvents(song, bar)).toEqual(songBarEvents(song, bar + 8));
        expect(songBarEvents(song, bar)).toEqual(songBarEvents(song, bar + 160));
      }
    }
  });

  it("keeps every event inside the bar with sane values", () => {
    for (const song of WORKOUT_SONGS) {
      for (let bar = 0; bar < 8; bar += 1) {
        for (const event of songBarEvents(song, bar)) {
          expect(Number.isInteger(event.step)).toBe(true);
          expect(event.step).toBeGreaterThanOrEqual(0);
          expect(event.step).toBeLessThan(STEPS_PER_BAR);
          expect(event.gain).toBeGreaterThan(0);
          expect(event.gain).toBeLessThanOrEqual(1);
          if (event.type === "bass" || event.type === "chord" || event.type === "arp") {
            expect(event.length).toBeGreaterThanOrEqual(1);
          }
          if (event.type === "bass") {
            expect(event.midi).toBeGreaterThanOrEqual(24);
            expect(event.midi).toBeLessThanOrEqual(64);
          }
          if (event.type === "arp") {
            expect(event.midi).toBeGreaterThanOrEqual(48);
            expect(event.midi).toBeLessThanOrEqual(110);
          }
        }
      }
    }
  });

  it("returns the events in step order", () => {
    for (const song of WORKOUT_SONGS) {
      const steps = songBarEvents(song, 3).map((event) => event.step);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    }
  });

  it("gives every song a kick on the first beat of every bar", () => {
    for (const song of WORKOUT_SONGS) {
      for (let bar = 0; bar < 8; bar += 1) {
        expect(drumSteps(songBarEvents(song, bar), "kick")).toContain(0);
      }
    }
  });

  it("puts four-on-the-floor kicks in the house and drive songs", () => {
    for (const id of ["breakthrough", "last-spurt"]) {
      const song = WORKOUT_SONGS.find((candidate) => candidate.id === id)!;
      expect(drumSteps(songBarEvents(song, 0), "kick")).toEqual([0, 4, 8, 12]);
    }
  });

  it("puts a backbeat on the second and fourth beat", () => {
    const house = WORKOUT_SONGS.find((song) => song.id === "breakthrough")!;
    expect(drumSteps(songBarEvents(house, 0), "clap")).toEqual([4, 12]);
    const heavy = WORKOUT_SONGS.find((song) => song.id === "power-up")!;
    expect(drumSteps(songBarEvents(heavy, 0), "snare")).toEqual([4, 12]);
  });

  it("changes the bass root with the chord progression", () => {
    const song = WORKOUT_SONGS.find((candidate) => candidate.id === "breakthrough")!;
    const roots = [0, 1, 2, 3].map((bar) => {
      const bass = songBarEvents(song, bar).find((event) => event.type === "bass");
      return bass && bass.type === "bass" ? bass.midi : null;
    });

    // Am, F, C, G on A2 = 45
    expect(roots).toEqual([45, 53, 48, 55]);
  });

  it("builds up: the second half of the phrase is busier than the first", () => {
    for (const song of WORKOUT_SONGS) {
      const first = songBarEvents(song, 1).length;
      const second = songBarEvents(song, 5).length;
      expect(second, song.id).toBeGreaterThanOrEqual(first);
    }
    const house = WORKOUT_SONGS.find((song) => song.id === "breakthrough")!;
    expect(songBarEvents(house, 5).length).toBeGreaterThan(songBarEvents(house, 1).length);
  });

  it("adds a snare fill on the last bar of each phrase", () => {
    for (const song of WORKOUT_SONGS) {
      const fill = drumSteps(songBarEvents(song, 7), "snare");
      for (const step of [12, 13, 14, 15]) {
        expect(fill, song.id).toContain(step);
      }
      expect(drumSteps(songBarEvents(song, 6), "snare")).not.toContain(15);
    }
  });
});

describe("StepClock", () => {
  function makeClock(startTime = 10) {
    let current = startTime;
    const onStep = vi.fn();
    const clock = new StepClock({
      stepSeconds: 0.125,
      lookaheadSeconds: 1,
      now: () => current,
      onStep,
      startDelaySeconds: 0.05,
    });

    return {
      clock,
      onStep,
      advance: (seconds: number) => { current += seconds; },
    };
  }

  it("schedules a lookahead window of steps starting just after now", () => {
    const { clock, onStep } = makeClock();
    clock.tick();

    expect(onStep).toHaveBeenCalledTimes(8);
    expect(onStep.mock.calls[0][0]).toBe(0);
    expect(onStep.mock.calls[0][1]).toBeCloseTo(10.05, 9);
    expect(onStep.mock.calls[7][1]).toBeCloseTo(10.05 + 7 * 0.125, 9);
  });

  it("does not schedule a step twice and keeps the grid steady", () => {
    const { clock, onStep, advance } = makeClock();
    clock.tick();
    clock.tick();
    expect(onStep).toHaveBeenCalledTimes(8);

    advance(0.5);
    clock.tick();
    const steps = onStep.mock.calls.map(([index]) => index);
    expect(steps).toEqual([...Array(steps.length).keys()]);
    const times = onStep.mock.calls.map(([, time]) => time);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index] - times[index - 1]).toBeCloseTo(0.125, 9);
    }
  });

  it("skips ahead instead of replaying a burst after a long pause", () => {
    const { clock, onStep, advance } = makeClock();
    clock.tick();
    onStep.mockClear();

    advance(30);
    clock.tick();

    expect(onStep.mock.calls.length).toBeLessThanOrEqual(9);
    for (const [, time] of onStep.mock.calls) {
      expect(time).toBeGreaterThanOrEqual(40 - 0.125);
    }
  });

  it("starts again from the first step after reset", () => {
    const { clock, onStep, advance } = makeClock();
    clock.tick();
    clock.reset();
    advance(5);
    onStep.mockClear();
    clock.tick();

    expect(onStep.mock.calls[0][0]).toBe(0);
    expect(onStep.mock.calls[0][1]).toBeCloseTo(15.05, 9);
  });
});
