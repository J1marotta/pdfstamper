import {
  applyProfileToFields,
  getProfileFieldDefinition,
  isEditableField,
  pickActiveProfileKeys,
  seedProfileValues,
  todayInputValue,
} from './heuristics';
import type { LoadedPdfBundle } from './pdf';
import type {
  FillStats,
  PdfFieldModel,
  ProfileValues,
  SemanticKey,
  StampSettings,
} from './types';

interface NoticeState {
  tone: 'neutral' | 'busy' | 'success' | 'error';
  message: string;
}

interface AppState {
  bundle: LoadedPdfBundle | null;
  fields: PdfFieldModel[];
  profile: ProfileValues;
  activeKeys: SemanticKey[];
  stats: FillStats;
  stamp: StampSettings;
  overwriteExisting: boolean;
  previewPage: number;
  notice: NoticeState;
  busy: boolean;
  stampImageUrl: string | null;
  lastExportUrl: string | null;
  lastExportName: string | null;
}

interface AppElements {
  fileInput: HTMLInputElement;
  dropzone: HTMLButtonElement;
  status: HTMLElement;
  summary: HTMLElement;
  profileFields: HTMLElement;
  overwriteToggle: HTMLInputElement;
  stampControls: HTMLElement;
  fieldList: HTMLElement;
  exportPanel: HTMLElement;
  previewFrame: HTMLElement;
  previewCanvas: HTMLCanvasElement;
  previewHint: HTMLElement;
  previewPageLabel: HTMLElement;
  previewFileMeta: HTMLElement;
  prevPageButton: HTMLButtonElement;
  nextPageButton: HTMLButtonElement;
}

interface ReapplyRenderOptions {
  summary?: boolean;
  profileFields?: boolean;
  fieldList?: boolean;
  exportPanel?: boolean;
}

interface ContainerRenderState {
  focusSelector: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollTop: number;
  scrollLeft: number;
}

const EMPTY_STATS: FillStats = {
  autofilledCount: 0,
  remainingCount: 0,
  editableCount: 0,
  matchedCount: 0,
};

type PdfModule = typeof import('./pdf');

let pdfModulePromise: Promise<PdfModule> | null = null;

function getPdfModule(): Promise<PdfModule> {
  pdfModulePromise ??= import('./pdf');
  return pdfModulePromise;
}

export class PdfStampStudio {
  private readonly root: HTMLElement;
  private readonly elements: AppElements;
  private state: AppState;
  private previewToken = 0;
  private previewResizeFrame: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = shellMarkup();
    this.elements = {
      fileInput: this.root.querySelector<HTMLInputElement>('#file-input')!,
      dropzone: this.root.querySelector<HTMLButtonElement>('#dropzone')!,
      status: this.root.querySelector<HTMLElement>('#status')!,
      summary: this.root.querySelector<HTMLElement>('#summary')!,
      profileFields: this.root.querySelector<HTMLElement>('#profile-fields')!,
      overwriteToggle: this.root.querySelector<HTMLInputElement>('#overwrite-toggle')!,
      stampControls: this.root.querySelector<HTMLElement>('#stamp-controls')!,
      fieldList: this.root.querySelector<HTMLElement>('#field-list')!,
      exportPanel: this.root.querySelector<HTMLElement>('#export-panel')!,
      previewFrame: this.root.querySelector<HTMLElement>('#preview-frame')!,
      previewCanvas: this.root.querySelector<HTMLCanvasElement>('#preview-canvas')!,
      previewHint: this.root.querySelector<HTMLElement>('#preview-hint')!,
      previewPageLabel: this.root.querySelector<HTMLElement>('#preview-page-label')!,
      previewFileMeta: this.root.querySelector<HTMLElement>('#preview-file-meta')!,
      prevPageButton: this.root.querySelector<HTMLButtonElement>('#prev-page-button')!,
      nextPageButton: this.root.querySelector<HTMLButtonElement>('#next-page-button')!,
    };

    this.state = {
      bundle: null,
      fields: [],
      profile: {
        date: todayInputValue(),
      },
      activeKeys: ['fullName', 'email', 'phone', 'reference', 'date'],
      stats: EMPTY_STATS,
      stamp: defaultStampSettings(),
      overwriteExisting: false,
      previewPage: 1,
      notice: {
        tone: 'neutral',
        message: 'Drop a PDF to inspect its fillable fields and keep everything in-browser.',
      },
      busy: false,
      stampImageUrl: null,
      lastExportUrl: null,
      lastExportName: null,
    };

