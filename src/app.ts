import {
  applyProfileToFields,
  getProfileFieldDefinition,
  isEditableField,
  pickActiveProfileKeys,
  seedProfileValues,
  todayInputValue,
} from './heuristics';
import type { LoadedPdfBundle } from './pdf';
import {
  buildStampRows,
  isStampPlaced,
  shouldShowStampImage,
  shouldShowStampOnPage,
  shouldShowStampTable,
  syncStampFromProfile,
} from './stamp';
import type {
  DocumentPageModel,
  FillStats,
  PageSize,
  PdfFieldModel,
  ProfileValues,
  SemanticKey,
  StampPlacement,
  StampSettings,
} from './types';

interface NoticeState {
  tone: 'neutral' | 'busy' | 'success' | 'error';
  message: string;
}

interface AppState {
  bundle: LoadedPdfBundle | null;
  pages: DocumentPageModel[];
  fields: PdfFieldModel[];
  profile: ProfileValues;
  activeKeys: SemanticKey[];
  stats: FillStats;
  stamp: StampSettings;
  stampSelected: boolean;
  overwriteExisting: boolean;
  previewPageId: string | null;
  notice: NoticeState;
  loadingPdf: boolean;
  exporting: boolean;
  stampImageUrl: string | null;
  lastExportUrl: string | null;
  lastExportName: string | null;
  advancedOpen: boolean;
  blankInsertMode: 'after-current' | 'at-end';
}

interface AppElements {
  studioShell: HTMLElement;
  topbar: HTMLElement;
  fileInput: HTMLInputElement;
  uploadButton: HTMLButtonElement;
  addBlankPageButton: HTMLButtonElement;
  exportActions: HTMLElement;
  status: HTMLElement;
  stampControls: HTMLElement;
  profileFields: HTMLElement;
  fieldList: HTMLElement;
  overwriteToggle: HTMLInputElement;
  previewFrame: HTMLElement;
  previewCanvas: HTMLCanvasElement;
  previewEmpty: HTMLElement;
  previewHint: HTMLElement;
  previewStamp: HTMLElement;
  previewGuides: HTMLElement;
  previewPageLabel: HTMLElement;
  previewFileMeta: HTMLElement;
  prevPageButton: HTMLButtonElement;
  nextPageButton: HTMLButtonElement;
  thumbnailRail: HTMLElement;
  advancedSheet: HTMLElement;
}

interface ReapplyRenderOptions {
  profileFields?: boolean;
  fieldList?: boolean;
}

interface ContainerRenderState {
  focusSelector: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollTop: number;
  scrollLeft: number;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface StampInteraction {
  kind: 'drag' | 'resize' | 'rotate';
  handle?: ResizeHandle;
  startClientX: number;
  startClientY: number;
  stageRect: DOMRect;
  startPlacement: StampPlacement;
  startWidthPx: number;
  startHeightPx: number;
}

const EMPTY_STATS: FillStats = {
  autofilledCount: 0,
  remainingCount: 0,
  editableCount: 0,
  matchedCount: 0,
};

const STAMP_MIN_WIDTH_RATIO = 0.2;
const STAMP_MAX_WIDTH_RATIO = 0.88;
const STAMP_SNAP_THRESHOLD = 0.02;

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
  private blankPageSerial = 0;
  private stampInteraction: StampInteraction | null = null;
  private suppressNextPreviewClick = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = shellMarkup();
    this.elements = {
      studioShell: this.root.querySelector<HTMLElement>('.studio-shell')!,
      topbar: this.root.querySelector<HTMLElement>('#topbar')!,
      fileInput: this.root.querySelector<HTMLInputElement>('#file-input')!,
      uploadButton: this.root.querySelector<HTMLButtonElement>('#upload-button')!,
      addBlankPageButton: this.root.querySelector<HTMLButtonElement>('#add-blank-page-button')!,
      exportActions: this.root.querySelector<HTMLElement>('#export-actions')!,
      status: this.root.querySelector<HTMLElement>('#status')!,
      stampControls: this.root.querySelector<HTMLElement>('#stamp-controls')!,
      profileFields: this.root.querySelector<HTMLElement>('#profile-fields')!,
      fieldList: this.root.querySelector<HTMLElement>('#field-list')!,
      overwriteToggle: this.root.querySelector<HTMLInputElement>('#overwrite-toggle')!,
      previewFrame: this.root.querySelector<HTMLElement>('#preview-frame')!,
      previewCanvas: this.root.querySelector<HTMLCanvasElement>('#preview-canvas')!,
      previewEmpty: this.root.querySelector<HTMLElement>('#preview-empty')!,
      previewHint: this.root.querySelector<HTMLElement>('#preview-hint')!,
      previewStamp: this.root.querySelector<HTMLElement>('#preview-stamp')!,
      previewGuides: this.root.querySelector<HTMLElement>('#preview-guides')!,
      previewPageLabel: this.root.querySelector<HTMLElement>('#preview-page-label')!,
      previewFileMeta: this.root.querySelector<HTMLElement>('#preview-file-meta')!,
      prevPageButton: this.root.querySelector<HTMLButtonElement>('#prev-page-button')!,
      nextPageButton: this.root.querySelector<HTMLButtonElement>('#next-page-button')!,
      thumbnailRail: this.root.querySelector<HTMLElement>('#thumbnail-rail')!,
      advancedSheet: this.root.querySelector<HTMLElement>('#advanced-sheet')!,
    };

    this.state = {
      bundle: null,
      pages: [],
      fields: [],
      profile: {
        date: todayInputValue(),
      },
      activeKeys: ['fullName', 'email', 'phone', 'reference', 'date'],
      stats: EMPTY_STATS,
      stamp: defaultStampSettings(),
      stampSelected: false,
      overwriteExisting: false,
      previewPageId: null,
      notice: {
        tone: 'neutral',
        message: 'Upload a PDF, click once to place the stamp, then drag, resize, or rotate it.',
      },
      loadingPdf: false,
      exporting: false,
      stampImageUrl: null,
      lastExportUrl: null,
      lastExportName: null,
      advancedOpen: false,
      blankInsertMode: 'after-current',
    };

