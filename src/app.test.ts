import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfStampStudio } from './app';

describe('PdfStampStudio shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the stamp editor inline and reserves a preview stamp overlay', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    new PdfStampStudio(root!);

    expect(document.querySelector('#preview-stamp')).not.toBeNull();
    expect(document.querySelector('#stamp-controls')).not.toBeNull();
    expect(document.querySelector('#stamp-controls .stamp-toolbar')).not.toBeNull();
    expect(document.querySelector('#stamp-controls .stamp-table-input[data-stamp-key="payee"]')).not.toBeNull();
  });

  it('shows a visible download action after an export is ready', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string } | null;
        busy: boolean;
        lastExportUrl: string | null;
        lastExportName: string | null;
      };
      renderExportPanel: () => void;
    };

    internalStudio.state.bundle = { fileName: 'resume.pdf' };
    internalStudio.state.busy = false;
    internalStudio.state.lastExportUrl = 'blob:test-url';
    internalStudio.state.lastExportName = 'resume-stamped.pdf';
    internalStudio.renderExportPanel();

    const primaryLink = document.querySelector('.export-button-link') as HTMLAnchorElement | null;
    expect(primaryLink).not.toBeNull();
    expect(primaryLink?.download).toBe('resume-stamped.pdf');
    expect(primaryLink?.textContent).toContain('Download stamped PDF');
  });

  it('renders the preview overlay from the same stamp values used by the inline editor', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string; fields: unknown[]; pageCount: number } | null;
        previewPage: number;
        stamp: {
          payee: string;
          totalAmount: string;
          placement: 'last-page' | 'every-page';
        };
      };
      renderPreviewMeta: () => void;
    };

    internalStudio.state.bundle = {
      fileName: 'resume.pdf',
      fields: [],
      pageCount: 2,
    };
    internalStudio.state.previewPage = 2;
    internalStudio.state.stamp = {
      ...internalStudio.state.stamp,
      payee: 'Acme Pty Ltd',
      totalAmount: '$100.00',
      placement: 'last-page',
    };
    internalStudio.renderPreviewMeta();

    const previewStamp = document.querySelector('#preview-stamp') as HTMLElement | null;
    expect(previewStamp).not.toBeNull();
    expect(previewStamp?.hidden).toBe(false);
    expect(previewStamp?.textContent).toContain('Acme Pty Ltd');
    expect(previewStamp?.textContent).toContain('$100.00');
  });

  it('clears the stale download link after an inline stamp edit', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');

    expect(root).not.toBeNull();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const studio = new PdfStampStudio(root!);
    const internalStudio = studio as unknown as {
      state: {
        bundle: { fileName: string } | null;
        busy: boolean;
        lastExportUrl: string | null;
        lastExportName: string | null;
      };
      renderExportPanel: () => void;
    };

    internalStudio.state.bundle = { fileName: 'resume.pdf' };
    internalStudio.state.busy = false;
    internalStudio.state.lastExportUrl = 'blob:stale-export';
    internalStudio.state.lastExportName = 'resume-stamped.pdf';
    internalStudio.renderExportPanel();

    const payeeInput = document.querySelector(
      '.stamp-table-input[data-stamp-key="payee"]',
    ) as HTMLInputElement | null;
    expect(payeeInput).not.toBeNull();

    payeeInput!.value = 'Updated payee';
    payeeInput!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(revokeSpy).toHaveBeenCalledWith('blob:stale-export');
    expect(document.querySelector('.export-button-link')).toBeNull();
    expect(document.querySelector('.export-button')?.textContent).toContain('Generate stamped PDF');
  });
});