    this.bindEvents();
    this.renderAll();
  }

  private bindEvents(): void {
    this.elements.dropzone.addEventListener('click', () => {
      if (!this.state.busy) {
        this.elements.fileInput.click();
      }
    });

    this.elements.fileInput.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        void this.handlePdf(file);
      }
      target.value = '';
    });

    this.elements.dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (this.state.busy) {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'none';
        }
        this.elements.dropzone.classList.remove('is-dragging');
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      this.elements.dropzone.classList.add('is-dragging');
    });

    this.elements.dropzone.addEventListener('dragleave', () => {
      this.elements.dropzone.classList.remove('is-dragging');
    });

    this.elements.dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      this.elements.dropzone.classList.remove('is-dragging');
      if (this.state.busy) {
        return;
      }
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
        candidate.name.toLowerCase().endsWith('.pdf'),
      );

      if (file) {
        void this.handlePdf(file);
      }
    });

    this.elements.overwriteToggle.addEventListener('change', () => {
      if (this.state.busy) {
        return;
      }
      this.state.overwriteExisting = this.elements.overwriteToggle.checked;
      this.reapplyProfile();
    });

    this.elements.profileFields.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      if (this.state.busy) {
        return;
      }

      const key = target.dataset.profileKey as SemanticKey | undefined;
      if (!key) {
        return;
      }

      const previousProfile = this.state.profile;
      const nextProfile: ProfileValues = {
        ...previousProfile,
        [key]: target.value,
      };

      this.state.profile = nextProfile;
      this.state.stamp = syncStampFromProfile(previousProfile, nextProfile, this.state.stamp);

      this.reapplyProfile({ profileFields: false });
      this.renderStampControls();
    });

    const onFieldEdit = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      if (this.state.busy) {
        return;
      }

      const fieldId = target.dataset.fieldId;
      if (!fieldId) {
        return;
      }

      const fieldIndex = this.state.fields.findIndex((field) => field.id === fieldId);
      if (fieldIndex === -1) {
        return;
      }

      const field = this.state.fields[fieldIndex];
      const nextValue =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
          : target.value;
      const updatedField: PdfFieldModel = {
        ...field,
        value: nextValue,
        dirty: true,
        autoFilled: false,
      };

      this.state.fields = this.state.fields.map((candidate) =>
        candidate.id === fieldId ? updatedField : candidate,
      );

      if (field.semanticKey && typeof nextValue === 'string') {
        const previousProfile = this.state.profile;
        const nextProfile: ProfileValues = {
          ...previousProfile,
          [field.semanticKey]: nextValue,
        };

        this.state.profile = nextProfile;
        this.state.stamp = syncStampFromProfile(previousProfile, nextProfile, this.state.stamp);
      }

      this.reapplyProfile();
      this.renderStampControls();
    };

    this.elements.fieldList.addEventListener('input', onFieldEdit);
    this.elements.fieldList.addEventListener('change', onFieldEdit);

    this.elements.stampControls.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
        return;
      }

      if (this.state.busy) {
        return;
      }

      if (target instanceof HTMLInputElement && target.type === 'file') {
        return;
      }

      const key = target.dataset.stampKey as keyof StampSettings | undefined;
      if (!key) {
        return;
      }

      const nextValue =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
          : target.value;

      this.state.stamp = {
        ...this.state.stamp,
        [key]: nextValue,
      };
      this.renderStampControls();
    });

    this.elements.stampControls.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') {
        return;
      }

      if (this.state.busy) {
        return;
      }

      const file = target.files?.[0];
      if (file) {
        void this.handleStampImage(file);
      }
    });

    this.elements.stampControls.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (this.state.busy) {
        return;
      }

      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'clear-stamp-image') {
        this.clearStampImage();
        this.renderStampControls();
      }
    });

    this.elements.exportPanel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (this.state.busy) {
        return;
      }

      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'export-pdf') {
        void this.handleExport();
      }
    });

    this.elements.prevPageButton.addEventListener('click', () => {
      if (!this.state.bundle || this.state.busy || this.state.previewPage <= 1) {
        return;
      }

      this.state.previewPage -= 1;
      this.renderPreviewMeta();
      void this.renderPreview();
    });

    this.elements.nextPageButton.addEventListener('click', () => {
      if (!this.state.bundle || this.state.busy || this.state.previewPage >= this.state.bundle.pageCount) {
        return;
      }

      this.state.previewPage += 1;
      this.renderPreviewMeta();
      void this.renderPreview();
    });

    window.addEventListener('resize', () => {
      if (this.state.bundle && !this.state.busy) {
        this.schedulePreviewRender();
      }
    });
  }

  private async handlePdf(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.setNotice('Use a PDF file for this workflow.', 'error');
      this.renderStatus();
      return;
    }

    this.clearLastExport();
    this.state.busy = true;
    this.setNotice('Loading the PDF locally and scanning its fillable fields...', 'busy');
    this.renderStatus();
    this.renderControlState();
    this.renderExportPanel();
    this.renderPreviewMeta();
    this.showPreviewHint('Loading PDF preview...');

    try {
      await this.releasePreviewDocument();
      const { loadPdfBundle } = await getPdfModule();
      const bundle = await loadPdfBundle(file);
      const seededValues = seedProfileValues(bundle.fields);
      const seededProfile: ProfileValues = {
        ...seededValues,
        ...this.state.profile,
        date: this.state.profile.date || seededValues.date || todayInputValue(),
      };
      const activeKeys: SemanticKey[] = Array.from(new Set([
        ...pickActiveProfileKeys(bundle.fields, bundle.textDigest),
        ...(Object.entries(seededProfile) as Array<[SemanticKey, string | undefined]>)
          .filter(([, value]) => Boolean(value?.trim()))
          .map(([key]) => key),
      ])) as SemanticKey[];

      const previousProfile = this.state.profile;
      this.state.bundle = bundle;
      this.state.fields = bundle.fields;
      this.state.profile = seededProfile;
      this.state.activeKeys = activeKeys;
      this.state.previewPage = 1;
      this.state.stamp = syncStampFromProfile(previousProfile, seededProfile, {
        ...this.state.stamp,
        date: seededProfile.date || this.state.stamp.date || todayInputValue(),
      });

      this.reapplyProfile();
      this.renderStatus();
      this.renderStampControls();
      this.renderPreviewMeta();
      await this.renderPreview();

      if (bundle.fields.length === 0) {
        this.setNotice(
          'No AcroForm fields were detected. Stamping still works, but non-fillable PDFs will need OCR and coordinate mapping later.',
          'neutral',
        );
      } else {
        this.setNotice(
          `Ready. Detected ${bundle.fields.length} fillable fields across ${bundle.pageCount} page${bundle.pageCount === 1 ? '' : 's'}.`,
          'success',
        );
      }
    } catch (error) {
      console.error(error);
      this.state.bundle = null;
      this.state.fields = [];
      this.state.stats = EMPTY_STATS;
      this.setNotice(
        'The PDF could not be parsed. Password-protected or malformed files need a separate handling path.',
        'error',
      );
      this.elements.previewFrame.classList.remove('is-loading', 'has-preview');
      this.renderSummary();
      this.renderProfileFields();
      this.renderFieldList();
      this.renderExportPanel();
      this.renderPreviewMeta();
    } finally {
      this.state.busy = false;
      this.renderControlState();
      this.renderStatus();
      this.renderExportPanel();
      this.renderPreviewMeta();
    }
  }

  private async handleStampImage(file: File): Promise<void> {
    const mime = file.type || inferImageMime(file.name);
    if (!mime || (!mime.includes('png') && !mime.includes('jpeg') && !mime.includes('jpg'))) {
      this.setNotice('Use a PNG or JPG stamp image.', 'error');
      this.renderStatus();
      return;
    }

    this.clearStampImage();
    this.state.stamp = {
      ...this.state.stamp,
      imageBytes: new Uint8Array(await file.arrayBuffer()),
      imageMime: mime,
      imageName: file.name,
    };
    this.state.stampImageUrl = URL.createObjectURL(file);
    this.renderStampControls();
  }

  private async handleExport(): Promise<void> {
    if (!this.state.bundle || this.state.busy) {
      return;
    }

    const sourceBytes = this.state.bundle.sourceBytes;
    const outputName = outputFileName(this.state.bundle.fileName);
    const fields = this.state.fields.map((field) => ({
      ...field,
      options: [...field.options],
    }));
    const stamp = cloneStampSettings(this.state.stamp);
    try {
      const { exportFilledPdf, downloadBlob } = await getPdfModule();
      this.state.busy = true;
      this.setNotice('Generating the stamped PDF locally...', 'busy');
      this.renderStatus();
      this.renderControlState();
      this.renderExportPanel();
      this.renderPreviewMeta();

      const blob = await exportFilledPdf(
        sourceBytes,
        fields,
        stamp,
      );
      this.setLastExport(blob, outputName);
      downloadBlob(blob, outputName);
      this.setNotice(
        'Export complete. If your browser blocked the automatic download, use the retry link below.',
        'success',
      );
    } catch (error) {
      console.error(error);
      this.setNotice('Export failed. Some PDFs have unusual field structures that need a custom fallback.', 'error');
    } finally {
      this.state.busy = false;
      this.renderControlState();
      this.renderStatus();
      this.renderExportPanel();
      this.renderPreviewMeta();
    }
  }

  private reapplyProfile(options: ReapplyRenderOptions = {}): void {
    if (!this.state.bundle) {
      return;
    }

    const {
      summary = true,
      profileFields = true,
      fieldList = true,
      exportPanel = true,
    } = options;

    const result = applyProfileToFields(
      this.state.fields.length ? this.state.fields : this.state.bundle.fields,
      this.state.profile,
      this.state.overwriteExisting,
    );

    this.state.fields = result.fields;
    this.state.stats = result.stats;
    if (summary) {
      this.renderSummary();
    }
    if (profileFields) {
      this.renderProfileFields();
    }
    if (fieldList) {
      this.renderFieldList();
    }
    if (exportPanel) {
      this.renderExportPanel();
    }
  }

  private renderAll(): void {
    this.renderControlState();
    this.renderStatus();
    this.renderSummary();
    this.renderProfileFields();
    this.renderStampControls();
    this.renderFieldList();
    this.renderExportPanel();
    this.renderPreviewMeta();
  }

  private renderStatus(): void {
    this.elements.status.className = `status is-${this.state.notice.tone}`;
    this.elements.status.textContent = this.state.notice.message;
  }

  private renderSummary(): void {
    const { bundle, stats } = this.state;

    if (!bundle) {
      this.updateContainerMarkup(this.elements.summary, `
        <article class="metric-card">
          <span class="metric-label">Privacy</span>
          <strong class="metric-value">No uploads</strong>
          <p class="metric-copy">Everything stays in browser memory until the tab closes.</p>
        </article>
        <article class="metric-card">
          <span class="metric-label">Best fit</span>
          <strong class="metric-value">Fillable PDFs</strong>
          <p class="metric-copy">This first pass targets AcroForm documents for speed and reliability.</p>
        </article>
        <article class="metric-card">
          <span class="metric-label">Export</span>
          <strong class="metric-value">Download a copy</strong>
          <p class="metric-copy">You decide when to delete the working file.</p>
        </article>
      `);
      return;
    }

    this.updateContainerMarkup(this.elements.summary, `
      <article class="metric-card">
        <span class="metric-label">Pages</span>
        <strong class="metric-value">${bundle.pageCount}</strong>
        <p class="metric-copy">${escapeHtml(bundle.fileName)}</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Detected fields</span>
        <strong class="metric-value">${bundle.fields.length}</strong>
        <p class="metric-copy">${stats.matchedCount} mapped to shared details</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Auto-filled</span>
        <strong class="metric-value">${stats.autofilledCount}</strong>
        <p class="metric-copy">${stats.remainingCount} still need a manual check</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Storage</span>
        <strong class="metric-value">Ephemeral</strong>
        <p class="metric-copy">No backend, no sync, no persistence unless you download the result.</p>
      </article>
    `);
  }

  private renderProfileFields(): void {
    if (!this.state.bundle) {
      this.updateContainerMarkup(this.elements.profileFields, `
        <div class="empty-block">
          <p>Shared details appear here after a PDF is loaded.</p>
          <p class="subtle-copy">The app shows only the details it thinks the form needs, plus a few useful defaults.</p>
        </div>
      `);
      return;
    }

    const inputs = this.state.activeKeys
      .map((key) => {
        const definition = getProfileFieldDefinition(key);
        const disabledAttr = this.state.busy ? 'disabled' : '';
        const inputType =
          key === 'date'
            ? 'date'
            : key === 'email'
              ? 'email'
              : key.includes('phone')
                ? 'tel'
                : 'text';
        const value = this.state.profile[key] ?? '';
        return `
          <label class="stack-field">
            <span class="field-heading">${escapeHtml(definition.label)}</span>
            <input
              data-profile-key="${key}"
              type="${inputType}"
              value="${escapeAttribute(value)}"
              placeholder="${escapeAttribute(definition.placeholder)}"
              ${disabledAttr}
            />
            <span class="field-help">${escapeHtml(definition.helper)}</span>
          </label>
        `;
      })
      .join('');

    this.updateContainerMarkup(this.elements.profileFields, `
      <div class="section-copy">
        One edit here can cascade across matching PDF fields. Toggle overwrite if you want these values to replace pre-filled data already in the document.
      </div>
      ${inputs}
    `);
  }

  private renderStampControls(): void {
    const stamp = this.state.stamp;
    const rows = buildStampRows(stamp);
    const disabledAttr = this.state.busy ? 'disabled' : '';

    this.updateContainerMarkup(this.elements.stampControls, `
      <div class="stamp-preview ${stamp.mode === 'image' ? 'is-image-only' : ''}">
        ${
          this.state.stampImageUrl && (stamp.mode === 'image' || stamp.mode === 'both')
            ? `<img class="stamp-preview-image" src="${this.state.stampImageUrl}" alt="Stamp preview" />`
            : ''
        }
        ${
          stamp.mode === 'image' && this.state.stampImageUrl
            ? ''
            : `
              <div class="stamp-table-preview">
                ${rows.map((row) => renderStampPreviewRow(row.label, row.value, row.emphasis)).join('')}
              </div>
            `
        }
      </div>
      <div class="stamp-grid">
        <label class="stack-field compact-field">
          <span class="field-heading">Mode</span>
          <select data-stamp-key="mode" ${disabledAttr}>
            ${selectOption('text', 'Table stamp', stamp.mode)}
            ${selectOption('image', 'Image only', stamp.mode)}
            ${selectOption('both', 'Image + table', stamp.mode)}
          </select>
        </label>
        <label class="stack-field compact-field">
          <span class="field-heading">Placement</span>
          <select data-stamp-key="placement" ${disabledAttr}>
            ${selectOption('last-page', 'Last page', stamp.placement)}
            ${selectOption('every-page', 'Every page', stamp.placement)}
          </select>
        </label>
        <label class="stack-field compact-field">
          <span class="field-heading">Alignment</span>
          <select data-stamp-key="alignment" ${disabledAttr}>
            ${selectOption('left', 'Left', stamp.alignment)}
            ${selectOption('center', 'Center', stamp.alignment)}
            ${selectOption('right', 'Right', stamp.alignment)}
          </select>
        </label>
        <label class="stack-field compact-field">
          <span class="field-heading">Stamp date</span>
          <input data-stamp-key="date" type="date" value="${escapeAttribute(stamp.date)}" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Payee</span>
          <input data-stamp-key="payee" type="text" value="${escapeAttribute(stamp.payee)}" placeholder="Recipient or payee" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Total amount payable</span>
          <input data-stamp-key="totalAmount" type="text" value="${escapeAttribute(stamp.totalAmount)}" placeholder="$7,516.30" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">GST amount</span>
          <input data-stamp-key="gstAmount" type="text" value="${escapeAttribute(stamp.gstAmount)}" placeholder="$683.30" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Movement No</span>
          <input data-stamp-key="movementNumber" type="text" value="${escapeAttribute(stamp.movementNumber)}" placeholder="202603/01" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Signed by</span>
          <input data-stamp-key="signedBy" type="text" value="${escapeAttribute(stamp.signedBy)}" placeholder="Primary approver" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Co-signed by / Claims Manager</span>
          <input data-stamp-key="coSignedBy" type="text" value="${escapeAttribute(stamp.coSignedBy)}" placeholder="Secondary approver" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Approved by 1</span>
          <input data-stamp-key="approvedBy1" type="text" value="${escapeAttribute(stamp.approvedBy1)}" placeholder="Approver name" ${disabledAttr} />
        </label>
        <label class="stack-field">
          <span class="field-heading">Approved by 2</span>
          <input data-stamp-key="approvedBy2" type="text" value="${escapeAttribute(stamp.approvedBy2)}" placeholder="Approver name" ${disabledAttr} />
        </label>
        <label class="stack-field stack-span-full">
          <span class="field-heading">Optional image stamp</span>
          <input type="file" accept="image/png,image/jpeg" ${disabledAttr} />
          <span class="field-help">PNG or JPG only. Useful if you want the exact physical stamp artwork layered under or over the table.</span>
        </label>
        ${
          stamp.imageName
            ? `<div class="stamp-image-meta stack-span-full">
                <span>Loaded image: ${escapeHtml(stamp.imageName)}</span>
                <button type="button" class="quiet-button" data-action="clear-stamp-image" ${disabledAttr}>Remove image</button>
              </div>`
            : ''
        }
        <label class="toggle stack-span-full">
          <input data-stamp-key="flatten" type="checkbox" ${stamp.flatten ? 'checked' : ''} ${disabledAttr} />
          Flatten form fields after export
        </label>
      </div>
    `);
  }

  private renderFieldList(): void {
    if (!this.state.bundle) {
      this.updateContainerMarkup(this.elements.fieldList, `
        <div class="empty-block">
          <p>No PDF loaded yet.</p>
          <p class="subtle-copy">Once the document is parsed, every fillable field appears here for manual cleanup.</p>
        </div>
      `);
      return;
    }

    if (this.state.fields.length === 0) {
      this.updateContainerMarkup(this.elements.fieldList, `
        <div class="empty-block">
          <p>No fillable AcroForm fields were found in this PDF.</p>
          <p class="subtle-copy">Stamping still works. OCR-based field placement can be added later for scanned forms.</p>
        </div>
      `);
      return;
    }

    const rows = this.state.fields.map((field) => {
      const mappingLabel = field.semanticKey
        ? getProfileFieldDefinition(field.semanticKey).label
        : 'Manual only';
      const stateBadge = field.dirty
        ? '<span class="pill is-manual">manual</span>'
        : field.autoFilled
          ? '<span class="pill is-auto">auto</span>'
          : '';
      return `
        <article class="pdf-field ${field.autoFilled ? 'is-autofilled' : ''}">
          <div class="pdf-field-meta">
            <div>
              <strong>${escapeHtml(field.label)}</strong>
              <div class="field-name">${escapeHtml(field.name)}</div>
            </div>
            <div class="field-pill-row">
              <span class="pill">${escapeHtml(field.kind)}</span>
              <span class="pill">${escapeHtml(mappingLabel)}</span>
              ${stateBadge}
            </div>
          </div>
          <div class="pdf-field-control">
            ${renderFieldControl(field, this.state.busy)}
          </div>
        </article>
      `;
    }).join('');

    this.updateContainerMarkup(this.elements.fieldList, rows);
  }

  private renderExportPanel(): void {
    const disabled = !this.state.bundle || this.state.busy;
    const nextOutputName = this.state.bundle ? outputFileName(this.state.bundle.fileName) : 'your-file-stamped.pdf';
    const retryLink =
      this.state.lastExportUrl && this.state.lastExportName
        ? `
          <a class="export-retry-link" href="${this.state.lastExportUrl}" download="${escapeAttribute(this.state.lastExportName)}" target="_blank" rel="noopener">
            Save latest export again
          </a>
        `
        : '';
    this.updateContainerMarkup(this.elements.exportPanel, `
      <div class="export-card">
        <div>
          <h3>Export a local copy</h3>
          <p>The source file stays untouched. You download a fresh PDF with the filled fields and stamp baked in.</p>
          <p class="subtle-copy">Output: ${escapeHtml(nextOutputName)}</p>
          ${retryLink}
        </div>
        <button type="button" class="export-button" data-action="export-pdf" ${disabled ? 'disabled' : ''}>
          ${this.state.busy ? 'Working...' : 'Download stamped PDF'}
        </button>
      </div>
    `);
  }

  private renderPreviewMeta(): void {
    if (!this.state.bundle) {
      this.elements.previewPageLabel.textContent = 'No preview';
      this.elements.previewFileMeta.textContent = 'Drop a PDF to render the first page.';
      this.elements.prevPageButton.disabled = true;
      this.elements.nextPageButton.disabled = true;
      this.elements.previewFrame.classList.remove('is-loading', 'has-preview');
      this.elements.previewCanvas.hidden = true;
      this.elements.previewHint.hidden = false;
      this.elements.previewHint.textContent = 'PDF preview will appear here';
      return;
    }

    this.elements.previewPageLabel.textContent = `Page ${this.state.previewPage} / ${this.state.bundle.pageCount}`;
    this.elements.previewFileMeta.textContent = `${this.state.bundle.fields.length} detected field${this.state.bundle.fields.length === 1 ? '' : 's'}`;
    this.elements.prevPageButton.disabled = this.state.previewPage <= 1 || this.state.busy;
    this.elements.nextPageButton.disabled = this.state.previewPage >= this.state.bundle.pageCount || this.state.busy;
  }

  private async renderPreview(): Promise<void> {
    const bundle = this.state.bundle;
    if (!bundle) {
      return;
    }

    const renderToken = ++this.previewToken;
    const hadPreview = this.elements.previewFrame.classList.contains('has-preview');
    this.elements.previewFrame.classList.add('is-loading');
    this.elements.previewHint.hidden = false;
    this.elements.previewHint.textContent = hadPreview
      ? 'Rendering the selected page...'
      : 'Rendering page preview...';

    try {
      const { renderPreviewPage } = await getPdfModule();
      await renderPreviewPage(bundle.previewDocument, this.state.previewPage, this.elements.previewCanvas);
      if (renderToken !== this.previewToken) {
        return;
      }
      this.elements.previewCanvas.hidden = false;
      this.elements.previewFrame.classList.add('has-preview');
      this.elements.previewHint.hidden = true;
    } catch (error) {
      console.error(error);
      if (renderToken !== this.previewToken) {
        return;
      }
      if (!hadPreview) {
        this.elements.previewCanvas.hidden = true;
        this.elements.previewFrame.classList.remove('has-preview');
      }
      this.elements.previewHint.hidden = false;
      this.elements.previewHint.textContent = 'Preview failed for this page';
    } finally {
      if (renderToken === this.previewToken) {
        this.elements.previewFrame.classList.remove('is-loading');
      }
    }
  }

  private setNotice(message: string, tone: NoticeState['tone']): void {
    this.state.notice = { message, tone };
  }

  private async releasePreviewDocument(): Promise<void> {
    if (!this.state.bundle) {
      return;
    }

    try {
      await this.state.bundle.previewDocument.destroy();
    } catch {
      // Ignore preview teardown issues while swapping files.
    }
  }

  private clearStampImage(): void {
    if (this.state.stampImageUrl) {
      URL.revokeObjectURL(this.state.stampImageUrl);
    }

    this.state.stampImageUrl = null;
    this.state.stamp = {
      ...this.state.stamp,
      imageBytes: null,
      imageMime: null,
      imageName: null,
    };
  }

  private setLastExport(blob: Blob, fileName: string): void {
    this.clearLastExport();
    this.state.lastExportUrl = URL.createObjectURL(blob);
    this.state.lastExportName = fileName;
  }

  private clearLastExport(): void {
    if (this.state.lastExportUrl) {
      URL.revokeObjectURL(this.state.lastExportUrl);
    }

    this.state.lastExportUrl = null;
    this.state.lastExportName = null;
  }

  private schedulePreviewRender(): void {
    if (this.previewResizeFrame !== null) {
      window.cancelAnimationFrame(this.previewResizeFrame);
    }

    this.previewResizeFrame = window.requestAnimationFrame(() => {
      this.previewResizeFrame = null;
      if (this.state.bundle && !this.state.busy) {
        void this.renderPreview();
      }
    });
  }

  private updateContainerMarkup(container: HTMLElement, markup: string): void {
    if (container.innerHTML === markup) {
      return;
    }

    const renderState = captureContainerRenderState(container);
    container.innerHTML = markup;
    restoreContainerRenderState(container, renderState);
  }

  private renderControlState(): void {
    this.elements.dropzone.disabled = this.state.busy;
    this.elements.dropzone.setAttribute('aria-busy', String(this.state.busy));
    this.elements.overwriteToggle.disabled = this.state.busy || !this.state.bundle;
  }

  private showPreviewHint(message: string): void {
    this.elements.previewFrame.classList.add('is-loading');
    this.elements.previewHint.hidden = false;
    this.elements.previewHint.textContent = message;
  }
}