    this.bindEvents();
    this.renderAll();
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action) {
        return;
      }

      if (action === 'choose-file') {
        if (!this.state.loadingPdf) {
          this.elements.fileInput.click();
        }
        return;
      }

      if (action === 'add-blank-page') {
        this.addBlankPage();
        return;
      }

      if (action === 'export-pdf') {
        void this.handleExport();
        return;
      }

      if (action === 'open-advanced') {
        this.state.advancedOpen = true;
        this.renderAdvancedSheetVisibility();
        return;
      }

      if (action === 'close-advanced') {
        this.state.advancedOpen = false;
        this.renderAdvancedSheetVisibility();
        return;
      }

      if (action === 'clear-stamp-image') {
        this.invalidateLastExport();
        this.clearStampImage();
        this.renderStampControls();
        this.renderPreviewStamp();
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

    this.elements.previewFrame.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = this.state.loadingPdf ? 'none' : 'copy';
      }
      if (!this.state.loadingPdf) {
        this.elements.previewFrame.classList.add('is-dragging');
      }
    });

    this.elements.previewFrame.addEventListener('dragleave', () => {
      this.elements.previewFrame.classList.remove('is-dragging');
    });

    this.elements.previewFrame.addEventListener('drop', (event) => {
      event.preventDefault();
      this.elements.previewFrame.classList.remove('is-dragging');
      if (this.state.loadingPdf) {
        return;
      }

      const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
      const file = droppedFiles.find((candidate) =>
        candidate.name.toLowerCase().endsWith('.pdf'),
      );
      if (file) {
        void this.handlePdf(file);
        return;
      }

      if (droppedFiles.length > 0) {
        this.setNotice('Drop a PDF file to load it here.', 'error');
        this.renderStatus();
      }
    });

    this.elements.previewFrame.addEventListener('click', (event) => {
      if (this.suppressNextPreviewClick) {
        this.suppressNextPreviewClick = false;
        return;
      }

      if (!this.state.bundle || this.state.loadingPdf) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest('#preview-stamp')) {
        return;
      }

      const currentPage = this.getCurrentPage();
      const stageRect = this.getPreviewStageRect();
      if (!currentPage || !stageRect) {
        return;
      }

      const placement = placementFromPointer(
        currentPage.id,
        event.clientX,
        event.clientY,
        stageRect,
        this.state.stamp.placement.width,
      );
      this.state.stamp = {
        ...this.state.stamp,
        placement,
      };
      this.state.stampSelected = true;
      this.invalidateLastExport();
      this.renderStampControls();
      this.renderPreviewStamp();
    });

    this.elements.previewStamp.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!target.closest('.preview-stamp-object')) {
        return;
      }

      if (!this.state.stampSelected) {
        this.state.stampSelected = true;
        this.renderStampControls();
        this.renderPreviewStamp();
      }
    });

    this.elements.previewStamp.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      const key = target.dataset.stampKey as keyof StampSettings | undefined;
      if (!key || !isStampValueKey(key)) {
        return;
      }

      this.state.stamp = {
        ...this.state.stamp,
        [key]: target.value,
      };
      this.invalidateLastExport();
    });

    this.elements.previewStamp.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!this.state.bundle || !isStampPlaced(this.state.stamp)) {
        return;
      }

      const handle = target.closest<HTMLElement>('[data-stamp-handle]')?.dataset.stampHandle as ResizeHandle | undefined;
      const rotateHandle = target.closest<HTMLElement>('[data-stamp-action="rotate-stamp"]');
      const stampCard = target.closest<HTMLElement>('.preview-stamp-object');

      if (!handle && !rotateHandle && target.closest('input, select, textarea, button')) {
        return;
      }

      if (!rotateHandle && !handle && !stampCard) {
        return;
      }

      if (!this.state.stampSelected) {
        this.state.stampSelected = true;
        this.renderStampControls();
        this.renderPreviewStamp();
      }

      const stageRect = this.getPreviewStageRect();
      const stampBody = this.elements.previewStamp.querySelector<HTMLElement>('.preview-stamp-body');
      if (!stageRect || !stampBody) {
        return;
      }

      event.preventDefault();
      const kind: StampInteraction['kind'] =
        rotateHandle ? 'rotate' : handle ? 'resize' : 'drag';
      this.stampInteraction = {
        kind,
        handle,
        startClientX: event.clientX,
        startClientY: event.clientY,
        stageRect,
        startPlacement: { ...this.state.stamp.placement },
        startWidthPx: stampBody.offsetWidth,
        startHeightPx: stampBody.offsetHeight,
      };

      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
    });

    this.elements.stampControls.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      if (target instanceof HTMLInputElement && target.type === 'file') {
        return;
      }

      const stampSetting = target.dataset.stampSetting as keyof StampSettings | undefined;
      if (stampSetting) {
        const nextValue =
          target instanceof HTMLInputElement && target.type === 'checkbox'
            ? target.checked
            : target.value;
        this.state.stamp = {
          ...this.state.stamp,
          [stampSetting]: nextValue,
        };
        this.invalidateLastExport();
        this.renderStampControls();
        this.renderPreviewStamp();
        return;
      }

      const uiSetting = target.dataset.uiSetting;
      if (uiSetting === 'blank-insert-mode') {
        this.state.blankInsertMode = target.value === 'at-end' ? 'at-end' : 'after-current';
        this.renderStampControls();
      }
    });

    this.elements.stampControls.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') {
        return;
      }

      const file = target.files?.[0];
      if (file) {
        void this.handleStampImage(file);
      }
    });

    this.elements.overwriteToggle.addEventListener('change', () => {
      this.invalidateLastExport();
      this.state.overwriteExisting = this.elements.overwriteToggle.checked;
      this.reapplyProfile();
    });

    this.elements.profileFields.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
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

      this.invalidateLastExport();
      this.state.profile = nextProfile;
      this.state.stamp = syncStampFromProfile(previousProfile, nextProfile, this.state.stamp);
      this.reapplyProfile({ profileFields: false });
      this.renderPreviewStamp();
    });

    const onFieldEdit = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
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

      this.invalidateLastExport();
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
      this.renderPreviewStamp();
    };

    this.elements.fieldList.addEventListener('input', onFieldEdit);
    this.elements.fieldList.addEventListener('change', onFieldEdit);

    this.elements.prevPageButton.addEventListener('click', () => {
      const currentIndex = this.getCurrentPageIndex();
      if (currentIndex <= 0) {
        return;
      }

      this.state.previewPageId = this.state.pages[currentIndex - 1]?.id ?? null;
      this.state.stampSelected = false;
      this.renderControlState();
      this.renderStampControls();
      this.renderThumbnailRail();
      this.renderPreviewMeta();
      void this.renderPreview();
    });

    this.elements.nextPageButton.addEventListener('click', () => {
      const currentIndex = this.getCurrentPageIndex();
      if (currentIndex === -1 || currentIndex >= this.state.pages.length - 1) {
        return;
      }

      this.state.previewPageId = this.state.pages[currentIndex + 1]?.id ?? null;
      this.state.stampSelected = false;
      this.renderControlState();
      this.renderStampControls();
      this.renderThumbnailRail();
      this.renderPreviewMeta();
      void this.renderPreview();
    });

    this.elements.thumbnailRail.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const pageId = target.closest<HTMLElement>('[data-page-id]')?.dataset.pageId;
      if (!pageId) {
        return;
      }

      this.state.previewPageId = pageId;
      this.state.stampSelected = false;
      this.renderControlState();
      this.renderStampControls();
      this.renderThumbnailRail();
      this.renderPreviewMeta();
      void this.renderPreview();
    });

    window.addEventListener('resize', () => {
      if (this.state.bundle) {
        this.schedulePreviewRender();
      }
    });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const interaction = this.stampInteraction;
    if (!interaction || !isStampPlaced(this.state.stamp)) {
      return;
    }

    const { stageRect } = interaction;
    const startCenterX = interaction.startPlacement.x * stageRect.width;
    const startCenterY = interaction.startPlacement.y * stageRect.height;

    if (interaction.kind === 'drag') {
      const halfWidth = interaction.startWidthPx / 2;
      const halfHeight = interaction.startHeightPx / 2;
      const nextCenterX = startCenterX + (event.clientX - interaction.startClientX);
      const nextCenterY = startCenterY + (event.clientY - interaction.startClientY);
      this.updatePlacementFromPixels(nextCenterX, nextCenterY, interaction.startPlacement.width, halfWidth, halfHeight);
      this.renderPreviewStamp();
      return;
    }

    if (interaction.kind === 'rotate') {
      const centerClientX = stageRect.left + startCenterX;
      const centerClientY = stageRect.top + startCenterY;
      const startAngle = Math.atan2(
        interaction.startClientY - centerClientY,
        interaction.startClientX - centerClientX,
      );
      const currentAngle = Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX);
      const nextRotation = normalizeDegrees(
        interaction.startPlacement.rotation + ((currentAngle - startAngle) * 180) / Math.PI,
      );
      this.state.stamp = {
        ...this.state.stamp,
        placement: {
          ...this.state.stamp.placement,
          rotation: nextRotation,
        },
      };
      this.invalidateLastExport();
      this.renderPreviewStamp();
      return;
    }

    const ratio = scaleRatioFromHandle(interaction.handle!, {
      centerX: stageRect.left + startCenterX,
      centerY: stageRect.top + startCenterY,
      startX: interaction.startClientX,
      startY: interaction.startClientY,
      currentX: event.clientX,
      currentY: event.clientY,
      rotation: interaction.startPlacement.rotation,
      startWidth: interaction.startWidthPx,
      startHeight: interaction.startHeightPx,
    });
    const nextWidthRatio = clampValue(
      interaction.startPlacement.width * ratio,
      STAMP_MIN_WIDTH_RATIO,
      STAMP_MAX_WIDTH_RATIO,
    );
    const nextWidthPx = nextWidthRatio * stageRect.width;
    const nextHeightPx = interaction.startHeightPx * (nextWidthPx / interaction.startWidthPx);
    this.updatePlacementFromPixels(startCenterX, startCenterY, nextWidthRatio, nextWidthPx / 2, nextHeightPx / 2);
    this.renderPreviewStamp();
  };

  private readonly onPointerUp = (): void => {
    if (this.stampInteraction) {
      this.suppressNextPreviewClick = true;
    }

    this.stampInteraction = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderPreviewStamp();
  };

  private updatePlacementFromPixels(
    centerXPx: number,
    centerYPx: number,
    widthRatio: number,
    halfWidthPx: number,
    halfHeightPx: number,
  ): void {
    const stageRect = this.getPreviewStageRect();
    if (!stageRect || !this.state.previewPageId) {
      return;
    }

    let nextX = centerXPx / stageRect.width;
    let nextY = centerYPx / stageRect.height;
    nextX = clampValue(nextX, halfWidthPx / stageRect.width, 1 - halfWidthPx / stageRect.width);
    nextY = clampValue(nextY, halfHeightPx / stageRect.height, 1 - halfHeightPx / stageRect.height);

    if (Math.abs(nextX - 0.5) < STAMP_SNAP_THRESHOLD) {
      nextX = 0.5;
    }

    if (Math.abs(nextY - 0.5) < STAMP_SNAP_THRESHOLD) {
      nextY = 0.5;
    }

    this.state.stamp = {
      ...this.state.stamp,
      placement: {
        ...this.state.stamp.placement,
        pageId: this.state.previewPageId,
        x: nextX,
        y: nextY,
        width: widthRatio,
      },
    };
    this.invalidateLastExport();
  }

  private async handlePdf(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.setNotice('Use a PDF file for this workflow.', 'error');
      this.renderStatus();
      return;
    }

    this.clearLastExport();
    this.state.loadingPdf = true;
    this.setNotice('Loading the PDF locally and building the page surface…', 'busy');
    this.renderStatus();
    this.renderControlState();
    this.renderExportPanel();
    this.showPreviewHint('Loading PDF preview…');

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
      this.state.pages = buildDocumentPages(bundle.pageSizes);
      this.state.fields = bundle.fields;
      this.state.profile = seededProfile;
      this.state.activeKeys = activeKeys;
      this.state.previewPageId = this.state.pages[0]?.id ?? null;
      this.state.stamp = syncStampFromProfile(previousProfile, seededProfile, {
        ...this.state.stamp,
        placement: {
          ...defaultStampSettings().placement,
        },
        date: seededProfile.date || this.state.stamp.date || todayInputValue(),
      });
      this.state.stampSelected = false;

      this.reapplyProfile();
      this.renderThumbnailRail();
      this.renderStampControls();
      this.renderPreviewMeta();
      await this.renderPreview();

      this.setNotice(
        `Ready. ${bundle.pageCount} page${bundle.pageCount === 1 ? '' : 's'} loaded. Click on the page to place your stamp.`,
        'success',
      );
    } catch (error) {
      console.error(error);
      this.state.bundle = null;
      this.state.pages = [];
      this.state.fields = [];
      this.state.stats = EMPTY_STATS;
      this.state.previewPageId = null;
      this.state.stampSelected = false;
      this.setNotice(
        'The PDF could not be parsed. Password-protected or malformed files need a separate handling path.',
        'error',
      );
      this.renderThumbnailRail();
      this.renderPreviewMeta();
    } finally {
      this.state.loadingPdf = false;
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

    this.invalidateLastExport();
    this.clearStampImage();
    this.state.stamp = {
      ...this.state.stamp,
      imageBytes: new Uint8Array(await file.arrayBuffer()),
      imageMime: mime,
      imageName: file.name,
    };
    this.state.stampImageUrl = URL.createObjectURL(file);
    this.renderStampControls();
    this.renderPreviewStamp();
  }

  private async handleExport(): Promise<void> {
    if (!this.state.bundle || this.state.loadingPdf || this.state.exporting) {
      return;
    }

    const sourceBytes = this.state.bundle.sourceBytes;
    const outputName = outputFileName(this.state.bundle.fileName);
    const fields = this.state.fields.map((field) => ({
      ...field,
      options: [...field.options],
    }));
    const stamp = cloneStampSettings(this.state.stamp);
    const pages = this.state.pages.map((page) => ({ ...page }));

    try {
      const { exportFilledPdf, downloadBlob } = await getPdfModule();
      this.state.exporting = true;
      this.setNotice('Generating the stamped PDF locally…', 'busy');
      this.renderStatus();
      this.renderControlState();
      this.renderExportPanel();

      const blob = await exportFilledPdf(sourceBytes, fields, stamp, pages);
      this.setLastExport(blob, outputName);
      downloadBlob(blob, outputName);
      this.setNotice(
        'Stamped PDF is ready. If the browser blocked the save prompt, use the download action in the top bar.',
        'success',
      );
    } catch (error) {
      console.error(error);
      this.setNotice('Export failed. Some PDFs have unusual field structures that need a custom fallback.', 'error');
    } finally {
      this.state.exporting = false;
      this.renderControlState();
      this.renderStatus();
      this.renderExportPanel();
    }
  }

  private addBlankPage(): void {
    if (!this.state.bundle) {
      return;
    }

    const currentIndex = this.getCurrentPageIndex();
    const referencePage = this.getCurrentPage() ?? this.state.pages.at(-1) ?? null;
    const referenceSize: PageSize = referencePage
      ? { width: referencePage.width, height: referencePage.height }
      : this.state.bundle.pageSizes[0] ?? { width: 595, height: 842 };
    const blankPage: DocumentPageModel = {
      id: `blank-${Date.now()}-${this.blankPageSerial += 1}`,
      kind: 'blank',
      width: referenceSize.width,
      height: referenceSize.height,
      label: `Blank ${this.blankPageSerial}`,
    };

    const nextPages = [...this.state.pages];
    if (this.state.blankInsertMode === 'after-current' && currentIndex >= 0) {
      nextPages.splice(currentIndex + 1, 0, blankPage);
    } else {
      nextPages.push(blankPage);
    }

    this.state.pages = nextPages;
    this.state.previewPageId = blankPage.id;
    this.state.stampSelected = false;
    this.invalidateLastExport();
    this.renderControlState();
    this.renderThumbnailRail();
    this.renderStampControls();
    this.renderPreviewMeta();
    void this.renderPreview();
    this.setNotice('Blank page added. Click anywhere on it if you want to move the stamp there.', 'neutral');
    this.renderStatus();
  }

  private reapplyProfile(options: ReapplyRenderOptions = {}): void {
    if (!this.state.bundle) {
      return;
    }

    const {
      profileFields = true,
      fieldList = true,
    } = options;

    const result = applyProfileToFields(
      this.state.fields.length ? this.state.fields : this.state.bundle.fields,
      this.state.profile,
      this.state.overwriteExisting,
    );

    this.state.fields = result.fields;
    this.state.stats = result.stats;
    if (profileFields) {
      this.renderProfileFields();
    }
    if (fieldList) {
      this.renderFieldList();
    }
  }

  private renderAll(): void {
    this.renderChromeVisibility();
    this.renderControlState();
    this.renderStatus();
    this.renderThumbnailRail();
    this.renderProfileFields();
    this.renderFieldList();
    this.renderStampControls();
    this.renderExportPanel();
    this.renderPreviewMeta();
    this.renderAdvancedSheetVisibility();
  }

  private renderControlState(): void {
    this.renderChromeVisibility();
    this.elements.uploadButton.disabled = this.state.loadingPdf;
    this.elements.addBlankPageButton.disabled = !this.state.bundle || this.state.loadingPdf;
    const currentIndex = this.getCurrentPageIndex();
    this.elements.prevPageButton.disabled = currentIndex <= 0;
    this.elements.nextPageButton.disabled = currentIndex === -1 || currentIndex >= this.state.pages.length - 1;
    this.elements.overwriteToggle.disabled = !this.state.bundle;
  }

  private renderStatus(): void {
    this.renderChromeVisibility();
    this.elements.status.className = `status is-${this.state.notice.tone}`;
    this.elements.status.textContent = this.state.notice.message;
  }

  private renderChromeVisibility(): void {
    const hasBundle = Boolean(this.state.bundle);
    this.elements.studioShell.classList.toggle('is-empty-state', !hasBundle);
    this.elements.topbar.hidden = !hasBundle;
    this.elements.thumbnailRail.hidden = !hasBundle;
    this.elements.previewFileMeta.hidden = !hasBundle;
    this.elements.stampControls.hidden = !hasBundle;
    this.elements.status.hidden = !hasBundle && this.state.notice.tone === 'neutral';
    this.elements.advancedSheet.hidden = !hasBundle || !this.state.advancedOpen;
  }

  private renderThumbnailRail(): void {
    if (this.state.pages.length === 0) {
      this.updateContainerMarkup(this.elements.thumbnailRail, `
        <div class="thumbnail-ghost">
          <div class="thumbnail-paper is-ghost"></div>
          <p>Pages show up here once a PDF is loaded.</p>
        </div>
      `);
      return;
    }

    const items = this.state.pages
      .map((page, index) => {
        const isActive = page.id === this.state.previewPageId;
        const hasStamp = this.state.stamp.placement.pageId === page.id;
        return `
          <button type="button" class="thumb ${isActive ? 'is-active' : ''}" data-page-id="${page.id}">
            <span class="thumb-paper ${page.kind === 'blank' ? 'is-blank' : ''}">
              <span class="thumb-lines"></span>
            </span>
            <span class="thumb-meta">
              <strong>${page.kind === 'blank' ? 'Blank' : `Page ${page.pageNumber}`}</strong>
              <span>${index + 1} / ${this.state.pages.length}</span>
            </span>
            ${hasStamp ? '<span class="thumb-stamp-flag">Stamp</span>' : ''}
          </button>
        `;
      })
      .join('');

    this.updateContainerMarkup(this.elements.thumbnailRail, items);
  }

  private renderProfileFields(): void {
    if (!this.state.bundle) {
      this.updateContainerMarkup(this.elements.profileFields, `
        <div class="sheet-empty-copy">
          Upload a PDF to review shared details and field mapping.
        </div>
      `);
      return;
    }

    const inputs = this.state.activeKeys
      .map((key) => {
        const definition = getProfileFieldDefinition(key);
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
          <label class="sheet-field">
            <span>${escapeHtml(definition.label)}</span>
            <input
              data-profile-key="${key}"
              type="${inputType}"
              value="${escapeAttribute(value)}"
              placeholder="${escapeAttribute(definition.placeholder)}"
            />
            <small>${escapeHtml(definition.helper)}</small>
          </label>
        `;
      })
      .join('');

    this.updateContainerMarkup(this.elements.profileFields, inputs);
  }

  private renderFieldList(): void {
    if (!this.state.bundle) {
      this.updateContainerMarkup(this.elements.fieldList, `
        <div class="sheet-empty-copy">
          Document fields appear here after parsing.
        </div>
      `);
      return;
    }

    if (this.state.fields.length === 0) {
      this.updateContainerMarkup(this.elements.fieldList, `
        <div class="sheet-empty-copy">
          No AcroForm fields were detected in this PDF.
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
            ${renderFieldControl(field)}
          </div>
        </article>
      `;
    }).join('');

    this.updateContainerMarkup(this.elements.fieldList, rows);
  }

  private renderStampControls(): void {
    const bundleLoaded = Boolean(this.state.bundle);
    const hasImage = Boolean(this.state.stampImageUrl);
    const currentPage = this.getCurrentPage();
    const side = this.getInspectorSide();
    this.elements.stampControls.className = `floating-inspector is-${side}`;

    if (!bundleLoaded) {
      this.updateContainerMarkup(this.elements.stampControls, `
        <div class="inspector-copy">
          <p class="eyebrow">Stamp</p>
          <h2>Keep the page in the middle.</h2>
          <p>Upload a PDF and place one approval stamp exactly where it needs to land.</p>
        </div>
      `);
      return;
    }

    const placementCopy = currentPage
      ? isStampPlaced(this.state.stamp) && this.state.stamp.placement.pageId === currentPage.id
        ? 'Drag to move. Pull the edges or corners to resize. Use the top handle to rotate.'
        : 'Click anywhere on this page to place or move the stamp here.'
      : 'Choose a page, then click to place the stamp.';

    this.updateContainerMarkup(this.elements.stampControls, `
      <div class="inspector-copy">
        <p class="eyebrow">Stamp</p>
        <h2>${this.state.stampSelected ? 'Direct on-page editing.' : 'One stamp, placed by eye.'}</h2>
        <p>${escapeHtml(placementCopy)}</p>
      </div>
      <div class="inspector-controls">
        <label class="inspector-field">
          <span>Mode</span>
          <select data-stamp-setting="mode">
            ${selectOption('text', 'Approval block', this.state.stamp.mode)}
            ${selectOption('image', 'Image only', this.state.stamp.mode)}
            ${selectOption('both', 'Block + image', this.state.stamp.mode)}
          </select>
        </label>
        <label class="inspector-field">
          <span>Stamp date</span>
          <input data-stamp-setting="date" type="date" value="${escapeAttribute(this.state.stamp.date)}" />
        </label>
        <label class="inspector-field">
          <span>Blank page placement</span>
          <select data-ui-setting="blank-insert-mode">
            ${selectOption('after-current', 'After current page', this.state.blankInsertMode)}
            ${selectOption('at-end', 'Append to end', this.state.blankInsertMode)}
          </select>
        </label>
        <label class="inspector-field">
          <span>Optional image stamp</span>
          <input type="file" accept="image/png,image/jpeg" />
        </label>
        <label class="toggle">
          <input data-stamp-setting="flatten" type="checkbox" ${this.state.stamp.flatten ? 'checked' : ''} />
          Flatten filled fields on export
        </label>
        <div class="inspector-actions">
          <button type="button" class="ghost-button" data-action="open-advanced">Document fields</button>
          ${
            hasImage
              ? '<button type="button" class="ghost-button" data-action="clear-stamp-image">Remove image</button>'
              : ''
          }
        </div>
      </div>
    `);
  }

  private renderExportPanel(): void {
    const nextOutputName = this.state.bundle ? outputFileName(this.state.bundle.fileName) : 'your-file-stamped.pdf';
    const disabled = !this.state.bundle || this.state.loadingPdf || this.state.exporting;
    const primaryAction =
      this.state.lastExportUrl && this.state.lastExportName
        ? `
          <a class="action-button is-primary" href="${this.state.lastExportUrl}" download="${escapeAttribute(this.state.lastExportName)}" rel="noopener">
            Download stamped PDF
          </a>
          <button type="button" class="ghost-button" data-action="export-pdf" ${disabled ? 'disabled' : ''}>
            Regenerate
          </button>
        `
        : `
          <button type="button" class="action-button is-primary" data-action="export-pdf" ${disabled ? 'disabled' : ''}>
            ${this.state.exporting ? 'Working…' : 'Export stamped PDF'}
          </button>
        `;

    this.updateContainerMarkup(this.elements.exportActions, `
      <div class="export-inline">
        ${primaryAction}
        <span class="export-name">${escapeHtml(nextOutputName)}</span>
      </div>
    `);
  }

  private renderPreviewMeta(): void {
    const currentPage = this.getCurrentPage();
    if (!this.state.bundle || !currentPage) {
      this.elements.previewPageLabel.textContent = 'No page';
      this.elements.previewFileMeta.textContent = 'Upload a PDF to start placing the stamp.';
      this.elements.previewEmpty.hidden = false;
      this.elements.previewCanvas.hidden = true;
      this.elements.previewStamp.hidden = true;
      this.elements.previewGuides.hidden = true;
      this.elements.previewHint.hidden = true;
      this.elements.previewFrame.classList.add('is-empty');
      this.clearPreviewOverlayFrame();
      return;
    }

    const pageIndex = this.getCurrentPageIndex();
    const label = currentPage.kind === 'blank' ? 'Blank page' : `Page ${currentPage.pageNumber}`;
    this.elements.previewPageLabel.textContent = `${label} ${pageIndex + 1} / ${this.state.pages.length}`;
    this.elements.previewFileMeta.textContent = `${this.state.bundle.fileName} · ${this.state.bundle.pageCount} source page${this.state.bundle.pageCount === 1 ? '' : 's'}`;
    this.elements.previewEmpty.hidden = true;
    this.elements.previewFrame.classList.remove('is-empty');
    this.renderPreviewStamp();
  }

  private async renderPreview(): Promise<void> {
    const bundle = this.state.bundle;
    const currentPage = this.getCurrentPage();
    if (!bundle || !currentPage) {
      return;
    }

    const renderToken = ++this.previewToken;
    this.elements.previewFrame.classList.add('is-loading');
    this.showPreviewHint(currentPage.kind === 'blank' ? 'Preparing blank page…' : 'Rendering page preview…');

    try {
      if (currentPage.kind === 'blank') {
        renderBlankPreview(this.elements.previewCanvas, currentPage);
      } else {
        const { renderPreviewPage } = await getPdfModule();
        await renderPreviewPage(bundle.previewDocument, currentPage.pageNumber, this.elements.previewCanvas);
      }

      if (renderToken !== this.previewToken) {
        return;
      }

      this.elements.previewCanvas.hidden = false;
      this.elements.previewHint.hidden = true;
      this.elements.previewFrame.classList.add('has-preview');
      this.syncPreviewOverlayFrame();
      this.renderPreviewStamp();
    } catch (error) {
      console.error(error);
      if (renderToken !== this.previewToken) {
        return;
      }
      this.elements.previewCanvas.hidden = true;
      this.elements.previewFrame.classList.remove('has-preview');
      this.showPreviewHint('Preview failed for this page');
      this.elements.previewStamp.hidden = true;
      this.clearPreviewOverlayFrame();
    } finally {
      if (renderToken === this.previewToken) {
        this.elements.previewFrame.classList.remove('is-loading');
      }
    }
  }

  private renderPreviewStamp(): void {
    const currentPage = this.getCurrentPage();
    if (!currentPage || !shouldShowStampOnPage(this.state.stamp, currentPage.id)) {
      this.elements.previewStamp.hidden = true;
      this.elements.previewGuides.hidden = true;
      this.elements.previewStamp.innerHTML = '';
      return;
    }

    const hasImage = Boolean(this.state.stampImageUrl);
    const showTable = shouldShowStampTable(this.state.stamp, hasImage);
    const showImage = shouldShowStampImage(this.state.stamp, hasImage);
    const rows = buildStampRows(this.state.stamp);
    const placement = this.state.stamp.placement;
    const verticalGuide = this.state.stampSelected && Math.abs(placement.x - 0.5) < STAMP_SNAP_THRESHOLD;
    const horizontalGuide = this.state.stampSelected && Math.abs(placement.y - 0.5) < STAMP_SNAP_THRESHOLD;
    const interactionClass = this.stampInteraction ? ` is-${this.stampInteraction.kind}` : '';
    const surfaceCursor =
      this.stampInteraction?.kind === 'resize' && this.stampInteraction.handle
        ? cursorForHandle(this.stampInteraction.handle, placement.rotation)
        : this.stampInteraction?.kind === 'drag'
          ? 'grabbing'
          : this.stampInteraction?.kind === 'rotate'
            ? 'grabbing'
            : 'grab';

    this.elements.previewGuides.hidden = !verticalGuide && !horizontalGuide;
    this.elements.previewGuides.className = `preview-guides${verticalGuide ? ' show-vertical' : ''}${horizontalGuide ? ' show-horizontal' : ''}`;
    this.syncPreviewOverlayFrame();

    this.elements.previewStamp.hidden = false;
    this.updateContainerMarkup(this.elements.previewStamp, `
      <div
        class="preview-stamp-object ${this.state.stampSelected ? 'is-selected' : ''}${interactionClass}"
        style="left:${placement.x * 100}%; top:${placement.y * 100}%; width:${placement.width * 100}%; transform: translate(-50%, -50%) rotate(${placement.rotation}deg);"
      >
        <div class="preview-stamp-body" style="cursor:${surfaceCursor};">
          <div class="preview-stamp-card">
            ${showTable ? renderStampTable(rows, { editable: this.state.stampSelected }) : ''}
            ${
              showImage && this.state.stampImageUrl
                ? `<img class="stamp-preview-image preview-stamp-image" src="${this.state.stampImageUrl}" alt="Preview stamp image" />`
                : ''
            }
          </div>
        </div>
        ${this.state.stampSelected ? renderStampHandles(placement.rotation) : ''}
      </div>
    `);
  }

  private renderAdvancedSheetVisibility(): void {
    this.elements.advancedSheet.hidden = !this.state.bundle || !this.state.advancedOpen;
  }

  private syncPreviewOverlayFrame(): void {
    if (this.elements.previewCanvas.hidden) {
      this.clearPreviewOverlayFrame();
      return;
    }

    const left = this.elements.previewCanvas.offsetLeft;
    const top = this.elements.previewCanvas.offsetTop;
    const width = this.elements.previewCanvas.clientWidth;
    const height = this.elements.previewCanvas.clientHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    const style = {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      inset: 'auto',
    };

    Object.assign(this.elements.previewStamp.style, style);
    Object.assign(this.elements.previewGuides.style, style);
  }

  private clearPreviewOverlayFrame(): void {
    this.elements.previewStamp.style.left = '';
    this.elements.previewStamp.style.top = '';
    this.elements.previewStamp.style.width = '';
    this.elements.previewStamp.style.height = '';
    this.elements.previewStamp.style.inset = '';
    this.elements.previewGuides.style.left = '';
    this.elements.previewGuides.style.top = '';
    this.elements.previewGuides.style.width = '';
    this.elements.previewGuides.style.height = '';
    this.elements.previewGuides.style.inset = '';
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

  private invalidateLastExport(): void {
    if (!this.state.lastExportUrl) {
      return;
    }

    this.clearLastExport();
    this.renderExportPanel();
  }

  private schedulePreviewRender(): void {
    if (this.previewResizeFrame !== null) {
      window.cancelAnimationFrame(this.previewResizeFrame);
    }

    this.previewResizeFrame = window.requestAnimationFrame(() => {
      this.previewResizeFrame = null;
      if (this.state.bundle) {
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

  private getCurrentPage(): DocumentPageModel | null {
    if (!this.state.previewPageId) {
      return null;
    }

    return this.state.pages.find((page) => page.id === this.state.previewPageId) ?? null;
  }

  private getCurrentPageIndex(): number {
    if (!this.state.previewPageId) {
      return -1;
    }

    return this.state.pages.findIndex((page) => page.id === this.state.previewPageId);
  }

  private getPreviewStageRect(): DOMRect | null {
    if (this.elements.previewCanvas.hidden) {
      return null;
    }

    return this.elements.previewCanvas.getBoundingClientRect();
  }

  private getInspectorSide(): 'left' | 'right' {
    const currentPage = this.getCurrentPage();
    if (!currentPage || !shouldShowStampOnPage(this.state.stamp, currentPage.id)) {
      return 'right';
    }

    return this.state.stamp.placement.x > 0.56 ? 'left' : 'right';
  }

  private showPreviewHint(message: string): void {
    this.elements.previewHint.hidden = false;
    this.elements.previewHint.textContent = message;
  }
}

function shellMarkup(): string {
  return `
    <div class="app-shell">
      <header id="topbar" class="topbar">
        <div class="brand-block">
          <p class="eyebrow">PDF Stamper</p>
          <div class="brand-copy">Place one approval stamp exactly where it belongs.</div>
        </div>
        <div class="topbar-actions">
          <button id="upload-button" class="ghost-button" type="button" data-action="choose-file">Upload PDF</button>
          <button id="add-blank-page-button" class="ghost-button" type="button" data-action="add-blank-page">Add blank page</button>
          <div class="topbar-page-nav">
            <button id="prev-page-button" class="nav-button" type="button">Prev</button>
            <span id="preview-page-label">No page</span>
            <button id="next-page-button" class="nav-button" type="button">Next</button>
          </div>
          <div id="export-actions"></div>
        </div>
        <input id="file-input" type="file" accept="application/pdf,.pdf" hidden />
      </header>

      <main class="studio-shell">
        <aside id="thumbnail-rail" class="thumbnail-rail"></aside>

        <section class="canvas-column">
          <div id="preview-file-meta" class="preview-file-meta">Upload a PDF to start placing the stamp.</div>
          <div id="preview-frame" class="preview-frame is-empty">
            <div id="preview-empty" class="preview-empty">
              <div class="preview-empty-copy">
                <h1>Stamp PDFs without leaving the page.</h1>
                <p>Upload a document, click once to place the stamp, then drag, resize, or rotate it directly on the page.</p>
                <button class="action-button is-primary" type="button" data-action="choose-file">Upload a PDF</button>
              </div>
              <div class="preview-empty-paper">
                <div class="preview-empty-lines"></div>
                <div class="preview-empty-lines is-short"></div>
                <div class="preview-empty-lines"></div>
                <div class="preview-empty-lines is-short"></div>
                <div class="preview-empty-sample">
                  <span>PAYEE</span>
                  <strong>Acme Insurance</strong>
                </div>
              </div>
            </div>
            <canvas id="preview-canvas" hidden></canvas>
            <div id="preview-guides" class="preview-guides" hidden>
              <div class="preview-guide is-vertical"></div>
              <div class="preview-guide is-horizontal"></div>
            </div>
            <div id="preview-stamp" class="preview-stamp" hidden></div>
            <div id="preview-hint" class="preview-hint" hidden></div>
          </div>
          <div id="stamp-controls" class="floating-inspector"></div>
          <div id="status" class="status"></div>
        </section>
      </main>

      <section id="advanced-sheet" class="advanced-sheet" hidden>
        <button class="advanced-sheet-scrim" type="button" data-action="close-advanced" aria-label="Close document fields"></button>
        <div class="advanced-sheet-panel">
          <div class="advanced-sheet-head">
            <div>
              <p class="eyebrow">Document Fields</p>
              <h2>Shared details and raw field cleanup</h2>
            </div>
            <button class="ghost-button" type="button" data-action="close-advanced">Close</button>
          </div>
          <div class="advanced-section">
            <label class="toggle">
              <input id="overwrite-toggle" type="checkbox" />
              Overwrite values already present in the PDF
            </label>
          </div>
          <div class="advanced-section">
            <div class="advanced-section-copy">Shared details can cascade into matching PDF fields.</div>
            <div id="profile-fields" class="sheet-form"></div>
          </div>
          <div class="advanced-section">
            <div class="advanced-section-copy">Manual overrides here always win.</div>
            <div id="field-list" class="field-list"></div>
          </div>
        </div>
      </section>
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
    placement: {
      pageId: null,
      x: 0.5,
      y: 0.72,
      width: 0.52,
      rotation: 0,
    },
    flatten: false,
    imageBytes: null,
    imageMime: null,
    imageName: null,
  };
}

function buildDocumentPages(pageSizes: PageSize[]): DocumentPageModel[] {
  return pageSizes.map((size, index) => ({
    id: `pdf-${index + 1}`,
    kind: 'pdf',
    pageNumber: index + 1,
    width: size.width,
    height: size.height,
    label: `Page ${index + 1}`,
  }));
}

function renderBlankPreview(canvas: HTMLCanvasElement, page: DocumentPageModel): void {
  const parentWidth = Math.max(380, Math.min(canvas.parentElement?.clientWidth ?? 860, 980));
  const scale = Math.min(1.5, parentWidth / page.width);
  const width = page.width * scale;
  const height = page.height * scale;
  const pixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.');
  }

  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#fffdf9';
  context.fillRect(0, 0, width, height);
}

