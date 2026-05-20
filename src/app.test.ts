import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfStampStudio } from './app';

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
        stampSelected: boolean;
        stamp: {
          payee: string;
          totalAmount: string;
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
    internalStudio.state.stampSelected = false;
    internalStudio.state.stamp = {
      ...internalStudio.state.stamp,
      payee: 'Acme Pty Ltd',
      totalAmount: '$100.00',
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 0.5,
        rotation: 0,
      },
    };

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
    expect((document.querySelector('#preview-empty') as HTMLElement | null)?.hidden).toBe(true);
    expect((document.querySelector('#thumbnail-rail') as HTMLElement | null)?.hidden).toBe(false);
    expect((document.querySelector('#stamp-controls') as HTMLElement | null)?.hidden).toBe(false);
    expect((document.querySelector('#preview-file-meta') as HTMLElement | null)?.hidden).toBe(false);
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
        stampSelected: boolean;
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
    internalStudio.state.stampSelected = true;
    internalStudio.state.stamp = {
      ...internalStudio.state.stamp,
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 0.5,
        rotation: 0,
      },
    };
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
        stampSelected: boolean;
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
    internalStudio.state.stampSelected = true;
    internalStudio.state.lastExportUrl = 'blob:stale-export';
    internalStudio.state.lastExportName = 'resume-stamped.pdf';
    internalStudio.state.stamp = {
      ...internalStudio.state.stamp,
      payee: 'Original payee',
      placement: {
        pageId: 'pdf-1',
        x: 0.5,
        y: 0.7,
        width: 0.5,
        rotation: 0,
      },
    };

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
    expect(document.querySelector('.action-button[href]')).toBeNull();
    expect(document.querySelector('#export-actions')?.textContent).toContain('Export stamped PDF');
  });
});
