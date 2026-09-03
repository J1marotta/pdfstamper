// @ts-expect-error Vitest runs this file in Node; the app tsconfig omits Node types.
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfStampStudio } from './app';

type TestStampSettings = {
  mode?: string;
  payee?: string;
  totalAmount?: string;
  imageName?: string | null;
  imageBytes?: Uint8Array | null;
  imageMime?: string | null;
  placement?: {
    pageId: string | null;
    x: number;
    y: number;
    width: number;
    height?: number;
    rotation: number;
  };
};

type TestStudio = {
  state: {
    stamps: any;
    selectedStampId: any;
  };
};

function seedStamp(studio: TestStudio, patch: TestStampSettings = {}, selected = true): void {
  studio.state.stamps = [
    {
      id: 'stamp-1',
      settings: {
        mode: 'text',
        payee: '',
        totalAmount: '',
        gstAmount: '',
        movementNumber: '',
        signedBy: '',
        coSignedBy: '',
        approvedBy1: '',
        approvedBy2: '',
        date: '2026-05-20',
        placement: {
          pageId: 'pdf-1',
          x: 0.5,
          y: 0.7,
          width: 300,
          rotation: 0,
        },
        flatten: false,
        imageBytes: null,
        imageMime: null,
        imageName: null,
        ...patch,
      },
    },
  ];
  studio.state.selectedStampId = selected ? 'stamp-1' : null;
}

function selectedSettings(studio: TestStudio): any {
  return studio.state.stamps[0]?.settings;
}

