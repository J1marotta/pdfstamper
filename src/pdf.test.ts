import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StampSettings } from './types';

class MockDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
}

if (!('DOMMatrix' in globalThis)) {
  Object.assign(globalThis, {
    DOMMatrix: MockDOMMatrix,
  });
}

function makeStamp(overrides: Partial<StampSettings> = {}): StampSettings {
  return {
    mode: 'text',
    payee: 'Acme Pty Ltd',
    totalAmount: '$100.00',
    gstAmount: '$9.09',
    movementNumber: 'MOVE-42',
    signedBy: 'Taylor Smith',
    coSignedBy: 'Jordan Smith',
    approvedBy1: 'Approver One',
    approvedBy2: 'Approver Two',
    date: '2026-05-20',
    placement: 'last-page',
    alignment: 'right',
    flatten: false,
    imageBytes: null,
    imageMime: null,
    imageName: null,
    ...overrides,
  };
}

describe('exportFilledPdf', () => {
  it('returns a valid PDF blob header', async () => {
    const { exportFilledPdf } = await import('./pdf');
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = new Uint8Array(await source.save());

    const blob = await exportFilledPdf(sourceBytes, [], makeStamp());
    const header = await blob.slice(0, 8).text();

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    expect(header).toContain('%PDF-');
  });
});

describe('downloadBlob', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a downloadable anchor and cleans it up later', async () => {
    const { downloadBlob } = await import('./pdf');
    const appendSpy = vi.spyOn(document.body, 'append');
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadBlob(new Blob(['hello'], { type: 'application/pdf' }), 'example.pdf');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const anchor = appendSpy.mock.calls[0]?.[0];
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    expect((anchor as HTMLAnchorElement).download).toBe('example.pdf');

    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