function shellMarkup(): string {
  return `
    <div class="app-shell">
      <header class="hero">
        <div class="hero-copy-wrap">
          <p class="eyebrow">Local-first PDF workflow</p>
          <h1>Drop in a PDF, prefill the obvious bits, stamp it, and save a fresh copy.</h1>
          <p class="hero-copy">
            Built for repetitive admin forms. No dashboard, no queue, no server-side storage. Just a fast browser pass over a PDF and a download button.
          </p>
        </div>
        <div class="privacy-banner">Ephemeral by default</div>
      </header>

      <main class="workspace">
        <section class="panel intake-panel">
          <div class="panel-head">
            <div>
              <p class="section-tag">Start here</p>
              <h2>Load a PDF</h2>
            </div>
            <p class="subtle-copy">Drag and drop or pick a file.</p>
          </div>
          <button type="button" id="dropzone" class="dropzone">
            <span class="dropzone-title">Drop a PDF anywhere in this panel</span>
            <span class="dropzone-copy">or click to choose one from disk</span>
            <span class="dropzone-note">Nothing is uploaded. The PDF stays in this tab until you export.</span>
          </button>
          <input id="file-input" type="file" accept="application/pdf,.pdf" hidden />
          <div id="status" class="status"></div>
          <div id="summary" class="metric-grid"></div>
        </section>

        <section class="panel preview-panel">
          <div class="panel-head">
            <div>
              <p class="section-tag">Preview</p>
              <h2>Page render</h2>
            </div>
            <div class="preview-meta-wrap">
              <span id="preview-file-meta" class="subtle-copy">Drop a PDF to render the first page.</span>
              <div class="preview-nav">
                <button id="prev-page-button" class="nav-button" type="button">Prev</button>
                <span id="preview-page-label">No preview</span>
                <button id="next-page-button" class="nav-button" type="button">Next</button>
              </div>
            </div>
          </div>
          <div id="preview-frame" class="preview-frame">
            <canvas id="preview-canvas" hidden></canvas>
            <div id="preview-hint" class="preview-hint">PDF preview will appear here</div>
          </div>
        </section>

        <section class="panel editor-panel">
          <section class="editor-section">
            <div class="panel-head compact-head">
              <div>
                <p class="section-tag">Shared details</p>
                <h2>Auto-fill inputs</h2>
              </div>
              <label class="toggle">
                <input id="overwrite-toggle" type="checkbox" />
                Overwrite values already in the PDF
              </label>
            </div>
            <div id="profile-fields" class="stack-form"></div>
          </section>

          <section class="editor-section">
            <div class="panel-head compact-head">
              <div>
                <p class="section-tag">Stamp</p>
                <h2>Bottom-of-page mark</h2>
              </div>
              <p class="subtle-copy">Approval table, image stamp, or both.</p>
            </div>
            <div id="stamp-controls"></div>
          </section>

          <section class="editor-section">
            <div class="panel-head compact-head">
              <div>
                <p class="section-tag">Cleanup</p>
                <h2>Detected PDF fields</h2>
              </div>
              <p class="subtle-copy">Manual overrides stay put.</p>
            </div>
            <div id="field-list" class="field-list"></div>
          </section>

          <section class="editor-section export-section">
            <div id="export-panel"></div>
          </section>
        </section>
      </main>
    </div>
  `;
}

