import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfStampStudio } from './app';
import { buildStampRows } from './stamp';

type InternalStudio = {
  state: any;
  stampInteraction: any;
  suppressNextPreviewClick: boolean;
  renderControlState: () => void;
  renderStampControls: () => void;
  renderThumbnailRail: () => void;
  renderPreviewMeta: () => void;
  renderPreviewStamp: () => void;
  renderFieldList: () => void;
  renderFillStats: () => void;
  renderAdvancedSheetVisibility: () => void;
  renderStatus: () => void;
  reapplyProfile: (options?: any) => void;
};

function setupStudio(): { studio: PdfStampStudio; internal: InternalStudio; root: HTMLElement } {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const studio = new PdfStampStudio(root);
  const internal = studio as unknown as InternalStudio;
  return { studio, internal, root };
}

function stubCanvasRect(width = 600, height = 800): HTMLCanvasElement {
  const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement;
  previewCanvas.hidden = false;
  previewCanvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return previewCanvas;
}

function stubStampBodySize(width: number, height: number): HTMLElement {
  const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement;
  Object.defineProperty(stampBody, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(stampBody, 'offsetHeight', { configurable: true, value: height });
  return stampBody;
}

function singlePageState(internal: InternalStudio, placementOverrides: any = {}) {
  internal.state.bundle = { fileName: 'resume.pdf', pageCount: 1 };
  internal.state.pages = [
    { id: 'pdf-1', kind: 'pdf', pageNumber: 1, width: 595, height: 842, label: 'Page 1' },
  ];
  internal.state.previewPageId = 'pdf-1';
  internal.state.stampSelected = true;
  internal.state.stamp = {
    ...internal.state.stamp,
    placement: {
      pageId: 'pdf-1',
      x: 0.5,
      y: 0.5,
      width: 300,
      rotation: 0,
      ...placementOverrides,
    },
  };
  internal.renderControlState();
  internal.renderPreviewMeta();
  internal.renderPreviewStamp();
}

describe('regression: recently-fixed behaviors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('includes a date row and shows an editable date input in the selected preview', () => {
    const { internal } = setupStudio();
    const rows = buildStampRows(internal.state.stamp);
    expect(rows.map((row) => row.key)).toContain('date');

    singlePageState(internal, { y: 0.7 });
    stubCanvasRect();

    const dateInput = document.querySelector(
      '#preview-stamp input[data-stamp-key="date"]',
    ) as HTMLInputElement | null;
    expect(dateInput).not.toBeNull();
    expect(dateInput?.tagName.toLowerCase()).toBe('input');
  });

  it('click-to-place preserves rotation and explicit height and moves the rail flag', () => {
    const { internal } = setupStudio();
    internal.state.bundle = { fileName: 'resume.pdf', pageCount: 2 };
    internal.state.pages = [
      { id: 'pdf-1', kind: 'pdf', pageNumber: 1, width: 595, height: 842, label: 'Page 1' },
      { id: 'pdf-2', kind: 'pdf', pageNumber: 2, width: 595, height: 842, label: 'Page 2' },
    ];
    internal.state.previewPageId = 'pdf-2';
    internal.state.stampSelected = true;
    internal.state.stamp = {
      ...internal.state.stamp,
      placement: { pageId: 'pdf-1', x: 0.2, y: 0.2, width: 260, height: 120, rotation: 45 },
    };
    internal.renderControlState();
    internal.renderThumbnailRail();
    internal.renderPreviewMeta();
    internal.renderPreviewStamp();
    stubCanvasRect();

    const previewFrame = document.querySelector('#preview-frame') as HTMLElement;
    previewFrame.dispatchEvent(
      Object.assign(new Event('click', { bubbles: true, cancelable: true }), {
        clientX: 300,
        clientY: 400,
      }),
    );

    expect(internal.state.stamp.placement.pageId).toBe('pdf-2');
    expect(internal.state.stamp.placement.rotation).toBe(45);
    expect(internal.state.stamp.placement.height).toBe(120);
    expect(internal.state.stamp.placement.width).toBe(260);

    const activeThumb = document.querySelector('[data-page-id="pdf-2"] .thumb-stamp-flag');
    const staleThumb = document.querySelector('[data-page-id="pdf-1"] .thumb-stamp-flag');
    expect(activeThumb).not.toBeNull();
    expect(staleThumb).toBeNull();
  });

  it('keeps auto height undefined on E/W resize and keeps width on N/S resize', () => {
    const { internal } = setupStudio();
    // E/W resize with auto height.
    singlePageState(internal, { height: undefined });
    stubCanvasRect();
    stubStampBodySize(302.5, 152);

    const eastHandle = document.querySelector('.stamp-handle.is-e') as HTMLElement;
    eastHandle.dispatchEvent(
      Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
        clientX: 451.25,
        clientY: 400,
      }),
    );
    window.dispatchEvent(
      Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
        clientX: 526.25,
        clientY: 520,
      }),
    );

    expect(internal.state.stamp.placement.width).toBeGreaterThan(300);
    expect(internal.state.stamp.placement.height).toBeUndefined();
    window.dispatchEvent(new Event('pointerup'));

    // N/S resize keeps the original width.
    internal.state.stamp = {
      ...internal.state.stamp,
      placement: { pageId: 'pdf-1', x: 0.5, y: 0.5, width: 300, height: 160, rotation: 0 },
    };
    internal.renderPreviewStamp();
    stubStampBodySize(302.5, 152);

    const southHandle = document.querySelector('.stamp-handle.is-s') as HTMLElement;
    southHandle.dispatchEvent(
      Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
        clientX: 300,
        clientY: 476,
      }),
    );
    window.dispatchEvent(
      Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
        clientX: 420,
        clientY: 552,
      }),
    );

    expect(internal.state.stamp.placement.width).toBeCloseTo(300, 5);
    expect(internal.state.stamp.placement.height).toBeGreaterThan(160);
    window.dispatchEvent(new Event('pointerup'));
  });

  it('click-suppression after drag is transient', async () => {
    const { internal } = setupStudio();
    singlePageState(internal, { x: 0.5, y: 0.5 });
    stubCanvasRect();
    stubStampBodySize(300, 180);

    const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement;
    stampBody.dispatchEvent(
      Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
        clientX: 300,
        clientY: 400,
      }),
    );
    expect(internal.stampInteraction?.kind).toBe('drag');

    window.dispatchEvent(new Event('pointerup'));
    expect(internal.suppressNextPreviewClick).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(internal.suppressNextPreviewClick).toBe(false);

    const before = { ...internal.state.stamp.placement };
    const previewFrame = document.querySelector('#preview-frame') as HTMLElement;
    previewFrame.dispatchEvent(
      Object.assign(new Event('click', { bubbles: true, cancelable: true }), {
        clientX: 100,
        clientY: 100,
      }),
    );

    expect(internal.state.stamp.placement.pageId).toBe('pdf-1');
    expect(
      internal.state.stamp.placement.x !== before.x || internal.state.stamp.placement.y !== before.y,
    ).toBe(true);
  });

  it('Escape closes the advanced sheet', () => {
    const { internal } = setupStudio();
    internal.state.bundle = { fileName: 'resume.pdf', pageCount: 1 };
    internal.state.advancedOpen = true;
    internal.renderAdvancedSheetVisibility();

    const sheet = document.querySelector('#advanced-sheet') as HTMLElement;
    expect(sheet.hidden).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(internal.state.advancedOpen).toBe(false);
    expect(sheet.hidden).toBe(true);
  });

  it('clearing the stamp image in image mode falls back to text', () => {
    const { internal } = setupStudio();
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    internal.state.bundle = { fileName: 'resume.pdf', pageCount: 1 };
    internal.state.pages = [
      { id: 'pdf-1', kind: 'pdf', pageNumber: 1, width: 595, height: 842, label: 'Page 1' },
    ];
    internal.state.previewPageId = 'pdf-1';
    internal.state.stampImageUrl = 'blob:fake-image';
    internal.state.stamp = {
      ...internal.state.stamp,
      mode: 'image',
      imageName: 'seal.png',
      imageBytes: new Uint8Array([1, 2, 3]),
      imageMime: 'image/png',
    };
    internal.renderStampControls();
    internal.renderPreviewMeta();

    const clearButton = document.querySelector(
      '[data-action="clear-stamp-image"]',
    ) as HTMLButtonElement | null;
    expect(clearButton).not.toBeNull();
    clearButton!.click();

    expect(internal.state.stamp.mode).toBe('text');
    expect(internal.state.stampImageUrl).toBeNull();
    expect(internal.state.stamp.imageName).toBeNull();
  });

  it('escapes a hostile field id in data-field-id markup', () => {
    const { internal } = setupStudio();
    const evil = 'a" onmouseover="alert(1)';
    internal.state.bundle = { fileName: 'resume.pdf', pageCount: 1 };
    internal.state.fields = [
      {
        id: evil,
        name: evil,
        label: 'Evil',
        kind: 'text',
        semanticKey: null,
        value: '',
        originalValue: '',
        dirty: false,
        autoFilled: false,
        options: [],
        readOnly: false,
      },
    ];
    internal.renderFieldList();

    const controlHtml = (
      document.querySelector('#field-list .pdf-field-control') as HTMLElement
    ).innerHTML;
    expect(controlHtml).toContain('&quot;');
    expect(controlHtml).not.toContain('a" onmouseover="alert(1)');
    expect(document.querySelector('#field-list [onmouseover]')).toBeNull();
  });

  it('shows fill-stats placeholder pre-upload and counts after reapplyProfile', () => {
    const { internal } = setupStudio();
    expect((document.querySelector('#fill-stats') as HTMLElement).textContent).toContain(
      'Field stats appear here after parsing.',
    );

    internal.state.bundle = { fileName: 'resume.pdf', pageCount: 1 };
    internal.state.fields = [
      {
        id: '1',
        name: 'full_name',
        label: 'Full Name',
        kind: 'text',
        semanticKey: 'fullName',
        value: '',
        originalValue: '',
        dirty: false,
        autoFilled: false,
        options: [],
        readOnly: false,
      },
      {
        id: '2',
        name: 'email',
        label: 'Email',
        kind: 'text',
        semanticKey: 'email',
        value: '',
        originalValue: '',
        dirty: false,
        autoFilled: false,
        options: [],
        readOnly: false,
      },
    ];
    internal.state.profile = { fullName: 'Taylor Smith' };
    internal.state.overwriteExisting = false;
    internal.reapplyProfile();

    expect((document.querySelector('#fill-stats') as HTMLElement).textContent).toContain(
      '1 of 2 fields auto-filled · 1 need attention',
    );
  });

  it('inspector date edits update state and preview without replacing the input', () => {
    const { internal } = setupStudio();
    singlePageState(internal, { y: 0.7 });
    stubCanvasRect();
    internal.renderStampControls();

    const dateInput = document.querySelector(
      'input[data-stamp-setting="date"]',
    ) as HTMLInputElement;
    expect(dateInput).not.toBeNull();
    const before = dateInput;
    dateInput.focus();

    dateInput.value = '2026-06-15';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(internal.state.stamp.date).toBe('2026-06-15');
    expect(document.querySelector('input[data-stamp-setting="date"]')).toBe(before);

    const previewDateInput = document.querySelector(
      '#preview-stamp input[data-stamp-key="date"]',
    ) as HTMLInputElement | null;
    expect(previewDateInput?.value).toBe('2026-06-15');
  });
});