function placementFromPointer(
  pageId: string,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  widthRatio: number,
): StampPlacement {
  const halfWidth = (rect.width * widthRatio) / 2;
  const safeX = clampValue(clientX - rect.left, halfWidth, rect.width - halfWidth);
  const safeY = clampValue(clientY - rect.top, 90, rect.height - 90);
  return {
    pageId,
    x: safeX / rect.width,
    y: safeY / rect.height,
    width: widthRatio,
    rotation: 0,
  };
}

function scaleRatioFromHandle(
  handle: ResizeHandle,
  input: {
    centerX: number;
    centerY: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    rotation: number;
    startWidth: number;
    startHeight: number;
  },
): number {
  const startVector = rotateVector(
    input.startX - input.centerX,
    input.startY - input.centerY,
    -input.rotation,
  );
  const currentVector = rotateVector(
    input.currentX - input.centerX,
    input.currentY - input.centerY,
    -input.rotation,
  );
  const startDx = startVector.x;
  const startDy = startVector.y;
  const currentDx = currentVector.x;
  const currentDy = currentVector.y;

  if (handle === 'e' || handle === 'w') {
    return Math.max(0.4, Math.abs(currentDx) / Math.max(1, Math.abs(startDx)));
  }

  if (handle === 'n' || handle === 's') {
    return Math.max(0.4, Math.abs(currentDy) / Math.max(1, Math.abs(startDy)));
  }

  const widthScale = Math.abs(currentDx) / Math.max(1, Math.abs(startDx));
  const heightScale = Math.abs(currentDy) / Math.max(1, Math.abs(startDy));
  return Math.max(0.4, Math.max(widthScale, heightScale));
}