function defaultStampSettings(): StampSettings {
  return {
    mode: 'text',
    payee: '',
    totalAmount: '',
    gstAmount: '',
    movementNumber: '',
    signedBy: '',
    coSignedBy: '',
    approvedBy1: '',
    approvedBy2: '',
    date: todayInputValue(),
    placement: 'last-page',
    alignment: 'right',
    flatten: false,
    imageBytes: null,
    imageMime: null,
    imageName: null,
  };
}

function buildStampRows(stamp: StampSettings): Array<{ label: string; value: string; emphasis?: boolean }> {
  return [
    { label: 'PAYEE', value: stamp.payee },
    { label: 'TOTAL AMOUNT\nPAYABLE', value: stamp.totalAmount, emphasis: true },
    { label: 'GST Amount', value: stamp.gstAmount },
    { label: 'Movement No', value: stamp.movementNumber },
    { label: 'Signed by :', value: stamp.signedBy },
    { label: 'Co-signed by -\nClaims Manager', value: stamp.coSignedBy },
    { label: 'Approved by 1', value: stamp.approvedBy1 },
    { label: 'Approved by 2', value: stamp.approvedBy2 },
  ];
}

function renderStampPreviewRow(label: string, value: string, emphasis = false): string {
  const labelHtml = escapeHtml(label).replace(/\n/g, '<br />');
  const valueClass = emphasis ? 'stamp-table-value is-emphasis' : 'stamp-table-value';
  return `
    <div class="stamp-table-row">
      <div class="stamp-table-label">${labelHtml}</div>
      <div class="${valueClass}">${escapeHtml(value)}</div>
    </div>
  `;
}

