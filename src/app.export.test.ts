import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exportFilledPdf = vi.fn(async () => new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }));
const downloadBlob = vi.fn();

vi.mock('./pdf', () => ({
  exportFilledPdf,
  downloadBlob,
  loadPdfBundle: vi.fn(),
  renderPreviewPage: vi.fn(),
}));

describe('PdfStampStudio export flow', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="app"></div>';
    URL.createObjectURL = vi.fn(() => 'blob:latest-export');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('keeps the download action available after generating a stamped PDF', async () => {
    const { PdfStampStudio } = await import('./app');
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: {
          fileName: string;
          sourceBytes: Uint8Array;
          fields: unknown[];
          pageCount: number;
          pageSizes: Array<{ width: number; height: number }>;
          previewDocument: { destroy: () => Promise<void> };
        } | null;
        pages: Array<{ id: string; kind: 'pdf'; pageNumber: number; width: number; height: number; label: string }>;
        previewPageId: string | null;
        loadingPdf: boolean;
        exporting: boolean;
      };
      handleExport: () => Promise<void>;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      sourceBytes: new Uint8Array([1, 2, 3]),
      fields: [],
      pageCount: 1,
      pageSizes: [{ width: 595, height: 842 }],
      previewDocument: {
        destroy: async () => undefined,
      },
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
    internalStudio.state.loadingPdf = false;
    internalStudio.state.exporting = false;

    await internalStudio.handleExport();

    expect(exportFilledPdf).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob.mock.calls[0]?.[1]).toBe('resume-stamped.pdf');

    const primaryLink = document.querySelector('.action-button[href]') as HTMLAnchorElement | null;
    expect(primaryLink).not.toBeNull();
    expect(primaryLink?.href).toContain('blob:latest-export');
    expect(primaryLink?.download).toBe('resume-stamped.pdf');
  });
});
