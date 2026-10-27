import { describe, expect, it } from 'vitest';
import { DRAG_START_PX, clampToScreen, dragMode, tilt } from './drag';

describe('dragMode', () => {
  it('waits until the pointer has moved a little', () => {
    expect(dragMode(0, 0)).toBe('undecided');
    expect(dragMode(DRAG_START_PX - 2, 0)).toBe('undecided');
    expect(dragMode(3, -4)).toBe('undecided');
  });
  it('scrolls the hand on a clearly sideways move, both ways', () => {
    expect(dragMode(20, 2)).toBe('scroll');
    expect(dragMode(-20, -5)).toBe('scroll');
  });
  it('picks the card up for upward, downward and diagonal moves', () => {
    expect(dragMode(0, -20)).toBe('drag');
    expect(dragMode(4, 20)).toBe('drag');
    expect(dragMode(15, -15)).toBe('drag');
    expect(dragMode(20, -18)).toBe('drag'); // not clearly sideways
  });
});

describe('tilt', () => {
  it('leans with sideways movement and never more than 8 degrees', () => {
    expect(tilt(0)).toBe(0);
    expect(tilt(24)).toBe(2);
    expect(tilt(-24)).toBe(-2);
    expect(tilt(1000)).toBe(8);
    expect(tilt(-1000)).toBe(-8);
  });
});

describe('clampToScreen', () => {
  const box = { left: 100, top: 500, width: 100, height: 150 };
  it('leaves a move inside the window alone', () => {
    expect(clampToScreen(box, 30, -200, 400, 800)).toEqual({ dx: 30, dy: -200 });
  });
  it('keeps the card on screen on every side', () => {
    expect(clampToScreen(box, -500, -900, 400, 800)).toEqual({ dx: -100, dy: -500 });
    expect(clampToScreen(box, 500, 900, 400, 800)).toEqual({ dx: 200, dy: 150 });
  });
  it('copes with a window smaller than the card', () => {
    expect(clampToScreen(box, 10, 10, 50, 50)).toEqual({ dx: -100, dy: -500 });
  });
});