function derivePayeeFromProfile(profile: ProfileValues): string {
  return profile.company || profile.fullName || '';
}

function deriveSignerFromProfile(profile: ProfileValues): string {
  return profile.signatureName || profile.fullName || '';
}

function syncStampFromProfile(
  previousProfile: ProfileValues,
  nextProfile: ProfileValues,
  stamp: StampSettings,
): StampSettings {
  const previousPayee = derivePayeeFromProfile(previousProfile);
  const nextPayee = derivePayeeFromProfile(nextProfile);
  const previousSignedBy = deriveSignerFromProfile(previousProfile);
  const nextSignedBy = deriveSignerFromProfile(nextProfile);
  const previousMovement = previousProfile.reference || '';
  const nextMovement = nextProfile.reference || '';

  return {
    ...stamp,
    payee: shouldSyncStamp(stamp.payee, previousPayee) ? nextPayee : stamp.payee,
    signedBy: shouldSyncStamp(stamp.signedBy, previousSignedBy) ? nextSignedBy : stamp.signedBy,
    movementNumber: shouldSyncStamp(stamp.movementNumber, previousMovement)
      ? nextMovement
      : stamp.movementNumber,
    date: nextProfile.date || stamp.date,
  };
}

function renderFieldControl(field: PdfFieldModel, disabled: boolean): string {
  const disabledAttr = disabled ? 'disabled' : '';
  if (!isEditableField(field)) {
    return '<div class="readonly-field">Unsupported by this first pass</div>';
  }

  if (field.kind === 'checkbox') {
    return `
      <label class="checkbox-field">
        <input data-field-id="${field.id}" type="checkbox" ${field.value === true ? 'checked' : ''} ${disabledAttr} />
        Tick this box
      </label>
    `;
  }

  if (field.kind === 'dropdown' || field.kind === 'radio' || field.kind === 'option-list') {
    return `
      <select data-field-id="${field.id}" ${disabledAttr}>
        <option value="">Leave blank</option>
        ${field.options.map((option) => {
          const selected = field.value === option ? 'selected' : '';
          return `<option value="${escapeAttribute(option)}" ${selected}>${escapeHtml(option)}</option>`;
        }).join('')}
      </select>
    `;
  }

  return `<input data-field-id="${field.id}" type="text" value="${escapeAttribute(typeof field.value === 'string' ? field.value : '')}" ${disabledAttr} />`;
}