function renderStampTable(
  rows: ReturnType<typeof buildStampRows>,
  options: { editable: boolean },
): string {
  return `
    <div class="stamp-table-preview ${options.editable ? 'is-editor' : ''}">
      ${rows
        .map((row) => (options.editable ? renderEditableStampRow(row) : renderReadonlyStampRow(row)))
        .join('')}
    </div>
  `;
}

function renderEditableStampRow(row: ReturnType<typeof buildStampRows>[number]): string {
  const labelHtml = row.labelLines.map((line) => escapeHtml(line)).join('<br />');
  const inputClass = row.emphasis ? 'stamp-table-input is-emphasis' : 'stamp-table-input';
  return `
    <label class="stamp-table-row is-editable">
      <span class="stamp-table-label">${labelHtml}</span>
      <span class="stamp-table-input-wrap">
        <input
          class="${inputClass}"
          data-stamp-key="${row.key}"
          type="text"
          value="${escapeAttribute(row.value)}"
          placeholder="${escapeAttribute(row.placeholder)}"
        />
      </span>
    </label>
  `;
}

function renderReadonlyStampRow(row: ReturnType<typeof buildStampRows>[number]): string {
  const labelHtml = row.labelLines.map((line) => escapeHtml(line)).join('<br />');
  const valueClass = row.emphasis ? 'stamp-table-value is-emphasis' : 'stamp-table-value';
  return `
    <div class="stamp-table-row">
      <div class="stamp-table-label">${labelHtml}</div>
      <div class="${valueClass}">${escapeHtml(row.value)}</div>
    </div>
  `;
}