describe('PdfStampStudio shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the page-first shell with a centered preview and floating inspector', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    new PdfStampStudio(root!);

    const topbar = document.querySelector('#topbar') as HTMLElement | null;
    expect(topbar).not.toBeNull();
    expect(topbar?.hidden).toBe(true);
    expect((document.querySelector('.studio-shell') as HTMLElement | null)?.classList.contains('is-empty-state')).toBe(true);
    expect((document.querySelector('#thumbnail-rail') as HTMLElement | null)?.hidden).toBe(true);
    expect((document.querySelector('#stamp-controls') as HTMLElement | null)?.hidden).toBe(true);
    expect((document.querySelector('#preview-file-meta') as HTMLElement | null)?.hidden).toBe(true);
    expect((document.querySelector('#status') as HTMLElement | null)?.hidden).toBe(true);
    expect(document.querySelector('#upload-button')).not.toBeNull();
    expect(document.querySelector('#preview-frame')).not.toBeNull();
    expect(document.querySelector('#thumbnail-rail')).not.toBeNull();
    expect(document.querySelector('#stamp-controls')).not.toBeNull();
    expect(document.querySelector('#advanced-sheet')).not.toBeNull();
  });

  it('keeps resize scale variables on the selection object', () => {
    const styleCss = readFileSync('src/style.css', 'utf8');

    expect(styleCss).toMatch(/\.preview-stamp-object\s*{[^}]*--stamp-scale-x: 1;/s);
    expect(styleCss).toMatch(/\.preview-stamp-object\s*{[^}]*--stamp-scale-y: 1;/s);
    expect(styleCss).not.toMatch(/\.preview-stamp-card\s*{[^}]*--stamp-scale-[xy]:/s);
  });

  it('shows the placed stamp overlay on the active page', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
      };
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    seedStamp(internalStudio, {
      payee: 'Acme Pty Ltd',
      totalAmount: '$100.00',
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    }, false);

    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewStamp = document.querySelector('#preview-stamp') as HTMLElement | null;
    expect(previewStamp).not.toBeNull();
    expect(previewStamp?.hidden).toBe(false);
    expect(previewStamp?.textContent).toContain('Acme Pty Ltd');
    expect(previewStamp?.textContent).toContain('$100.00');
  });

  it('reveals the top bar once a document bundle exists', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();

    const topbar = document.querySelector('#topbar') as HTMLElement | null;
    expect(topbar).not.toBeNull();
    expect(topbar?.hidden).toBe(false);
    expect((document.querySelector('.studio-shell') as HTMLElement | null)?.classList.contains('is-empty-state')).toBe(false);
    expect((document.querySelector('#preview-empty') as HTMLElement | null)?.hidden).toBe(true);
    expect((document.querySelector('#thumbnail-rail') as HTMLElement | null)?.hidden).toBe(false);
    expect((document.querySelector('#stamp-controls') as HTMLElement | null)?.hidden).toBe(false);
    expect((document.querySelector('#preview-file-meta') as HTMLElement | null)?.hidden).toBe(false);
    expect((document.querySelector('#delete-page-button') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('updates page navigation button states when the active page changes', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreview: () => Promise<void>;
    };

    internalStudio.renderPreview = vi.fn(async () => undefined);
    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 2,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
      {
        id: 'pdf-2',
        kind: 'pdf',
        pageNumber: 2,
        width: 595,
        height: 842,
        label: 'Page 2',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();

    const prevButton = document.querySelector('#prev-page-button') as HTMLButtonElement | null;
    const nextButton = document.querySelector('#next-page-button') as HTMLButtonElement | null;
    expect(prevButton?.disabled).toBe(true);
    expect(nextButton?.disabled).toBe(false);

    nextButton!.click();

    expect(prevButton?.disabled).toBe(false);
    expect(nextButton?.disabled).toBe(true);
    expect(document.querySelector('#preview-page-label')?.textContent).toContain('Page 2 2 / 2');
  });

  it('starts a resize interaction from a handle and exposes the matching cursor', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      stampInteraction: { kind: string; handle?: string } | null;
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    previewCanvas!.hidden = false;
    previewCanvas!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 800,
        right: 600,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement | null;
    expect(stampBody).not.toBeNull();
    Object.defineProperty(stampBody!, 'offsetWidth', { configurable: true, value: 300 });
    Object.defineProperty(stampBody!, 'offsetHeight', { configurable: true, value: 180 });

    const eastHandle = document.querySelector('.stamp-handle.is-e') as HTMLElement | null;
    expect(eastHandle).not.toBeNull();
    expect(eastHandle?.getAttribute('style')).toContain('cursor:ew-resize');

    const pointerDown = Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      clientX: 450,
      clientY: 300,
    });
    eastHandle!.dispatchEvent(pointerDown);

    expect(internalStudio.stampInteraction).not.toBeNull();
    expect(internalStudio.stampInteraction?.kind).toBe('resize');
    expect(internalStudio.stampInteraction?.handle).toBe('e');
  });

  it('lets you drag a placed stamp on the first pointerdown and advertises a grab cursor', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      stampInteraction: { kind: string; handle?: string } | null;
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.5,
        width: 300,
        rotation: 0,
      },
    }, false);
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    previewCanvas!.hidden = false;
    previewCanvas!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 800,
        right: 600,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement | null;
    expect(stampBody).not.toBeNull();
    expect(stampBody?.getAttribute('style')).toContain('cursor:grab');

    const pointerDown = Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      clientX: 300,
      clientY: 400,
    });
    stampBody!.dispatchEvent(pointerDown);

    expect(internalStudio.state.selectedStampId).toBe('stamp-1');
    expect(internalStudio.stampInteraction?.kind).toBe('drag');
  });

  it('resizes a rotated stamp along the rotated handle direction', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.5,
        width: 300,
        rotation: 90,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    previewCanvas!.hidden = false;
    previewCanvas!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 800,
        right: 600,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement | null;
    expect(stampBody).not.toBeNull();
    Object.defineProperty(stampBody!, 'offsetWidth', { configurable: true, value: 240 });
    Object.defineProperty(stampBody!, 'offsetHeight', { configurable: true, value: 120 });

    const eastHandle = document.querySelector('.stamp-handle.is-e') as HTMLElement | null;
    expect(eastHandle).not.toBeNull();
    expect(eastHandle?.getAttribute('style')).toContain('cursor:ns-resize');

    const pointerDown = Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      clientX: 300,
      clientY: 460,
    });
    eastHandle!.dispatchEvent(pointerDown);

    const pointerMove = Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
      clientX: 300,
      clientY: 520,
    });
    window.dispatchEvent(pointerMove);

    expect(selectedSettings(internalStudio).placement.width).toBeGreaterThan(300);

    window.dispatchEvent(new Event('pointerup'));
  });

  it('keeps side resize handles axis-specific while corners resize both axes', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; height?: number; rotation: number };
        };
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.5,
        width: 300,
        height: 160,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    previewCanvas!.hidden = false;
    previewCanvas!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 800,
        right: 600,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement | null;
    expect(stampBody).not.toBeNull();
    Object.defineProperty(stampBody!, 'offsetWidth', { configurable: true, value: 302.5 });
    Object.defineProperty(stampBody!, 'offsetHeight', { configurable: true, value: 152 });

    const eastHandle = document.querySelector('.stamp-handle.is-e') as HTMLElement | null;
    expect(eastHandle).not.toBeNull();
    eastHandle!.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      clientX: 451.25,
      clientY: 400,
    }));
    window.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
      clientX: 526.25,
      clientY: 520,
    }));

    expect(selectedSettings(internalStudio).placement.width).toBeGreaterThan(300);
    expect(selectedSettings(internalStudio).placement.height).toBeCloseTo(160, 1);

    window.dispatchEvent(new Event('pointerup'));

    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.5,
        width: 300,
        height: 160,
        rotation: 0,
      },
    });
    internalStudio.renderPreviewStamp();

    const nextStampBody = document.querySelector('.preview-stamp-body') as HTMLElement | null;
    expect(nextStampBody).not.toBeNull();
    Object.defineProperty(nextStampBody!, 'offsetWidth', { configurable: true, value: 302.5 });
    Object.defineProperty(nextStampBody!, 'offsetHeight', { configurable: true, value: 152 });

    const southEastHandle = document.querySelector('.stamp-handle.is-se') as HTMLElement | null;
    expect(southEastHandle).not.toBeNull();
    southEastHandle!.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      clientX: 451.25,
      clientY: 476,
    }));
    window.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
      clientX: 526.25,
      clientY: 552,
    }));

    expect(selectedSettings(internalStudio).placement.width).toBeGreaterThan(300);
    expect(selectedSettings(internalStudio).placement.height).toBeGreaterThan(160);

    window.dispatchEvent(new Event('pointerup'));
  });

  it('allows one resize drag to reach the configured minimum stamp size', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.5,
        width: 300,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    previewCanvas!.hidden = false;
    previewCanvas!.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 800,
        right: 600,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const stampBody = document.querySelector('.preview-stamp-body') as HTMLElement | null;
    expect(stampBody).not.toBeNull();
    Object.defineProperty(stampBody!, 'offsetWidth', { configurable: true, value: 312 });
    Object.defineProperty(stampBody!, 'offsetHeight', { configurable: true, value: 190 });

    const eastHandle = document.querySelector('.stamp-handle.is-e') as HTMLElement | null;
    expect(eastHandle).not.toBeNull();
    eastHandle!.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      clientX: 456,
      clientY: 400,
    }));

    window.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
      clientX: 300,
      clientY: 400,
    }));

    expect(selectedSettings(internalStudio).placement.width).toBeCloseTo(12);

    window.dispatchEvent(new Event('pointerup'));
  });

  it('scales preview text down with the stamp and preserves the smaller minimum size', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 12,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const stampObject = document.querySelector('.preview-stamp-object') as HTMLElement | null;
    expect(stampObject).not.toBeNull();
    expect(stampObject?.getAttribute('style')).toContain('--stamp-scale-x:0.0261');
    expect(stampObject?.getAttribute('style')).toContain('--stamp-scale-y:0.0423');
    expect(stampObject?.getAttribute('style')).toContain('--stamp-font-scale:0.0261');
    expect(stampObject?.getAttribute('style')).toContain('width:12px');
  });

  it('switches image uploads into a visible stamp mode and shows the selected filename', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          mode: 'text' | 'image' | 'both';
          imageName: string | null;
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      handleStampImage: (file: File) => Promise<void>;
      renderControlState: () => void;
      renderStampControls: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      mode: 'text',
      imageName: null,
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderStampControls();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'seal.png', { type: 'image/png' });
    await internalStudio.handleStampImage(file);

    expect(selectedSettings(internalStudio).mode).toBe('both');
    expect(selectedSettings(internalStudio).imageName).toBe('seal.png');
    expect(document.querySelector('#stamp-controls')?.textContent).toContain('Using seal.png.');
    expect(document.querySelector('.preview-stamp-image')).not.toBeNull();
  });

  it('reveals status for pre-upload errors instead of leaving it hidden', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        notice: { tone: 'neutral' | 'busy' | 'success' | 'error'; message: string };
      };
      renderStatus: () => void;
    };

    const status = document.querySelector('#status') as HTMLElement | null;
    expect(status).not.toBeNull();
    expect(status?.hidden).toBe(true);

    internalStudio.state.notice = {
      tone: 'error',
      message: 'Use a PDF file for this workflow.',
    };
    internalStudio.renderStatus();

    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain('Use a PDF file for this workflow.');
  });

  it('deletes the active page, advances preview, and clears the stamp if it was on that page', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      renderControlState: () => void;
      renderThumbnailRail: () => void;
      renderStampControls: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
      renderPreview: () => Promise<void>;
    };

    internalStudio.renderPreview = vi.fn(async () => undefined);
    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 2,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
      {
        id: 'pdf-2',
        kind: 'pdf',
        pageNumber: 2,
        width: 595,
        height: 842,
        label: 'Page 2',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderThumbnailRail();
    internalStudio.renderStampControls();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const deleteButton = document.querySelector('#delete-page-button') as HTMLButtonElement | null;
    const status = document.querySelector('#status') as HTMLElement | null;
    expect(deleteButton).not.toBeNull();
    expect(deleteButton?.disabled).toBe(false);

    deleteButton!.click();

    expect(internalStudio.state.pages.map((page) => page.id)).toEqual(['pdf-2']);
    expect(internalStudio.state.previewPageId).toBe('pdf-2');
    expect(selectedSettings(internalStudio).placement.pageId).toBeNull();
    expect(status?.textContent).toContain('1 stamp moved off it.');
    expect(deleteButton?.disabled).toBe(true);
  });

  it('deletes the placed stamp from the inspector and clears the page marker', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
      };
      renderControlState: () => void;
      renderThumbnailRail: () => void;
      renderStampControls: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });
    internalStudio.renderControlState();
    internalStudio.renderThumbnailRail();
    internalStudio.renderStampControls();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const deleteStampButton = document.querySelector('[data-action="delete-stamp"]') as HTMLButtonElement | null;
    const previewStamp = document.querySelector('#preview-stamp') as HTMLElement | null;
    expect(deleteStampButton).not.toBeNull();
    expect(previewStamp?.hidden).toBe(false);
    expect(document.querySelector('.thumb-stamp-flag')).not.toBeNull();

    deleteStampButton!.click();

    expect(internalStudio.state.stamps).toHaveLength(0);
    expect(internalStudio.state.selectedStampId).toBeNull();
    expect(previewStamp?.hidden).toBe(true);
    expect(document.querySelector('.thumb-stamp-flag')).toBeNull();
    expect(document.querySelector('[data-action="delete-stamp"]')).toBeNull();
  });

  it('shows a clear error when a non-PDF file is dropped onto the preview stage', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    new PdfStampStudio(root!);

    const previewFrame = document.querySelector('#preview-frame') as HTMLElement | null;
    const status = document.querySelector('#status') as HTMLElement | null;
    expect(previewFrame).not.toBeNull();
    expect(status).not.toBeNull();

    const dropEvent = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
      dataTransfer: {
        files: [new File(['plain text'], 'notes.txt', { type: 'text/plain' })],
      },
    });
    previewFrame!.dispatchEvent(dropEvent);

    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain('Drop a PDF file to load it here.');
  });

  it('locks the visible stamp overlay to the rendered canvas bounds', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        stamp: {
          payee: string;
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    seedStamp(internalStudio, {
      payee: 'Acme Pty Ltd',
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });

    const previewCanvas = document.querySelector('#preview-canvas') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    previewCanvas!.hidden = false;
    Object.defineProperty(previewCanvas!, 'offsetLeft', { configurable: true, value: 120 });
    Object.defineProperty(previewCanvas!, 'offsetTop', { configurable: true, value: 48 });
    Object.defineProperty(previewCanvas!, 'clientWidth', { configurable: true, value: 540 });
    Object.defineProperty(previewCanvas!, 'clientHeight', { configurable: true, value: 760 });

    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const previewStamp = document.querySelector('#preview-stamp') as HTMLElement | null;
    const previewGuides = document.querySelector('#preview-guides') as HTMLElement | null;
    expect(previewStamp?.style.left).toBe('120px');
    expect(previewStamp?.style.top).toBe('48px');
    expect(previewStamp?.style.width).toBe('540px');
    expect(previewStamp?.style.height).toBe('760px');
    expect(previewGuides?.style.left).toBe('120px');
    expect(previewGuides?.style.width).toBe('540px');
  });

  it('clears a stale download link after direct stamp editing', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
        lastExportUrl: string | null;
        lastExportName: string | null;
        stamp: {
          payee: string;
          placement: { pageId: string | null; x: number; y: number; width: number; rotation: number };
        };
      };
      renderExportPanel: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.selectedStampId = 'stamp-1';
    internalStudio.state.lastExportUrl = 'blob:stale-export';
    internalStudio.state.lastExportName = 'resume-stamped.pdf';
    seedStamp(internalStudio, {
      payee: 'Original payee',
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });

    internalStudio.renderExportPanel();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const payeeInput = document.querySelector(
      '.stamp-table-input[data-stamp-key="payee"]',
    ) as HTMLInputElement | null;
    expect(payeeInput).not.toBeNull();

    payeeInput!.value = 'Updated payee';
    payeeInput!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(revokeSpy).toHaveBeenCalledWith('blob:stale-export');
    expect(document.querySelector('.action-button[data-action="download-export"]')).toBeNull();
    expect(document.querySelector('#export-actions')?.textContent).toContain('Generate stamped PDF');
  });

  it('hides the document-fields sheet again when there is no loaded document', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        advancedOpen: boolean;
        bundle: { fileName: string; pageCount: number } | null;
      };
      renderAdvancedSheetVisibility: () => void;
      renderControlState: () => void;
    };

    const advancedSheet = document.querySelector('#advanced-sheet') as HTMLElement | null;
    expect(advancedSheet).not.toBeNull();

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.advancedOpen = true;
    internalStudio.renderAdvancedSheetVisibility();
    expect(advancedSheet?.hidden).toBe(false);

    internalStudio.state.bundle = null;
    internalStudio.renderControlState();
    expect(advancedSheet?.hidden).toBe(true);
  });

  it('warns in the inspector when stamp text will be cut off on export', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
      };
      renderStampControls: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    seedStamp(internalStudio, {
      payee: 'A very long payee name that cannot possibly fit on one export line at all',
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 300,
        rotation: 0,
      },
    });
    internalStudio.renderStampControls();

    expect(document.querySelector('.inspector-warning')?.textContent).toContain('cut off on export');

    internalStudio.renderPreviewStamp();
    expect(document.querySelector('#preview-stamp .stamp-table-row.is-truncated')).not.toBeNull();

    seedStamp(internalStudio, {
      payee: 'Acme',
    });
    internalStudio.renderStampControls();

    expect(document.querySelector('.inspector-warning')).toBeNull();
  });

  it('shows a password dialog and clears it on cancel', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        passwordDialog: { fileName: string; error: string } | null;
        notice: { tone: string; message: string };
      };
      renderPasswordDialog: () => void;
    };

    expect(document.querySelector('#password-dialog')?.textContent).toBe('');

    internalStudio.state.passwordDialog = { fileName: 'locked.pdf', error: '' };
    internalStudio.renderPasswordDialog();

    expect(document.querySelector('#password-input')).not.toBeNull();
    expect(document.querySelector('#password-dialog')?.textContent).toContain('locked.pdf');

    const cancelButton = document.querySelector('[data-action="cancel-password"]') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    cancelButton!.click();

    expect(internalStudio.state.passwordDialog).toBeNull();
    expect(document.querySelector('#password-input')).toBeNull();
    expect(document.querySelector('#status')?.textContent).toContain('Password entry cancelled.');
  });

  it('disables export actions for encrypted documents', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        encryptedReadOnly: boolean;
      };
      renderExportPanel: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'locked.pdf',
      pageCount: 1,
    };
    internalStudio.state.encryptedReadOnly = true;
    internalStudio.renderExportPanel();

    const generateButton = document.querySelector('[data-action="export-pdf"]') as HTMLButtonElement | null;
    expect(generateButton).not.toBeNull();
    expect(generateButton?.disabled).toBe(true);
  });

  it('persists profile and stamp preferences across instances without image bytes', () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        profile: Record<string, string>;
        stamps: Array<{ id: string; settings: Record<string, unknown> }>;
        selectedStampId: string | null;
        overwriteExisting: boolean;
      };
      persistPreferences: () => void;
    };

    internalStudio.state.profile = { fullName: 'Taylor Smith' };
    seedStamp(internalStudio, {
      payee: 'Acme Pty Ltd',
      imageBytes: new Uint8Array([1, 2, 3]),
    });
    internalStudio.state.overwriteExisting = true;
    internalStudio.persistPreferences();

    const stored = JSON.parse(localStorage.getItem('pdf-stamp-studio:v1') ?? '{}') as Record<string, unknown>;
    expect((stored.profile as Record<string, string>).fullName).toBe('Taylor Smith');
    const storedStamps = stored.stamps as Array<Record<string, unknown>>;
    expect(storedStamps).toHaveLength(1);
    expect(storedStamps[0]?.payee).toBe('Acme Pty Ltd');
    expect(storedStamps[0]?.imageBytes).toBeUndefined();

    document.body.innerHTML = '<div id="app"></div>';
    const root2 = document.getElementById('app');
    const studio2 = new PdfStampStudio(root2!);
    const restored = studio2 as unknown as {
      state: {
        profile: Record<string, string>;
        stamps: Array<{ id: string; settings: Record<string, unknown> }>;
        selectedStampId: string | null;
        overwriteExisting: boolean;
      };
    };

    expect(restored.state.profile.fullName).toBe('Taylor Smith');
    expect(restored.state.stamps).toHaveLength(1);
    expect(restored.state.stamps[0]?.settings.payee).toBe('Acme Pty Ltd');
    expect(restored.state.selectedStampId).toBeNull();
    expect(restored.state.overwriteExisting).toBe(true);
    expect((document.querySelector('#overwrite-toggle') as HTMLInputElement).checked).toBe(true);

    localStorage.clear();
  });

  it('adds, edits, drag-selects, and deletes a text box on the current page', () => {    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        textBoxes: Array<{ id: string; pageId: string; x: number; y: number; text: string; fontSize: number }>;
        selectedTextBoxId: string | null;
        lastExportUrl: string | null;
        lastExportName: string | null;
      };
      renderControlState: () => void;
      renderPreviewMeta: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'scan.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    internalStudio.state.lastExportUrl = 'blob:stale-export';
    internalStudio.state.lastExportName = 'scan-stamped.pdf';
    internalStudio.renderControlState();
    internalStudio.renderPreviewMeta();

    expect(document.querySelector('#preview-textboxes')).not.toBeNull();

    const addButton = document.querySelector('[data-action="add-textbox"]') as HTMLButtonElement | null;
    expect(addButton).not.toBeNull();
    addButton!.click();

    expect(internalStudio.state.textBoxes).toHaveLength(1);
    expect(internalStudio.state.textBoxes[0]?.pageId).toBe('pdf-1');

    const textInput = document.querySelector('.textbox-input') as HTMLInputElement | null;
    expect(textInput).not.toBeNull();

    textInput!.value = 'Received 20 May 2026';
    textInput!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(internalStudio.state.textBoxes[0]?.text).toBe('Received 20 May 2026');
    expect(internalStudio.state.lastExportUrl).toBeNull();

    const deleteButton = document.querySelector('[data-action="delete-textbox"]') as HTMLButtonElement | null;
    expect(deleteButton).not.toBeNull();
    deleteButton!.click();

    expect(internalStudio.state.textBoxes).toHaveLength(0);
    expect(document.querySelector('.textbox-input')).toBeNull();
  });

  it('supports several placed stamps and switches selection between them', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
      };
      renderControlState: () => void;
      renderThumbnailRail: () => void;
      renderStampControls: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'claims.pdf',
      pageCount: 2,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
      {
        id: 'pdf-2',
        kind: 'pdf',
        pageNumber: 2,
        width: 595,
        height: 842,
        label: 'Page 2',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    seedStamp(internalStudio, {
      payee: 'First stamp',
      placement: { pageId: 'pdf-1', x: 0.3, y: 0.3, width: 260, rotation: 0 },
    });
    internalStudio.state.stamps = [
      ...internalStudio.state.stamps,
      {
        id: 'stamp-2',
        settings: {
          ...selectedSettings(internalStudio),
          payee: 'Second stamp',
          placement: { pageId: 'pdf-1', x: 0.7, y: 0.7, width: 260, rotation: 0 },
        },
      },
    ];
    internalStudio.renderControlState();
    internalStudio.renderThumbnailRail();
    internalStudio.renderStampControls();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    expect(document.querySelectorAll('.preview-stamp-object')).toHaveLength(2);
    expect(document.querySelector('.thumb-stamp-flag')?.textContent).toContain('2 stamps');
    expect(document.querySelector('#stamp-controls')?.textContent).toContain('Stamp 1 of 2');

    const secondObject = document.querySelectorAll('.preview-stamp-object')[1] as HTMLElement;
    secondObject.dispatchEvent(new Event('click', { bubbles: true }));

    expect(internalStudio.state.selectedStampId).toBe('stamp-2');
    expect(document.querySelector('#stamp-controls')?.textContent).toContain('Stamp 2 of 2');

    const secondPayee = document.querySelector(
      '.preview-stamp-object[data-stamp-id="stamp-2"] input[data-stamp-key="payee"]',
    ) as HTMLInputElement | null;
    expect(secondPayee?.value).toBe('Second stamp');
    expect(
      document.querySelector('.preview-stamp-object[data-stamp-id="stamp-1"] input'),
    ).toBeNull();
  });

  it('nudges the selected stamp by points without a pointer drag', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        stamps: any;
        selectedStampId: any;
      };
      renderControlState: () => void;
      renderStampControls: () => void;
      renderPreviewMeta: () => void;
      renderPreviewStamp: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'form.pdf',
      pageCount: 1,
    };
    internalStudio.state.pages = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];
    internalStudio.state.previewPageId = 'pdf-1';
    seedStamp(internalStudio, {
      placement: { pageId: 'pdf-1', x: 0.5, y: 0.5, width: 300, rotation: 0 },
    });
    internalStudio.renderControlState();
    internalStudio.renderStampControls();
    internalStudio.renderPreviewMeta();
    internalStudio.renderPreviewStamp();

    const upButton = document.querySelector('[aria-label="Move stamp up"]') as HTMLButtonElement | null;
    expect(upButton).not.toBeNull();
    upButton!.click();

    expect(selectedSettings(internalStudio).placement.y).toBeCloseTo(0.5 - 4 / 842, 6);
    expect(selectedSettings(internalStudio).placement.x).toBeCloseTo(0.5, 6);

    const rightButton = document.querySelector('[aria-label="Move stamp right"]') as HTMLButtonElement | null;
    rightButton!.click();

    expect(selectedSettings(internalStudio).placement.x).toBeCloseTo(0.5 + 4 / 595, 6);
  });

  it('opens the signature dialog and turns the pad into an image stamp', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (() => 'blob:signature') as typeof URL.createObjectURL;
    try {
      const studio = new PdfStampStudio(root!);
      const internalStudio = studio as unknown as {
        state: {
          bundle: { fileName: string; pageCount: number } | null;
          stamps: any;
          selectedStampId: any;
          signatureOpen: boolean;
        };
        signatureHasInk: boolean;
      };

      internalStudio.state.bundle = {
        fileName: 'form.pdf',
        pageCount: 1,
      };

      const signButton = document.querySelector('[data-action="open-signature"]');
      expect(signButton).toBeNull();

      internalStudio.state.stamps = [];
      (studio as unknown as { renderStampControls: () => void }).renderStampControls();
      document.querySelector('[data-action="open-signature"]')?.dispatchEvent(
        new Event('click', { bubbles: true }),
      );

      expect(internalStudio.state.signatureOpen).toBe(true);
      const canvasEl = document.querySelector('#signature-canvas') as HTMLCanvasElement | null;
      expect(canvasEl).not.toBeNull();
      if (!canvasEl) {
        throw new Error('signature canvas missing');
      }

      canvasEl.toBlob = ((callback: BlobCallback) => {
        callback(new Blob(['fake-png'], { type: 'image/png' }));
      }) as typeof canvasEl.toBlob;
      canvasEl.getContext = (() =>
        ({} as unknown as CanvasRenderingContext2D)) as unknown as typeof canvasEl.getContext;
      internalStudio.signatureHasInk = true;

      (document.querySelector('[data-action="use-signature"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(internalStudio.state.signatureOpen).toBe(false);
      expect(internalStudio.state.stamps).toHaveLength(1);
      expect(internalStudio.state.stamps[0].settings.mode).toBe('image');
      expect(internalStudio.state.stamps[0].settings.imageName).toContain('signature-');
      expect(internalStudio.state.selectedStampId).toBe(internalStudio.state.stamps[0].id);
    } finally {
      URL.createObjectURL = createObjectURL;
    }
  });

  it('refuses an empty signature pad', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; pageCount: number } | null;
        stamps: any;
        signatureOpen: boolean;
        notice: { tone: string; message: string };
      };
      renderStampControls: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'form.pdf',
      pageCount: 1,
    };
    internalStudio.state.stamps = [];
    internalStudio.renderStampControls();
    document.querySelector('[data-action="open-signature"]')?.dispatchEvent(
      new Event('click', { bubbles: true }),
    );

    expect(internalStudio.state.signatureOpen).toBe(true);

    (document.querySelector('[data-action="use-signature"]') as HTMLButtonElement).click();

    expect(internalStudio.state.stamps).toHaveLength(0);
    expect(internalStudio.state.signatureOpen).toBe(true);
  });
});