function shouldSyncStamp(currentStampValue: string, previousProfileValue: string): boolean {
  return !currentStampValue || currentStampValue === previousProfileValue;
}

function cloneStampSettings(stamp: StampSettings): StampSettings {
  return {
    ...stamp,
    imageBytes: stamp.imageBytes ? new Uint8Array(stamp.imageBytes) : null,
  };
}

function selectOption(value: string, label: string, selectedValue: string): string {
  return `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`;
}

function inferImageMime(fileName: string): string | null {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith('.png')) {
    return 'image/png';
  }
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return null;
}

function outputFileName(fileName: string): string {
  const baseName = fileName.replace(/\.pdf$/i, '');
  return `${baseName || 'document'}-stamped.pdf`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function captureContainerRenderState(container: HTMLElement): ContainerRenderState {
  const activeElement = document.activeElement;
  const focusTarget =
    activeElement instanceof HTMLElement && container.contains(activeElement)
      ? activeElement
      : null;

  return {
    focusSelector: focusTarget ? selectorForElement(focusTarget) : null,
    selectionStart: hasTextSelection(focusTarget) ? focusTarget.selectionStart : null,
    selectionEnd: hasTextSelection(focusTarget) ? focusTarget.selectionEnd : null,
    scrollTop: container.scrollTop,
    scrollLeft: container.scrollLeft,
  };
}

function restoreContainerRenderState(
  container: HTMLElement,
  state: ContainerRenderState,
): void {
  container.scrollTop = state.scrollTop;
  container.scrollLeft = state.scrollLeft;

  if (!state.focusSelector) {
    return;
  }

  const nextFocusTarget = container.querySelector<HTMLElement>(state.focusSelector);
  if (!nextFocusTarget) {
    return;
  }

  if (
    ('disabled' in nextFocusTarget && nextFocusTarget.disabled) ||
    nextFocusTarget.getAttribute('aria-disabled') === 'true'
  ) {
    return;
  }

  nextFocusTarget.focus({ preventScroll: true });

  if (!hasTextSelection(nextFocusTarget)) {
    return;
  }

  if (state.selectionStart === null || state.selectionEnd === null) {
    return;
  }

  try {
    nextFocusTarget.setSelectionRange(state.selectionStart, state.selectionEnd);
  } catch {
    // Inputs like date do not support text selection restoration.
  }
}

function selectorForElement(element: HTMLElement): string | null {
  const fieldId = element.dataset.fieldId;
  if (fieldId) {
    return `[data-field-id="${escapeSelector(fieldId)}"]`;
  }

  const profileKey = element.dataset.profileKey;
  if (profileKey) {
    return `[data-profile-key="${escapeSelector(profileKey)}"]`;
  }

  const stampKey = element.dataset.stampKey;
  if (stampKey) {
    return `[data-stamp-key="${escapeSelector(stampKey)}"]`;
  }

  if (element.id) {
    return `#${escapeSelector(element.id)}`;
  }

  return null;
}

function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, '\\$&');
}

function hasTextSelection(
  element: HTMLElement | null,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  return element instanceof HTMLInputElement && !['checkbox', 'date', 'file'].includes(element.type);
}