function renderStampHandles(rotation: number): string {
  return `
    <div class="stamp-selection">
      <button type="button" class="stamp-rotate-handle" data-stamp-action="rotate-stamp" aria-label="Rotate stamp"></button>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
        .map((handle) => `<button type="button" class="stamp-handle is-${handle}" data-stamp-handle="${handle}" aria-label="Resize stamp ${handle}" style="cursor:${cursorForHandle(handle as ResizeHandle, rotation)};"></button>`)
        .join('')}
    </div>
  `;
}

function renderFieldControl(field: PdfFieldModel): string {
  if (!isEditableField(field)) {
    return '<div class="readonly-field">Unsupported by this first pass</div>';
  }

  if (field.kind === 'checkbox') {
    return `
      <label class="checkbox-field">
        <input data-field-id="${field.id}" type="checkbox" ${field.value === true ? 'checked' : ''} />
        Tick this box
      </label>
    `;
  }

  if (field.kind === 'dropdown' || field.kind === 'radio' || field.kind === 'option-list') {
    return `
      <select data-field-id="${field.id}">
        <option value="">Leave blank</option>
        ${field.options.map((option) => {
          const selected = field.value === option ? 'selected' : '';
          return `<option value="${escapeAttribute(option)}" ${selected}>${escapeHtml(option)}</option>`;
        }).join('')}
      </select>
    `;
  }

  return `<input data-field-id="${field.id}" type="text" value="${escapeAttribute(typeof field.value === 'string' ? field.value : '')}" />`;
}

