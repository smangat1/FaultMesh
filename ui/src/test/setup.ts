// Test setup file for Vitest
import { vi, afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Pre-seed first-use tips seen-state so existing tests mounting screens do not unexpectedly show tip overlays
const seedTips = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        'faultmesh:first_use_tips:seen',
        JSON.stringify({ home: true, entrance: true, replay: true })
      );
    }
  } catch {
    // Ignore
  }
};

if (typeof Storage !== 'undefined') {
  const origClear = Storage.prototype.clear;
  Storage.prototype.clear = function (this: Storage) {
    origClear.call(this);
    seedTips();
  };
}

beforeEach(() => {
  seedTips();
});

// Automatically clean up DOM after each test
afterEach(() => {
  cleanup();
});

// Mock getBoundingClientRect for jsdom
if (typeof Element !== 'undefined') {
  Element.prototype.getBoundingClientRect = () => ({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
}

// Mock HTML5 Canvas for headless jsdom environment (Cytoscape requirement)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId: string) => {
    if (contextId === '2d') {
      return {
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        getImageData: vi.fn().mockReturnValue({ data: new Array(16) }),
        putImageData: vi.fn(),
        createImageData: vi.fn().mockReturnValue([]),
        setTransform: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        rotate: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 50 }),
        transform: vi.fn(),
        rect: vi.fn(),
        quadraticCurveTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        clip: vi.fn(),
        setLineDash: vi.fn(),
        getLineDash: vi.fn().mockReturnValue([]),
      };
    }
    return null;
  });
}

// Mock ResizeObserver for headless jsdom
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Polyfill PointerEvent for jsdom
if (typeof window !== 'undefined' && !(window as any).PointerEvent) {
  (window as any).PointerEvent = window.MouseEvent;
}
