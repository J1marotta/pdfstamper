import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exportFilledPdf = vi.fn(async () => new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }));

vi.mock('./pdf', () => ({
  exportFilledPdf,
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
    let urlCounter = 0;
    URL.createObjectURL = vi.fn(() => {
      urlCounter += 1;
      return `blob:latest-export-${urlCounter}`;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  async function seedReadyStudio() {
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const { PdfStampStudio } = await import('./app');
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
      renderControlState: () => void;
      renderExportPanel: () => void;
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
    internalStudio.renderControlState();
    internalStudio.renderExportPanel();

    return internalStudio;
  }

  it('keeps a visible download link available after generating a stamped PDF', async () => {
    const internalStudio = await seedReadyStudio();

    expect(document.querySelector('#export-actions')?.textContent).toContain('Generate stamped PDF');

    await internalStudio.handleExport();

    expect(exportFilledPdf).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    const primaryLink = document.querySelector('.action-button[href]') as HTMLAnchorElement | null;
    expect(primaryLink).not.toBeNull();
    expect(primaryLink?.textContent).toContain('Download stamped PDF');
    expect(primaryLink?.href).toContain('blob:latest-export-1');
    expect(primaryLink?.download).toBe('resume-stamped.pdf');
    expect(document.querySelector('#export-actions')?.textContent).toContain('Regenerate');
  });

  it('replaces the ready-to-download link on re-export and revokes the previous url', async () => {
    const internalStudio = await seedReadyStudio();

    await internalStudio.handleExport();
    await internalStudio.handleExport();

    expect(exportFilledPdf).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:latest-export-1');

    const primaryLink = document.querySelector('.action-button[href]') as HTMLAnchorElement | null;
    expect(primaryLink).not.toBeNull();
    expect(primaryLink?.href).toContain('blob:latest-export-2');
    expect(primaryLink?.download).toBe('resume-stamped.pdf');
  });
});