function cloneStampSettings(stamp: StampSettings): StampSettings {
  return {
    ...stamp,
    placement: {
      ...stamp.placement,
    },
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

function isStampValueKey(key: keyof StampSettings): key is
  | 'payee'
  | 'totalAmount'
  | 'gstAmount'
  | 'movementNumber'
  | 'signedBy'
  | 'coSignedBy'
  | 'approvedBy1'
  | 'approvedBy2' {
  return [
    'payee',
    'totalAmount',
    'gstAmount',
    'movementNumber',
    'signedBy',
    'coSignedBy',
    'approvedBy1',
    'approvedBy2',
  ].includes(key);
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function rotateVector(x: number, y: number, degreesValue: number): { x: number; y: number } {
  if (degreesValue === 0) {
    return { x, y };
  }

  const radians = (degreesValue * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function cursorForHandle(handle: ResizeHandle, rotation: number): string {
  const cursorCycle = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'] as const;
  const baseIndexByHandle: Record<ResizeHandle, number> = {
    n: 0,
    s: 0,
    ne: 1,
    sw: 1,
    e: 2,
    w: 2,
    nw: 3,
    se: 3,
  };

  const rotationSteps = Math.round(normalizeDegrees(rotation) / 45) % cursorCycle.length;
  return cursorCycle[(baseIndexByHandle[handle] + rotationSteps) % cursorCycle.length];
}
