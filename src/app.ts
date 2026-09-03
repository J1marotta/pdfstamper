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
  displayStampRowValue,
  isStampPlaced,
  shouldShowStampImage,
  shouldShowStampOnPage,
  shouldShowStampTable,
  syncStampFromProfile,
  wrapStampText,
} from './stamp';
import type {
  DocumentPageModel,
  FillStats,
  PageSize,
  PdfFieldModel,
  PlacedStamp,
  PlacedTextBox,
  ProfileValues,
  SemanticKey,
  StampPlacement,
  StampSettings,
} from './types';

interface NoticeState {
  tone: 'neutral' | 'busy' | 'success' | 'warning' | 'error';
  message: string;
}

interface AppState {
  bundle: LoadedPdfBundle | null;
  pages: DocumentPageModel[];
  fields: PdfFieldModel[];
  profile: ProfileValues;
  activeKeys: SemanticKey[];
  stats: FillStats;
  stamps: PlacedStamp[];
  selectedStampId: string | null;
  overwriteExisting: boolean;
  previewPageId: string | null;
  notice: NoticeState;
  loadingPdf: boolean;
  exporting: boolean;
  lastExportUrl: string | null;
  lastExportName: string | null;
  lastExportBlob: Blob | null;
  advancedOpen: boolean;
  blankInsertMode: 'after-current' | 'at-end';
  exportConfirmArmed: boolean;
  passwordDialog: { fileName: string; error: string } | null;
  encryptedReadOnly: boolean;
  signatureOpen: boolean;
  textBoxes: PlacedTextBox[];
  selectedTextBoxId: string | null;
}

interface AppElements {
  studioShell: HTMLElement;
  topbar: HTMLElement;
  fileInput: HTMLInputElement;
  uploadButton: HTMLButtonElement;
  addBlankPageButton: HTMLButtonElement;
  deletePageButton: HTMLButtonElement;
  addTextBoxButton: HTMLButtonElement;
  exportActions: HTMLElement;
  status: HTMLElement;
  stampControls: HTMLElement;
  profileFields: HTMLElement;
  fieldList: HTMLElement;
  fillStats: HTMLElement;
  overwriteToggle: HTMLInputElement;
  previewFrame: HTMLElement;
  previewCanvas: HTMLCanvasElement;
  previewEmpty: HTMLElement;
  previewHint: HTMLElement;
  previewStamp: HTMLElement;
  previewTextboxes: HTMLElement;
  previewGuides: HTMLElement;
  previewPageLabel: HTMLElement;
  previewFileMeta: HTMLElement;
  prevPageButton: HTMLButtonElement;
  nextPageButton: HTMLButtonElement;
  thumbnailRail: HTMLElement;
  advancedSheet: HTMLElement;
  passwordDialog: HTMLElement;
  signatureDialog: HTMLElement;
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

interface PersistedPreferences {
  profile: ProfileValues;
  stamps: Array<
    Pick<
      StampSettings,
      | 'mode'
      | 'payee'
      | 'totalAmount'
      | 'gstAmount'
      | 'movementNumber'
      | 'signedBy'
      | 'coSignedBy'
      | 'approvedBy1'
      | 'approvedBy2'
      | 'date'
      | 'flatten'
    >
  >;
  overwriteExisting: boolean;
  blankInsertMode: 'after-current' | 'at-end';
}

const PREFERENCES_STORAGE_KEY = 'pdf-stamp-studio:v1';

interface StampInteraction {
  kind: 'drag' | 'resize' | 'rotate';
  stampId: string;
  handle?: ResizeHandle;
  startClientX: number;
  startClientY: number;
  stageRect: DOMRect;
  startPlacement: StampPlacement;
  startWidthPx: number;
  startHeightPx: number;
}

interface TextBoxInteraction {
  boxId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  stageRect: DOMRect;
}

const EMPTY_STATS: FillStats = {
  autofilledCount: 0,
  remainingCount: 0,
  editableCount: 0,
  matchedCount: 0,
};

const DEFAULT_STAMP_WIDTH_POINTS = 300;
const STAMP_MIN_WIDTH_POINTS = 12;
const STAMP_PREVIEW_BASE_WIDTH = 460;
const STAMP_PREVIEW_IMAGE_HEIGHT = 184;
const STAMP_PREVIEW_GAP = 10;
const STAMP_MIN_RESIZE_RATIO = 0.01;
const STAMP_SNAP_THRESHOLD = 0.02;

const TEXTBOX_FONT_SIZES = [8, 10, 12, 14, 18, 24];
const DEFAULT_TEXTBOX_FONT_SIZE = 12;

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
  private previewRenderChain: Promise<void> = Promise.resolve();
  private pendingPasswordFile: File | null = null;
  private stampImageUrls = new Map<string, string>();
  private signatureHasInk = false;
  private loadToken = 0;
  private previewResizeFrame: number | null = null;
  private blankPageSerial = 0;
  private stampSerial = 0;
  private stampInteraction: StampInteraction | null = null;
  private textBoxInteraction: TextBoxInteraction | null = null;
  private suppressNextPreviewClick = false;
  private textBoxSerial = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = shellMarkup();
    this.elements = {
      studioShell: this.root.querySelector<HTMLElement>('.studio-shell')!,
      topbar: this.root.querySelector<HTMLElement>('#topbar')!,
      fileInput: this.root.querySelector<HTMLInputElement>('#file-input')!,
      uploadButton: this.root.querySelector<HTMLButtonElement>('#upload-button')!,
      addBlankPageButton: this.root.querySelector<HTMLButtonElement>('#add-blank-page-button')!,
      deletePageButton: this.root.querySelector<HTMLButtonElement>('#delete-page-button')!,
      addTextBoxButton: this.root.querySelector<HTMLButtonElement>('#add-textbox-button')!,
      exportActions: this.root.querySelector<HTMLElement>('#export-actions')!,
      status: this.root.querySelector<HTMLElement>('#status')!,
      stampControls: this.root.querySelector<HTMLElement>('#stamp-controls')!,
      profileFields: this.root.querySelector<HTMLElement>('#profile-fields')!,
      fieldList: this.root.querySelector<HTMLElement>('#field-list')!,
      fillStats: this.root.querySelector<HTMLElement>('#fill-stats')!,
      overwriteToggle: this.root.querySelector<HTMLInputElement>('#overwrite-toggle')!,
      previewFrame: this.root.querySelector<HTMLElement>('#preview-frame')!,
      previewCanvas: this.root.querySelector<HTMLCanvasElement>('#preview-canvas')!,
      previewEmpty: this.root.querySelector<HTMLElement>('#preview-empty')!,
      previewHint: this.root.querySelector<HTMLElement>('#preview-hint')!,
      previewStamp: this.root.querySelector<HTMLElement>('#preview-stamp')!,
      previewTextboxes: this.root.querySelector<HTMLElement>('#preview-textboxes')!,
      previewGuides: this.root.querySelector<HTMLElement>('#preview-guides')!,
      previewPageLabel: this.root.querySelector<HTMLElement>('#preview-page-label')!,
      previewFileMeta: this.root.querySelector<HTMLElement>('#preview-file-meta')!,
      prevPageButton: this.root.querySelector<HTMLButtonElement>('#prev-page-button')!,
      nextPageButton: this.root.querySelector<HTMLButtonElement>('#next-page-button')!,
      thumbnailRail: this.root.querySelector<HTMLElement>('#thumbnail-rail')!,
      advancedSheet: this.root.querySelector<HTMLElement>('#advanced-sheet')!,
      passwordDialog: this.root.querySelector<HTMLElement>('#password-dialog')!,
      signatureDialog: this.root.querySelector<HTMLElement>('#signature-dialog')!,
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
      stamps: [],
      selectedStampId: null,
      overwriteExisting: false,
      previewPageId: null,
      notice: {
        tone: 'neutral',
        message: 'Upload a PDF, click once to place the stamp, then drag, resize, or rotate it.',
      },
      loadingPdf: false,
      exporting: false,
      lastExportUrl: null,
      lastExportName: null,
      lastExportBlob: null,
      advancedOpen: false,
      blankInsertMode: 'after-current',
      exportConfirmArmed: false,
      passwordDialog: null,
      encryptedReadOnly: false,
      signatureOpen: false,
      textBoxes: [],
      selectedTextBoxId: null,
    };

    const savedPreferences = loadPreferences();
    if (savedPreferences) {
      this.state.profile = { ...this.state.profile, ...savedPreferences.profile };
      this.state.overwriteExisting = savedPreferences.overwriteExisting;
      this.state.blankInsertMode = savedPreferences.blankInsertMode;
      this.state.stamps = savedPreferences.stamps.map((draft) => ({
        id: `stamp-restored-${this.stampSerial += 1}`,
        settings: {
          ...defaultStampSettings(),
          ...draft,
          placement: { ...defaultStampSettings().placement },
          imageBytes: null,
          imageMime: null,
          imageName: null,
        },
      }));
    }

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

      if (action === 'delete-page') {
        this.deleteCurrentPage();
        return;
      }

      if (action === 'add-textbox') {
        this.addTextBox();
        return;
      }

      if (action === 'delete-textbox') {
        const boxId = target.closest<HTMLElement>('[data-textbox-id]')?.dataset.textboxId;
        if (boxId) {
          this.deleteTextBox(boxId);
        }
        return;
      }

      if (action === 'export-pdf') {
        void this.handleExport();
        return;
      }

      if (action === 'download-export') {
        void this.downloadLastExport();
        return;
      }

      if (action === 'open-advanced') {
        this.state.advancedOpen = true;
        this.renderAdvancedSheetVisibility();
        this.elements.advancedSheet
          .querySelector<HTMLButtonElement>('.advanced-sheet-head .ghost-button')
          ?.focus({ preventScroll: true });
        return;
      }

      if (action === 'close-advanced') {
        this.state.advancedOpen = false;
        this.renderAdvancedSheetVisibility();
        this.root
          .querySelector<HTMLButtonElement>('[data-action="open-advanced"]')
          ?.focus({ preventScroll: true });
        return;
      }

      if (action === 'clear-stamp-image') {
        this.invalidateLastExport();
        this.clearSelectedStampImage();
        if (this.activeStamp.mode === 'image') {
          // "Image only" with no image falls back to the table anyway, so
          // switch to text to match what is actually rendered.
          this.activeStamp = {
            ...this.activeStamp,
            mode: 'text',
          };
        }
        this.persistPreferences();
        this.renderStampControls();
        this.renderPreviewStamp();
        return;
      }

      if (action === 'delete-stamp') {
        this.deleteStamp();
        return;
      }

      if (action === 'add-stamp') {
        this.addStamp();
        return;
      }

      if (action === 'nudge-stamp') {
        const button = target.closest<HTMLElement>('[data-action="nudge-stamp"]');
        const dx = Number(button?.dataset.dx ?? 0);
        const dy = Number(button?.dataset.dy ?? 0);
        if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
          this.nudgeSelectedStamp(dx, dy);
        }
        return;
      }

      if (action === 'open-signature') {
        this.openSignatureDialog();
        return;
      }

      if (action === 'use-signature') {
        void this.useSignature();
        return;
      }

      if (action === 'clear-signature-pad') {
        this.clearSignaturePad();
        return;
      }

      if (action === 'render-signature-text') {
        this.renderSignatureText();
        return;
      }

      if (action === 'cancel-signature') {
        this.closeSignatureDialog();
        return;
      }

      if (action === 'submit-password') {
        this.submitPassword();
        return;
      }

      if (action === 'cancel-password') {
        this.cancelPassword('Password entry cancelled.');
        return;
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

    this.elements.passwordDialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === 'password') {
        this.submitPassword();
      }
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

      if (target.closest('#preview-stamp, #preview-textboxes')) {
        return;
      }

      const currentPage = this.getCurrentPage();
      const stageRect = this.getPreviewStageRect();
      if (!currentPage || !stageRect) {
        return;
      }

      const selected = this.getSelectedStamp();
      const selectedSettings = selected?.settings;
      const widthPoints = selectedSettings
        ? stampWidthPoints(selectedSettings.placement.width, currentPage)
        : DEFAULT_STAMP_WIDTH_POINTS;
      const placement = placementFromPointer(
        currentPage.id,
        event.clientX,
        event.clientY,
        stageRect,
        currentPage,
        {
          widthPoints,
          heightPoints: selectedSettings?.placement.height,
          baseHeight: this.stampBaseHeightFor(selectedSettings ?? defaultStampSettings(), selected?.id ?? null),
          rotation: selectedSettings?.placement.rotation ?? 0,
        },
      );
      if (selected) {
        this.activeStamp = {
          ...selected.settings,
          placement,
        };
      } else {
        const created = this.createStamp(placement);
        this.state.stamps = [...this.state.stamps, created];
        this.state.selectedStampId = created.id;
      }
      this.invalidateLastExport();
      this.renderStampControls();
      this.renderThumbnailRail();
      this.renderPreviewStamp();
    });

    this.elements.previewStamp.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const stampObject = target.closest<HTMLElement>('[data-stamp-id]');
      const stampId = stampObject?.dataset.stampId;
      if (!stampId) {
        return;
      }

      if (this.state.selectedStampId !== stampId) {
        this.state.selectedStampId = stampId;
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
      const stampId = target.closest<HTMLElement>('[data-stamp-id]')?.dataset.stampId;
      if (!key || !isStampValueKey(key) || !stampId) {
        return;
      }

      const stamp = this.state.stamps.find((candidate) => candidate.id === stampId);
      if (!stamp) {
        return;
      }

      this.state.stamps = this.state.stamps.map((candidate) =>
        candidate.id === stampId
          ? { ...candidate, settings: { ...candidate.settings, [key]: target.value } }
          : candidate,
      );
      this.invalidateLastExport();
      this.persistPreferences();
    });

    this.elements.previewStamp.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!this.state.bundle) {
        return;
      }

      const handle = target.closest<HTMLElement>('[data-stamp-handle]')?.dataset.stampHandle as ResizeHandle | undefined;
      const rotateHandle = target.closest<HTMLElement>('[data-stamp-action="rotate-stamp"]');
      const stampCard = target.closest<HTMLElement>('[data-stamp-id]');

      if (!handle && !rotateHandle && target.closest('input, select, textarea, button')) {
        return;
      }

      if (!rotateHandle && !handle && !stampCard) {
        return;
      }

      const pressedStampId = stampCard?.dataset.stampId;
      const pressedStamp = this.state.stamps.find((stamp) => stamp.id === pressedStampId);
      if (!pressedStamp || !isStampPlaced(pressedStamp.settings)) {
        return;
      }

      if (this.state.selectedStampId !== pressedStamp.id) {
        this.state.selectedStampId = pressedStamp.id;
        this.renderStampControls();
        this.renderPreviewStamp();
      }

      const stageRect = this.getPreviewStageRect();
      const stampBody = stampCard?.querySelector<HTMLElement>('.preview-stamp-body')
        ?? this.elements.previewStamp.querySelector<HTMLElement>('.preview-stamp-body');
      const currentPage = this.getCurrentPage();
      if (!stageRect || !stampBody || !currentPage) {
        return;
      }

      const startWidth = stampWidthPoints(pressedStamp.settings.placement.width, currentPage);
      // Normalise legacy relative widths to absolute points, but keep the
      // height untouched (it may be `undefined` for auto aspect). Forcing an
      // explicit height here would freeze the aspect and stop the stamp from
      // growing when an image is added later.
      const startPlacement = {
        ...pressedStamp.settings.placement,
        width: startWidth,
      };
      if (startPlacement.width !== pressedStamp.settings.placement.width) {
        this.activeStamp = {
          ...pressedStamp.settings,
          placement: startPlacement,
        };
      }

      event.preventDefault();
      const kind: StampInteraction['kind'] =
        rotateHandle ? 'rotate' : handle ? 'resize' : 'drag';
      this.stampInteraction = {
        kind,
        stampId: pressedStamp.id,
        handle,
        startClientX: event.clientX,
        startClientY: event.clientY,
        stageRect,
        startPlacement,
        startWidthPx: stampBody.offsetWidth,
        startHeightPx: stampBody.offsetHeight,
      };

      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
    });

    this.elements.previewTextboxes.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const boxId = target.closest<HTMLElement>('[data-textbox-id]')?.dataset.textboxId;
      if (!boxId) {
        return;
      }

      this.state.selectedTextBoxId = boxId;
      this.renderPreviewTextboxes();
    });

    const onTextBoxEdit = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      const boxId = target.closest<HTMLElement>('[data-textbox-id]')?.dataset.textboxId;
      if (!boxId) {
        return;
      }

      if (target instanceof HTMLInputElement) {
        const nextText = target.value;
        this.state.textBoxes = this.state.textBoxes.map((box) =>
          box.id === boxId ? { ...box, text: nextText } : box,
        );
        this.invalidateLastExport();
        return;
      }

      const nextSize = Number(target.value);
      if (!TEXTBOX_FONT_SIZES.includes(nextSize)) {
        return;
      }

      this.state.textBoxes = this.state.textBoxes.map((box) =>
        box.id === boxId ? { ...box, fontSize: nextSize } : box,
      );
      this.invalidateLastExport();
      this.renderPreviewTextboxes();
    };

    this.elements.previewTextboxes.addEventListener('input', onTextBoxEdit);
    this.elements.previewTextboxes.addEventListener('change', onTextBoxEdit);

    this.elements.previewTextboxes.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!this.state.bundle) {
        return;
      }

      const boxId = target.closest<HTMLElement>('[data-textbox-id]')?.dataset.textboxId;
      if (!boxId) {
        return;
      }

      if (target.closest('input, select, textarea, button')) {
        return;
      }

      const box = this.state.textBoxes.find((candidate) => candidate.id === boxId);
      const stageRect = this.getPreviewStageRect();
      if (!box || !stageRect) {
        return;
      }

      this.state.selectedTextBoxId = boxId;
      this.renderPreviewTextboxes();

      event.preventDefault();
      this.textBoxInteraction = {
        boxId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: box.x,
        startY: box.y,
        stageRect,
      };

      window.addEventListener('pointermove', this.onTextBoxPointerMove);
      window.addEventListener('pointerup', this.onTextBoxPointerUp);
      window.addEventListener('pointercancel', this.onTextBoxPointerUp);
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
        this.activeStamp = {
          ...this.activeStamp,
          [stampSetting]: nextValue,
        };
        this.invalidateLastExport();
        if (stampSetting === 'date') {
          // The date input fires on every keystroke while the picker is
          // open; re-rendering the inspector here would drop focus and close
          // the picker. The preview overlay reads the same state.
          this.persistPreferences();
          this.renderPreviewStamp();
          return;
        }
        this.persistPreferences();
        this.renderStampControls();
        this.renderPreviewStamp();
        return;
      }

      const uiSetting = target.dataset.uiSetting;
      if (uiSetting === 'blank-insert-mode') {
        this.state.blankInsertMode = target.value === 'at-end' ? 'at-end' : 'after-current';
        this.persistPreferences();
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
      this.persistPreferences();
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
      this.state.stamps = this.state.stamps.map((stamp) => ({
        ...stamp,
        settings: syncStampFromProfile(previousProfile, nextProfile, stamp.settings),
      }));
      this.persistPreferences();
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
        this.state.stamps = this.state.stamps.map((stamp) => ({
          ...stamp,
          settings: syncStampFromProfile(previousProfile, nextProfile, stamp.settings),
        }));
      }

      this.persistPreferences();
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
      this.state.selectedStampId = null;
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
      this.state.selectedStampId = null;
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
      this.state.selectedStampId = null;
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

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.state.passwordDialog) {
          this.cancelPassword('Password entry cancelled.');
          return;
        }
        if (this.state.signatureOpen) {
          this.closeSignatureDialog();
          return;
        }
        if (this.state.advancedOpen) {
          this.state.advancedOpen = false;
          this.renderAdvancedSheetVisibility();
        }
        return;
      }

      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        // Never hijack typing, selecting, or modal dialogs.
        if (this.state.passwordDialog || this.state.signatureOpen) {
          return;
        }

        const target = event.target;
        const typing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (typing || !this.getSelectedStamp()) {
          return;
        }

        event.preventDefault();
        const step = event.shiftKey ? 20 : 4;
        if (event.key === 'ArrowUp') {
          this.nudgeSelectedStamp(0, -step);
        } else if (event.key === 'ArrowDown') {
          this.nudgeSelectedStamp(0, step);
        } else if (event.key === 'ArrowLeft') {
          this.nudgeSelectedStamp(-step, 0);
        } else {
          this.nudgeSelectedStamp(step, 0);
        }
      }
    });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const interaction = this.stampInteraction;
    const dragged = interaction
      ? this.state.stamps.find((stamp) => stamp.id === interaction.stampId)
      : undefined;
    if (!interaction || !dragged || !isStampPlaced(dragged.settings)) {
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
      this.updatePlacementFromPixels(
        interaction.stampId,
        nextCenterX,
        nextCenterY,
        interaction.startPlacement.width,
        interaction.startPlacement.height,
        halfWidth,
        halfHeight,
      );
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
      this.state.stamps = this.state.stamps.map((stamp) =>
        stamp.id === interaction.stampId
          ? {
              ...stamp,
              settings: {
                ...stamp.settings,
                placement: { ...stamp.settings.placement, rotation: nextRotation },
              },
            }
          : stamp,
      );
      this.invalidateLastExport();
      this.renderPreviewStamp();
      return;
    }

    const currentPage = this.getCurrentPage();
    if (!currentPage) {
      return;
    }

    const nextSizePx = resizePreviewSizeFromHandle(interaction.handle!, {
      centerX: stageRect.left + startCenterX,
      centerY: stageRect.top + startCenterY,
      startX: interaction.startClientX,
      startY: interaction.startClientY,
      currentX: event.clientX,
      currentY: event.clientY,
      rotation: interaction.startPlacement.rotation,
      startWidth: interaction.startWidthPx,
      startHeight: interaction.startHeightPx,
      minWidth: xPointsToPreviewPixels(STAMP_MIN_WIDTH_POINTS, currentPage, stageRect),
      minHeight: yPointsToPreviewPixels(STAMP_MIN_WIDTH_POINTS, currentPage, stageRect),
    });
    const handle = interaction.handle!;
    const horizontal = handle.includes('e') || handle.includes('w');
    const vertical = handle.includes('n') || handle.includes('s');
    // Preserve the untouched axis (including `undefined` auto height) so a
    // pure horizontal resize keeps auto aspect instead of freezing it.
    const nextWidthPoints = horizontal
      ? previewPixelsToXPoints(nextSizePx.width, currentPage, stageRect)
      : interaction.startPlacement.width;
    const nextHeightPoints = vertical
      ? previewPixelsToYPoints(nextSizePx.height, currentPage, stageRect)
      : interaction.startPlacement.height;
    this.updatePlacementFromPixels(
      interaction.stampId,
      startCenterX,
      startCenterY,
      nextWidthPoints,
      nextHeightPoints,
      nextSizePx.width / 2,
      nextSizePx.height / 2,
    );
    this.renderPreviewStamp();
  };

  private readonly onPointerUp = (): void => {
    if (this.stampInteraction) {
      // Suppress the click that the browser fires right after this
      // pointerup so a drag does not also trigger click-to-move. Clear on a
      // timer so a drag that ends off-canvas does not eat the *next*
      // unrelated click.
      this.suppressNextPreviewClick = true;
      window.setTimeout(() => {
        this.suppressNextPreviewClick = false;
      }, 0);
    }

    this.stampInteraction = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.renderPreviewStamp();
  };

  private readonly onTextBoxPointerMove = (event: PointerEvent): void => {
    const interaction = this.textBoxInteraction;
    if (!interaction) {
      return;
    }

    const deltaX = (event.clientX - interaction.startClientX) / interaction.stageRect.width;
    const deltaY = (event.clientY - interaction.startClientY) / interaction.stageRect.height;
    const nextX = clampValue(interaction.startX + deltaX, 0, 1);
    const nextY = clampValue(interaction.startY + deltaY, 0, 1);
    this.state.textBoxes = this.state.textBoxes.map((box) =>
      box.id === interaction.boxId ? { ...box, x: nextX, y: nextY } : box,
    );
    this.invalidateLastExport();
    this.renderPreviewTextboxes();
  };

  private readonly onTextBoxPointerUp = (): void => {
    if (this.textBoxInteraction) {
      this.suppressNextPreviewClick = true;
      window.setTimeout(() => {
        this.suppressNextPreviewClick = false;
      }, 0);
    }

    this.textBoxInteraction = null;
    window.removeEventListener('pointermove', this.onTextBoxPointerMove);
    window.removeEventListener('pointerup', this.onTextBoxPointerUp);
    window.removeEventListener('pointercancel', this.onTextBoxPointerUp);
    this.renderPreviewTextboxes();
  };

  private getSelectedStamp(): PlacedStamp | null {
    if (!this.state.selectedStampId) {
      return null;
    }

    return this.state.stamps.find((stamp) => stamp.id === this.state.selectedStampId) ?? null;
  }

  /**
   * The selected stamp's settings. Reads fall back to a throwaway default
   * when nothing is selected; writes are dropped in that case.
   */
  private get activeStamp(): StampSettings {
    return this.getSelectedStamp()?.settings ?? defaultStampSettings();
  }

  private set activeStamp(next: StampSettings) {
    const selected = this.getSelectedStamp();
    if (!selected) {
      return;
    }

    this.state.stamps = this.state.stamps.map((stamp) =>
      stamp.id === selected.id ? { ...stamp, settings: next } : stamp,
    );
  }

  private stampImageUrlFor(stampId: string): string | null {
    return this.stampImageUrls.get(stampId) ?? null;
  }

  private createStamp(placement: StampPlacement): PlacedStamp {
    this.stampSerial += 1;
    const settings = syncStampFromProfile({}, this.state.profile, {
      ...defaultStampSettings(),
      placement,
      date: this.state.profile.date || todayInputValue(),
    });
    return { id: `stamp-${Date.now()}-${this.stampSerial}`, settings };
  }

  /** Move the selected stamp by points (positive y moves down on screen). */
  private nudgeSelectedStamp(dxPoints: number, dyPoints: number): void {
    const selected = this.getSelectedStamp();
    const currentPage = this.getCurrentPage();
    if (!selected || !currentPage) {
      return;
    }

    const placement = selected.settings.placement;
    this.activeStamp = {
      ...selected.settings,
      placement: {
        ...placement,
        x: clampValue(placement.x + dxPoints / currentPage.width, 0, 1),
        y: clampValue(placement.y + dyPoints / currentPage.height, 0, 1),
      },
    };
    this.invalidateLastExport();
    this.renderStampControls();
    this.renderPreviewStamp();
    this.renderThumbnailRail();
  }

  private addStamp(): void {    if (!this.state.bundle) {
      return;
    }

    const draft = this.createStamp({ ...defaultStampSettings().placement });
    this.state.stamps = [...this.state.stamps, draft];
    this.state.selectedStampId = draft.id;
    this.invalidateLastExport();
    this.renderStampControls();
    this.renderPreviewStamp();
    this.renderThumbnailRail();
    this.setNotice('Stamp added. Click on the page to place it.', 'neutral');
    this.renderStatus();
  }

  private updatePlacementFromPixels(
    stampId: string,
    centerXPx: number,
    centerYPx: number,
    widthPoints: number,
    heightPoints: number | undefined,
    halfWidthPx: number,
    halfHeightPx: number,
  ): void {
    const stageRect = this.getPreviewStageRect();
    if (!stageRect || !this.state.previewPageId) {
      return;
    }

    let nextX = clampPreviewCenter(centerXPx, halfWidthPx, stageRect.width);
    let nextY = clampPreviewCenter(centerYPx, halfHeightPx, stageRect.height);

    if (Math.abs(nextX - 0.5) < STAMP_SNAP_THRESHOLD) {
      nextX = 0.5;
    }

    if (Math.abs(nextY - 0.5) < STAMP_SNAP_THRESHOLD) {
      nextY = 0.5;
    }

    const pageId = this.state.previewPageId;
    this.state.stamps = this.state.stamps.map((stamp) =>
      stamp.id === stampId
        ? {
            ...stamp,
            settings: {
              ...stamp.settings,
              placement: {
                ...stamp.settings.placement,
                pageId,
                x: nextX,
                y: nextY,
                width: widthPoints,
                height: heightPoints,
              },
            },
          }
        : stamp,
    );
    this.invalidateLastExport();
  }

  private async handlePdf(file: File, password?: string): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.setNotice('Use a PDF file for this workflow.', 'error');
      this.renderStatus();
      return;
    }

    this.clearLastExport();
    this.state.exportConfirmArmed = false;
    const loadAttempt = ++this.loadToken;
    this.state.loadingPdf = true;
    this.setNotice('Loading the PDF locally and building the page surface…', 'busy');
    this.renderStatus();
    this.renderControlState();
    this.renderExportPanel();
    this.showPreviewHint('Loading PDF preview…');

    try {
      await this.releasePreviewDocument();
      const { loadPdfBundle } = await getPdfModule();
      let lastPercent = -1;
      const stageMessage = {
        parse: 'Parsing the PDF locally…',
        fields: 'Reading form fields…',
        text: 'Reading page text…',
      } as const;
      const bundle = await loadPdfBundle(file, password, {
        onProgress: (loaded, total) => {
          if (loadAttempt !== this.loadToken || !total || total <= 0) {
            return;
          }

          const percent = Math.min(100, Math.floor((loaded / total) * 100));
          if (percent >= lastPercent + 5) {
            lastPercent = percent;
            this.setNotice(`Loading the PDF locally… ${percent}%`, 'busy');
            this.renderStatus();
          }
        },
        onStage: (stage) => {
          if (loadAttempt !== this.loadToken) {
            return;
          }

          this.setNotice(stageMessage[stage], 'busy');
          this.renderStatus();
        },
      });
      if (loadAttempt !== this.loadToken) {
        return;
      }
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
      // New document: keep stamp content (repeat stamping workflow) but drop
      // placements and selection; text boxes belong to the old pages.
      this.state.stamps = this.state.stamps.map((stamp) => ({
        ...stamp,
        settings: syncStampFromProfile(previousProfile, seededProfile, {
          ...stamp.settings,
          placement: { ...stamp.settings.placement, pageId: null },
          date: seededProfile.date || stamp.settings.date || todayInputValue(),
        }),
      }));
      this.state.selectedStampId = null;
      this.state.textBoxes = [];
      this.state.selectedTextBoxId = null;

      this.state.passwordDialog = null;
      this.pendingPasswordFile = null;
      this.state.encryptedReadOnly = bundle.encrypted;
      this.renderPasswordDialog();

      this.reapplyProfile();
      this.renderThumbnailRail();
      this.renderStampControls();
      this.renderPreviewMeta();
      await this.renderPreview();

      if (bundle.encrypted) {
        this.setNotice(
          `Password accepted. ${bundle.pageCount} page${bundle.pageCount === 1 ? '' : 's'} unlocked for preview, but export is disabled for encrypted PDFs.`,
          'warning',
        );
      } else {
        this.setNotice(
          `Ready. ${bundle.pageCount} page${bundle.pageCount === 1 ? '' : 's'} loaded. Click on the page to place your stamp.`,
          'success',
        );
      }
    } catch (error) {
      console.error(error);
      const { isIncorrectPassword, isPasswordException } = await getPdfModule();
      if (isPasswordException(error)) {
        this.pendingPasswordFile = file;
        this.state.passwordDialog = {
          fileName: file.name,
          error: isIncorrectPassword(error) ? 'That password was not accepted. Try again.' : '',
        };
        this.setNotice('This PDF is password protected. Enter the document password.', 'neutral');
        this.renderPasswordDialog();
        this.renderStatus();
        return;
      }
      this.state.bundle = null;
      this.state.pages = [];
      this.state.fields = [];
      this.state.stats = EMPTY_STATS;
      this.state.previewPageId = null;
      this.state.selectedStampId = null;
      this.state.encryptedReadOnly = false;
      this.setNotice(
        'The PDF could not be parsed. It may be malformed or use features this workflow does not support.',
        'error',
      );
      this.renderThumbnailRail();
      this.renderFillStats();
      this.renderPreviewMeta();
    } finally {
      if (loadAttempt !== this.loadToken) {
        return;
      }

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
    let target = this.getSelectedStamp();
    if (!target) {
      const draft = this.createStamp({ ...defaultStampSettings().placement });
      this.state.stamps = [...this.state.stamps, draft];
      this.state.selectedStampId = draft.id;
      target = draft;
    }
    this.clearSelectedStampImage();
    this.activeStamp = {
      ...target.settings,
      mode: target.settings.mode === 'text' ? 'both' : target.settings.mode,
      imageBytes: new Uint8Array(await file.arrayBuffer()),
      imageMime: mime,
      imageName: file.name,
    };
    const applied = this.getSelectedStamp();
    if (applied) {
      this.stampImageUrls.set(applied.id, URL.createObjectURL(file));
    }
    this.persistPreferences();
    this.setNotice(
      applied && isStampPlaced(applied.settings)
        ? `Image added from ${file.name}.`
        : `Image added from ${file.name}. Place the stamp to preview it.`,
      'success',
    );
    this.renderStatus();
    this.renderStampControls();
    this.renderPreviewStamp();
  }

  private async handleExport(): Promise<void> {
    if (!this.state.bundle || this.state.loadingPdf || this.state.exporting) {
      return;
    }

    if (this.state.encryptedReadOnly) {
      this.setNotice('Export is disabled for encrypted PDFs. The local engine cannot safely rewrite them.', 'error');
      this.renderStatus();
      return;
    }

    // Two-step export when fields still need attention: first click warns,
    // second click confirms. Any edit disarms via invalidateLastExport.
    if (this.state.stats.remainingCount > 0 && !this.state.exportConfirmArmed) {
      this.state.exportConfirmArmed = true;
      const count = this.state.stats.remainingCount;
      this.setNotice(
        `${count} field${count === 1 ? '' : 's'} still need${count === 1 ? 's' : ''} attention in Document Fields. Click ${this.state.lastExportUrl ? 'Regenerate' : 'Generate stamped PDF'} again to export anyway.`,
        'warning',
      );
      this.renderStatus();
      this.renderExportPanel();
      return;
    }
    this.state.exportConfirmArmed = false;

    const sourceBytes = this.state.bundle.sourceBytes;
    const outputName = outputFileName(this.state.bundle.fileName);
    const fields = this.state.fields.map((field) => ({
      ...field,
      options: [...field.options],
    }));
    const stamps = this.state.stamps.map((stamp) => cloneStampSettings(stamp.settings));
    const pages = this.state.pages.map((page) => ({ ...page }));
    const textBoxes = this.state.textBoxes.map((box) => ({ ...box }));

    try {
      const { exportFilledPdf } = await getPdfModule();
      this.state.exporting = true;
      this.setNotice('Generating the stamped PDF locally…', 'busy');
      this.renderStatus();
      this.renderControlState();
      this.renderExportPanel();

      const blob = await exportFilledPdf(sourceBytes, fields, stamps, pages, textBoxes);
      this.setLastExport(blob, outputName);
      const truncatedExport = stamps.flatMap((stamp) =>
        shouldShowStampTable(stamp, Boolean(stamp.imageBytes))
          ? buildStampRows(stamp).filter((row) =>
              wrapStampText(displayStampRowValue(row), row.maxCharsPerLine, row.maxLines).truncated,
            )
          : [],
      );
      if (truncatedExport.length > 0) {
        this.setNotice(
          'Stamped PDF is ready, but some stamp text was cut off. Shorten it or enlarge the stamp, then regenerate.',
          'warning',
        );
      } else {
        this.setNotice('Stamped PDF is ready. Click Download stamped PDF.', 'success');
      }
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
    this.state.selectedStampId = null;
    this.invalidateLastExport();
    this.renderControlState();
    this.renderThumbnailRail();
    this.renderStampControls();
    this.renderPreviewMeta();
    void this.renderPreview();
    this.setNotice('Blank page added. Click anywhere on it if you want to move the stamp there.', 'neutral');
    this.renderStatus();
  }

  private openSignatureDialog(): void {
    if (!this.state.bundle) {
      return;
    }

    this.state.signatureOpen = true;
    this.renderSignatureDialog();
  }

  private closeSignatureDialog(): void {
    this.state.signatureOpen = false;
    this.signatureHasInk = false;
    this.renderSignatureDialog();
  }

  private renderSignatureDialog(): void {
    if (!this.state.signatureOpen) {
      this.updateContainerMarkup(this.elements.signatureDialog, '');
      return;
    }

    this.updateContainerMarkup(this.elements.signatureDialog, `
      <div class="signature-overlay">
        <div class="signature-card" role="dialog" aria-modal="true" aria-label="Draw signature">
          <p class="eyebrow">Signature</p>
          <h2>Draw or type your signature</h2>
          <p>It becomes an image stamp you can place anywhere. Nothing leaves this tab.</p>
          <canvas id="signature-canvas" class="signature-canvas" width="480" height="180" aria-label="Signature drawing pad"></canvas>
          <label class="inspector-field">
            <span>Or type a name to render it</span>
            <input id="signature-typed" type="text" placeholder="Taylor Smith" autocomplete="off" />
          </label>
          <div class="inspector-actions">
            <button type="button" class="ghost-button" data-action="render-signature-text">Render text</button>
            <button type="button" class="ghost-button" data-action="clear-signature-pad">Clear</button>
          </div>
          <div class="inspector-actions">
            <button type="button" class="action-button is-primary" data-action="use-signature">Use signature</button>
            <button type="button" class="ghost-button" data-action="cancel-signature">Cancel</button>
          </div>
        </div>
      </div>
    `);
    this.signatureHasInk = false;
    this.wireSignaturePad();
    this.elements.signatureDialog.querySelector<HTMLInputElement>('#signature-typed')?.focus({ preventScroll: true });
  }

  private signatureCanvasContext(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
    const canvas = this.elements.signatureDialog.querySelector<HTMLCanvasElement>('#signature-canvas');
    const context = canvas?.getContext('2d') ?? null;
    if (!canvas || !context) {
      return null;
    }

    return { canvas, context };
  }

  private wireSignaturePad(): void {
    const pad = this.signatureCanvasContext();
    if (!pad) {
      return;
    }

    const { canvas, context } = pad;
    const pixelRatio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 480;
    const cssHeight = 180;
    canvas.width = Math.floor(cssWidth * pixelRatio);
    canvas.height = Math.floor(cssHeight * pixelRatio);
    canvas.style.height = `${cssHeight}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#1d1816';

    let drawing = false;
    let last: { x: number; y: number } | null = null;
    const position = (event: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    canvas.addEventListener('pointerdown', (event) => {
      drawing = true;
      last = position(event);
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drawing || !last) {
        return;
      }

      event.preventDefault();
      const next = position(event);
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      last = next;
      this.signatureHasInk = true;
    });
    const stop = (): void => {
      drawing = false;
      last = null;
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  private renderSignatureText(): void {
    const pad = this.signatureCanvasContext();
    const name = this.elements.signatureDialog.querySelector<HTMLInputElement>('#signature-typed')?.value.trim() ?? '';
    if (!pad) {
      return;
    }

    if (!name) {
      this.setNotice('Type a name first, or draw directly on the pad.', 'error');
      this.renderStatus();
      return;
    }

    const { canvas, context } = pad;
    const cssWidth = canvas.clientWidth || 480;
    context.save();
    context.font = 'italic 52px Georgia, "Times New Roman", serif';
    context.fillStyle = '#1d1816';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, cssWidth / 2, 90, cssWidth - 32);
    context.restore();
    this.signatureHasInk = true;
  }

  private clearSignaturePad(): void {
    const pad = this.signatureCanvasContext();
    if (!pad) {
      return;
    }

    pad.context.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    this.signatureHasInk = false;
  }

  private async useSignature(): Promise<void> {
    const pad = this.signatureCanvasContext();
    if (!pad) {
      return;
    }

    if (!this.signatureHasInk) {
      this.setNotice('Draw or type your signature first.', 'error');
      this.renderStatus();
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => pad.canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      this.setNotice('The signature could not be captured in this browser.', 'error');
      this.renderStatus();
      return;
    }

    this.invalidateLastExport();
    const name = `signature-${new Date().toISOString().slice(0, 10)}.png`;
    const draft = this.createStamp({ ...defaultStampSettings().placement });
    draft.settings.mode = 'image';
    draft.settings.imageBytes = new Uint8Array(await blob.arrayBuffer());
    draft.settings.imageMime = 'image/png';
    draft.settings.imageName = name;
    this.state.stamps = [...this.state.stamps, draft];
    this.state.selectedStampId = draft.id;
    this.stampImageUrls.set(draft.id, URL.createObjectURL(blob));
    this.state.signatureOpen = false;
    this.signatureHasInk = false;
    this.renderSignatureDialog();
    this.persistPreferences();
    this.setNotice('Signature added. Click on the page to place it.', 'success');
    this.renderStatus();
    this.renderStampControls();
    this.renderThumbnailRail();
    this.renderPreviewStamp();
  }

  private submitPassword(): void {
    const file = this.pendingPasswordFile;
    if (!file) {
      this.cancelPassword('Password entry cancelled.');
      return;
    }

    const password = this.elements.passwordDialog.querySelector<HTMLInputElement>('#password-input')?.value ?? '';
    if (!password) {
      this.state.passwordDialog = { fileName: file.name, error: 'Enter the document password.' };
      this.renderPasswordDialog();
      return;
    }

    void this.handlePdf(file, password);
  }

  private cancelPassword(message: string): void {
    this.pendingPasswordFile = null;
    this.state.passwordDialog = null;
    this.renderPasswordDialog();
    this.setNotice(message, 'neutral');
    this.renderStatus();
  }

  private addTextBox(): void {
    const currentPage = this.getCurrentPage();
    if (!this.state.bundle || !currentPage) {
      return;
    }

    this.textBoxSerial += 1;
    const box: PlacedTextBox = {
      id: `text-${Date.now()}-${this.textBoxSerial}`,
      pageId: currentPage.id,
      x: 0.5,
      y: 0.5,
      text: '',
      fontSize: DEFAULT_TEXTBOX_FONT_SIZE,
    };

    this.state.textBoxes = [...this.state.textBoxes, box];
    this.state.selectedTextBoxId = box.id;
    this.invalidateLastExport();
    this.renderPreviewTextboxes();
    this.setNotice('Text box added. Type into it, then drag it where it belongs.', 'neutral');
    this.renderStatus();
    this.elements.previewTextboxes
      .querySelector<HTMLInputElement>(`[data-textbox-id="${escapeSelector(box.id)}"] input`)
      ?.focus({ preventScroll: true });
  }

  private deleteTextBox(boxId: string): void {
    if (!this.state.textBoxes.some((box) => box.id === boxId)) {
      return;
    }

    this.state.textBoxes = this.state.textBoxes.filter((box) => box.id !== boxId);
    if (this.state.selectedTextBoxId === boxId) {
      this.state.selectedTextBoxId = null;
    }
    this.invalidateLastExport();
    this.renderPreviewTextboxes();
    this.setNotice('Text box removed.', 'neutral');
    this.renderStatus();
  }

  private async downloadLastExport(): Promise<void> {
    if (!this.state.lastExportBlob || !this.state.lastExportName || !this.state.lastExportUrl) {
      return;
    }

    const savePicker = getSaveFilePicker();
    if (savePicker) {
      try {
        const handle = await savePicker({
          suggestedName: this.state.lastExportName,
          types: [
            {
              description: 'PDF document',
              accept: {
                'application/pdf': ['.pdf'],
              },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(this.state.lastExportBlob);
        await writable.close();
        this.setNotice(`Stamped PDF saved as ${this.state.lastExportName}.`, 'success');
        this.renderStatus();
        return;
      } catch (error) {
        // The native picker may be unavailable, denied, or headless: fall
        // through to the anchor download so the file still reaches the user.
        // User-cancelled dialogs stay quiet; anything else gets logged.
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error(error);
        }
      }
    }

    triggerBrowserDownload(this.state.lastExportUrl, this.state.lastExportName);
  }

  private deleteCurrentPage(): void {
    const currentIndex = this.getCurrentPageIndex();
    if (currentIndex === -1) {
      return;
    }

    if (this.state.pages.length <= 1) {
      this.setNotice('Add another page before removing the last remaining one.', 'error');
      this.renderStatus();
      return;
    }

    const pageToRemove = this.state.pages[currentIndex]!;
    const remainingPages = this.state.pages.filter((_, index) => index !== currentIndex);
    const nextIndex = Math.min(currentIndex, remainingPages.length - 1);
    const removedLabel = pageToRemove.kind === 'blank' ? 'Blank page' : `Page ${pageToRemove.pageNumber}`;
    const removedStampCount = this.state.stamps.filter(
      (stamp) => stamp.settings.placement.pageId === pageToRemove.id,
    ).length;
    const removedTextBoxes = this.state.textBoxes.filter((box) => box.pageId === pageToRemove.id);

    this.state.pages = remainingPages;
    this.state.previewPageId = remainingPages[nextIndex]?.id ?? null;
    this.state.selectedStampId = null;
    this.state.stamps = this.state.stamps.map((stamp) =>
      stamp.settings.placement.pageId === pageToRemove.id
        ? { ...stamp, settings: { ...stamp.settings, placement: { ...stamp.settings.placement, pageId: null } } }
        : stamp,
    );
    this.state.textBoxes = this.state.textBoxes.filter((box) => box.pageId !== pageToRemove.id);
    if (this.state.selectedTextBoxId && removedTextBoxes.some((box) => box.id === this.state.selectedTextBoxId)) {
      this.state.selectedTextBoxId = null;
    }
    this.invalidateLastExport();
    this.renderControlState();
    this.renderThumbnailRail();
    this.renderStampControls();
    this.renderPreviewMeta();
    void this.renderPreview();
    this.setNotice(
      removedStampCount > 0
        ? `${removedLabel} removed. ${removedStampCount} stamp${removedStampCount === 1 ? '' : 's'} moved off it.`
        : `${removedLabel} removed.`,
      'neutral',
    );
    this.renderStatus();
  }

  private deleteStamp(): void {
    const selected = this.getSelectedStamp();
    if (!selected) {
      return;
    }

    this.clearSelectedStampImage();
    this.state.stamps = this.state.stamps.filter((stamp) => stamp.id !== selected.id);
    this.state.selectedStampId = null;
    this.invalidateLastExport();
    this.renderControlState();
    this.renderThumbnailRail();
    this.renderStampControls();
    this.renderPreviewMeta();
    this.setNotice('Stamp deleted.', 'neutral');
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
    this.renderFillStats();
  }

  private renderAll(): void {
    this.renderChromeVisibility();
    this.renderControlState();
    this.renderStatus();
    this.renderThumbnailRail();
    this.renderProfileFields();
    this.renderFieldList();
    this.renderFillStats();
    this.renderPasswordDialog();
    this.renderSignatureDialog();
    this.renderStampControls();
    this.renderExportPanel();
    this.renderPreviewMeta();
    this.renderAdvancedSheetVisibility();
  }

  private renderControlState(): void {
    this.renderChromeVisibility();
    this.elements.uploadButton.disabled = this.state.loadingPdf;
    this.elements.addBlankPageButton.disabled = !this.state.bundle || this.state.loadingPdf;
    this.elements.addTextBoxButton.disabled = !this.state.bundle || this.state.loadingPdf;
    this.elements.deletePageButton.disabled =
      !this.state.bundle || this.state.loadingPdf || this.state.pages.length <= 1 || this.getCurrentPageIndex() === -1;
    const currentIndex = this.getCurrentPageIndex();
    this.elements.prevPageButton.disabled = currentIndex <= 0;
    this.elements.nextPageButton.disabled = currentIndex === -1 || currentIndex >= this.state.pages.length - 1;
    this.elements.overwriteToggle.disabled = !this.state.bundle;
    this.elements.overwriteToggle.checked = this.state.overwriteExisting;
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
        const stampCount = this.state.stamps.filter(
          (stamp) => stamp.settings.placement.pageId === page.id,
        ).length;
        return `
          <button type="button" class="thumb ${isActive ? 'is-active' : ''}" data-page-id="${page.id}">
            <span class="thumb-paper ${page.kind === 'blank' ? 'is-blank' : ''}">
              <span class="thumb-lines"></span>
            </span>
            <span class="thumb-meta">
              <strong>${page.kind === 'blank' ? 'Blank' : `Page ${page.pageNumber}`}</strong>
              <span>${index + 1} / ${this.state.pages.length}</span>
            </span>
            ${stampCount > 0 ? `<span class="thumb-stamp-flag">${stampCount > 1 ? `${stampCount} stamps` : 'Stamp'}</span>` : ''}
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

  private renderFillStats(): void {
    const copy = !this.state.bundle
      ? 'Field stats appear here after parsing.'
      : this.state.fields.length === 0
        ? 'No AcroForm fields were detected in this PDF.'
        : `${this.state.stats.autofilledCount} of ${this.state.stats.editableCount} fields auto-filled · ${this.state.stats.remainingCount} need attention`;
    this.updateContainerMarkup(this.elements.fillStats, escapeHtml(copy));
  }

  private renderStampControls(): void {
    const bundleLoaded = Boolean(this.state.bundle);
    const selected = this.getSelectedStamp();
    const settings = selected?.settings;
    const hasImage = selected ? this.stampImageUrls.has(selected.id) : false;
    const currentPage = this.getCurrentPage();
    const side = this.getInspectorSide();
    const truncatedKeys = bundleLoaded ? this.stampTruncation() : [];
    this.elements.stampControls.className = `floating-inspector is-${side}`;
    if (!bundleLoaded) {
      this.updateContainerMarkup(this.elements.stampControls, `
        <div class="inspector-copy">
          <p class="eyebrow">Stamp</p>
          <h2>Keep the page in the middle.</h2>
          <p>Upload a PDF and place approval stamps exactly where they need to land.</p>
        </div>
      `);
      return;
    }

    if (!selected || !settings) {
      this.updateContainerMarkup(this.elements.stampControls, `
        <div class="inspector-copy">
          <p class="eyebrow">Stamp</p>
          <h2>No stamp selected.</h2>
          <p>Add a stamp, then click on the page to place it. Click any placed stamp to edit it.</p>
        </div>
        <div class="inspector-controls">
          <label class="inspector-field">
            <span>Blank page placement</span>
            <select data-ui-setting="blank-insert-mode">
              ${selectOption('after-current', 'After current page', this.state.blankInsertMode)}
              ${selectOption('at-end', 'Append to end', this.state.blankInsertMode)}
            </select>
          </label>
          <div class="inspector-actions">
            <button type="button" class="ghost-button" data-action="add-stamp">Add stamp</button>
            <button type="button" class="ghost-button" data-action="open-signature">Sign</button>
            <button type="button" class="ghost-button" data-action="open-advanced">Document fields</button>
          </div>
        </div>
      `);
      return;
    }

    const stampCount = this.state.stamps.length;
    const placementCopy = currentPage
      ? isStampPlaced(settings) && settings.placement.pageId === currentPage.id
        ? 'Drag to move. Pull the edges or corners to resize. Use the top handle to rotate.'
        : 'Click anywhere on this page to place or move the stamp here.'
      : 'Choose a page, then click to place the stamp.';

    this.updateContainerMarkup(this.elements.stampControls, `
      <div class="inspector-copy">
        <p class="eyebrow">Stamp${stampCount > 1 ? ` ${this.state.stamps.findIndex((stamp) => stamp.id === selected.id) + 1} of ${stampCount}` : ''}</p>
        <h2>Direct on-page editing.</h2>
        <p>${escapeHtml(placementCopy)}</p>
        ${truncatedKeys.length > 0 ? '<p class="inspector-warning">Some stamp text will be cut off on export. Shorten it or enlarge the stamp.</p>' : ''}
      </div>
      <div class="inspector-controls">
        <label class="inspector-field">
          <span>Mode</span>
          <select data-stamp-setting="mode">
            ${selectOption('text', 'Approval block', settings.mode)}
            ${selectOption('image', 'Image only', settings.mode)}
            ${selectOption('both', 'Block + image', settings.mode)}
          </select>
        </label>
        <label class="inspector-field">
          <span>Stamp date</span>
          <input data-stamp-setting="date" type="date" value="${escapeAttribute(settings.date)}" />
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
          <small>${
            hasImage && settings.imageName
              ? `Using ${escapeHtml(settings.imageName)}.`
              : 'Upload a PNG or JPG to add a seal, signature, or logo to the stamp.'
          }</small>
        </label>
        <label class="toggle">
          <input data-stamp-setting="flatten" type="checkbox" ${settings.flatten ? 'checked' : ''} />
          Flatten filled fields on export
        </label>
        <div class="inspector-actions">
          <button type="button" class="ghost-button" data-action="add-stamp">Add another stamp</button>
          <button type="button" class="ghost-button" data-action="open-signature">Sign</button>
          <button type="button" class="ghost-button" data-action="open-advanced">Document fields</button>
          <button type="button" class="ghost-button" data-action="delete-stamp">Delete stamp</button>
          <div class="nudge-row" role="group" aria-label="Nudge stamp">
            <button type="button" data-action="nudge-stamp" data-dx="0" data-dy="-4" aria-label="Move stamp up">↑</button>
            <button type="button" data-action="nudge-stamp" data-dx="0" data-dy="4" aria-label="Move stamp down">↓</button>
            <button type="button" data-action="nudge-stamp" data-dx="-4" data-dy="0" aria-label="Move stamp left">←</button>
            <button type="button" data-action="nudge-stamp" data-dx="4" data-dy="0" aria-label="Move stamp right">→</button>
          </div>
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
    const disabled = !this.state.bundle || this.state.loadingPdf || this.state.exporting || this.state.encryptedReadOnly;
    const armed = this.state.exportConfirmArmed && this.state.stats.remainingCount > 0;
    const primaryAction =
      this.state.lastExportUrl && this.state.lastExportName
        ? `
          <button type="button" class="action-button is-primary" data-action="download-export">
            Download stamped PDF
          </button>
          <button type="button" class="ghost-button" data-action="export-pdf" ${disabled ? 'disabled' : ''}>
            ${armed ? 'Confirm regenerate' : 'Regenerate'}
          </button>
        `
        : `
          <button type="button" class="action-button is-primary" data-action="export-pdf" ${disabled ? 'disabled' : ''}>
            ${this.state.exporting ? 'Working…' : armed ? 'Confirm export' : 'Generate stamped PDF'}
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
      this.elements.previewTextboxes.hidden = true;
      this.elements.previewTextboxes.innerHTML = '';
      this.elements.previewGuides.hidden = true;
      this.elements.previewHint.hidden = true;
      this.elements.previewFrame.classList.add('is-empty');
      this.clearPreviewOverlayFrame();
      return;
    }

    const pageIndex = this.getCurrentPageIndex();
    const label = currentPage.kind === 'blank' ? 'Blank page' : `Page ${currentPage.pageNumber}`;
    this.elements.previewPageLabel.textContent = `${label} ${pageIndex + 1} / ${this.state.pages.length}`;
    const encryptedSuffix = this.state.encryptedReadOnly ? ' · encrypted (export disabled)' : '';
    this.elements.previewFileMeta.textContent = `${this.state.bundle.fileName} · ${this.state.bundle.pageCount} source page${this.state.bundle.pageCount === 1 ? '' : 's'}${encryptedSuffix}`;
    this.elements.previewEmpty.hidden = true;
    this.elements.previewFrame.classList.remove('is-empty');
    this.renderPreviewStamp();
    this.renderPreviewTextboxes();
  }

  private async renderPreview(): Promise<void> {
    const bundle = this.state.bundle;
    const currentPage = this.getCurrentPage();
    if (!bundle || !currentPage) {
      return;
    }

    // Serialize renders on a chain: concurrent renders share one canvas, so
    // overlapping pdf.js draws can land out of order and leave a stale page
    // visible. Queueing keeps the final pixels matching the latest request.
    const renderToken = ++this.previewToken;
    const run = this.previewRenderChain.then(() =>
      this.runPreviewRender(renderToken, bundle, currentPage),
    );
    this.previewRenderChain = run.catch(() => undefined);
    await run;
  }

  private async runPreviewRender(
    renderToken: number,
    bundle: NonNullable<AppState['bundle']>,
    currentPage: DocumentPageModel,
  ): Promise<void> {
    // Queued renders run in order so the shared canvas never shows stale
    // pixels; only the latest token updates the overlay/visibility below.
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
      this.renderPreviewTextboxes();
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

  private renderPreviewTextboxes(): void {
    const currentPage = this.getCurrentPage();
    if (!currentPage) {
      this.elements.previewTextboxes.hidden = true;
      this.elements.previewTextboxes.innerHTML = '';
      return;
    }

    const boxes = this.state.textBoxes.filter((box) => box.pageId === currentPage.id);
    if (boxes.length === 0) {
      this.elements.previewTextboxes.hidden = true;
      this.elements.previewTextboxes.innerHTML = '';
      return;
    }

    const stageRect = this.getPreviewStageRect();
    const scale = stageRect && currentPage.width > 0 ? stageRect.width / currentPage.width : 1;
    this.elements.previewTextboxes.hidden = false;
    this.updateContainerMarkup(this.elements.previewTextboxes, boxes.map((box) => {
      const selected = box.id === this.state.selectedTextBoxId;
      const fontPx = Math.max(6, box.fontSize * scale);
      const sizes = TEXTBOX_FONT_SIZES.map((size) =>
        `<option value="${size}" ${size === box.fontSize ? 'selected' : ''}>${size}pt</option>`,
      ).join('');
      const safeId = escapeAttribute(box.id);
      return `
        <div class="preview-textbox${selected ? ' is-selected' : ''}" data-textbox-id="${safeId}" style="left:${box.x * 100}%; top:${box.y * 100}%;">
          ${selected
            ? `<input class="textbox-input" data-textbox-id="${safeId}" type="text" value="${escapeAttribute(box.text)}" placeholder="Type text…" style="font-size:${fontPx}px;" />
              <span class="textbox-tools">
                <select class="textbox-size" data-textbox-id="${safeId}" aria-label="Text size">${sizes}</select>
                <button type="button" class="textbox-delete" data-action="delete-textbox" data-textbox-id="${safeId}" aria-label="Delete text box">×</button>
              </span>`
            : `<div class="textbox-readonly" data-textbox-id="${safeId}" style="font-size:${fontPx}px;">${box.text.trim() ? escapeHtml(box.text) : '<span class="textbox-empty">Empty text box</span>'}</div>`}
        </div>
      `;
    }).join(''));
  }

  private renderPreviewStamp(): void {
    const currentPage = this.getCurrentPage();
    const placed = currentPage
      ? this.state.stamps.filter((stamp) => shouldShowStampOnPage(stamp.settings, currentPage.id))
      : [];
    if (!currentPage || placed.length === 0) {
      this.elements.previewStamp.hidden = true;
      this.elements.previewGuides.hidden = true;
      this.elements.previewStamp.innerHTML = '';
      return;
    }

    const stageRect = this.getPreviewStageRect();
    const selectedId = this.state.selectedStampId;
    const selected = placed.find((stamp) => stamp.id === selectedId);
    const verticalGuide = selected
      && Math.abs(selected.settings.placement.x - 0.5) < STAMP_SNAP_THRESHOLD;
    const horizontalGuide = selected
      && Math.abs(selected.settings.placement.y - 0.5) < STAMP_SNAP_THRESHOLD;

    this.elements.previewGuides.hidden = !verticalGuide && !horizontalGuide;
    this.elements.previewGuides.className = `preview-guides${verticalGuide ? ' show-vertical' : ''}${horizontalGuide ? ' show-horizontal' : ''}`;
    this.syncPreviewOverlayFrame();

    this.elements.previewStamp.hidden = false;
    this.updateContainerMarkup(this.elements.previewStamp, placed.map((stamp) => {
      const settings = stamp.settings;
      const isSelected = stamp.id === selectedId;
      const hasImage = this.stampImageUrls.has(stamp.id);
      const showTable = shouldShowStampTable(settings, hasImage);
      const showImage = shouldShowStampImage(settings, hasImage);
      const rows = buildStampRows(settings);
      const placement = settings.placement;
      const baseHeight = stampPreviewBaseHeight(rows, showTable, showImage);
      const widthPoints = stampWidthPoints(placement.width, currentPage);
      const heightPoints = stampHeightPoints(placement.height, widthPoints, baseHeight, currentPage);
      const stampWidthPx = xPointsToPreviewPixels(widthPoints, currentPage, stageRect);
      const stampHeightPx = yPointsToPreviewPixels(heightPoints, currentPage, stageRect);
      const scaleX = Number((stampWidthPx / STAMP_PREVIEW_BASE_WIDTH).toFixed(4));
      const scaleY = Number((stampHeightPx / baseHeight).toFixed(4));
      const fontScale = Number(Math.max(0.01, Math.min(scaleX, scaleY)).toFixed(4));
      const interaction = this.stampInteraction?.stampId === stamp.id ? this.stampInteraction : null;
      const interactionClass = interaction ? ` is-${interaction.kind}` : '';
      const surfaceCursor =
        interaction?.kind === 'resize' && interaction.handle
          ? cursorForHandle(interaction.handle, placement.rotation)
          : interaction
            ? 'grabbing'
            : 'grab';
      const imageUrl = this.stampImageUrlFor(stamp.id);

      return `
      <div
        class="preview-stamp-object ${isSelected ? 'is-selected' : ''}${interactionClass}"
        data-stamp-id="${escapeAttribute(stamp.id)}"
        style="--stamp-scale-x:${scaleX}; --stamp-scale-y:${scaleY}; --stamp-font-scale:${fontScale}; left:${placement.x * 100}%; top:${placement.y * 100}%; width:${stampWidthPx}px; height:${stampHeightPx}px; transform: translate(-50%, -50%) rotate(${placement.rotation}deg);"
      >
        <div class="preview-stamp-body" style="cursor:${surfaceCursor};">
          <div class="preview-stamp-card">
            ${showTable ? renderStampTable(rows, { editable: isSelected, truncatedKeys: this.stampTruncation() }) : ''}
            ${
              showImage && imageUrl
                ? `<img class="stamp-preview-image preview-stamp-image" src="${imageUrl}" alt="Preview stamp image" />`
                : ''
            }
          </div>
        </div>
        ${isSelected ? renderStampHandles(placement.rotation) : ''}
      </div>
      `;
    }).join(''));
  }

  private renderAdvancedSheetVisibility(): void {
    this.elements.advancedSheet.hidden = !this.state.bundle || !this.state.advancedOpen;
  }

  private renderPasswordDialog(): void {
    const dialog = this.state.passwordDialog;
    if (!dialog) {
      this.updateContainerMarkup(this.elements.passwordDialog, '');
      return;
    }

    this.updateContainerMarkup(this.elements.passwordDialog, `
      <div class="password-overlay">
        <div class="password-card" role="dialog" aria-modal="true" aria-label="Document password">
          <p class="eyebrow">Protected PDF</p>
          <h2>Enter the document password</h2>
          <p>${escapeHtml(dialog.fileName)} is password protected. The password stays in this tab and is never uploaded.</p>
          ${dialog.error ? `<p class="password-error">${escapeHtml(dialog.error)}</p>` : ''}
          <label class="inspector-field">
            <span>Password</span>
            <input id="password-input" type="password" autocomplete="off" />
          </label>
          <div class="inspector-actions">
            <button type="button" class="action-button is-primary" data-action="submit-password">Unlock</button>
            <button type="button" class="ghost-button" data-action="cancel-password">Cancel</button>
          </div>
        </div>
      </div>
    `);
    this.elements.passwordDialog.querySelector<HTMLInputElement>('#password-input')?.focus({ preventScroll: true });
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
    Object.assign(this.elements.previewTextboxes.style, style);
    Object.assign(this.elements.previewGuides.style, style);
  }

  private clearPreviewOverlayFrame(): void {
    this.elements.previewStamp.style.left = '';
    this.elements.previewStamp.style.top = '';
    this.elements.previewStamp.style.width = '';
    this.elements.previewStamp.style.height = '';
    this.elements.previewStamp.style.inset = '';
    this.elements.previewTextboxes.style.left = '';
    this.elements.previewTextboxes.style.top = '';
    this.elements.previewTextboxes.style.width = '';
    this.elements.previewTextboxes.style.height = '';
    this.elements.previewTextboxes.style.inset = '';
    this.elements.previewGuides.style.left = '';
    this.elements.previewGuides.style.top = '';
    this.elements.previewGuides.style.width = '';
    this.elements.previewGuides.style.height = '';
    this.elements.previewGuides.style.inset = '';
  }

  private persistPreferences(): void {
    try {
      const stampTextKeys = [
        'mode',
        'payee',
        'totalAmount',
        'gstAmount',
        'movementNumber',
        'signedBy',
        'coSignedBy',
        'approvedBy1',
        'approvedBy2',
        'date',
        'flatten',
      ] as const;
      const data: PersistedPreferences = {
        profile: { ...this.state.profile },
        stamps: this.state.stamps.map(({ settings }) => {
          const draft: Record<string, unknown> = {};
          for (const key of stampTextKeys) {
            draft[key] = settings[key];
          }
          return draft as PersistedPreferences['stamps'][number];
        }),
        overwriteExisting: this.state.overwriteExisting,
        blankInsertMode: this.state.blankInsertMode,
      };
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Private browsing etc: persistence is best-effort only.
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

  private clearSelectedStampImage(): void {
    const selected = this.getSelectedStamp();
    if (!selected) {
      return;
    }

    const existingUrl = this.stampImageUrls.get(selected.id);
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
      this.stampImageUrls.delete(selected.id);
    }

    this.activeStamp = {
      ...selected.settings,
      imageBytes: null,
      imageMime: null,
      imageName: null,
    };
  }

  private setLastExport(blob: Blob, fileName: string): void {
    this.clearLastExport();
    this.state.lastExportBlob = blob;
    this.state.lastExportUrl = URL.createObjectURL(blob);
    this.state.lastExportName = fileName;
  }

  private clearLastExport(): void {
    if (this.state.lastExportUrl) {
      URL.revokeObjectURL(this.state.lastExportUrl);
    }

    this.state.lastExportBlob = null;
    this.state.lastExportUrl = null;
    this.state.lastExportName = null;
  }

  private invalidateLastExport(): void {
    this.state.exportConfirmArmed = false;
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

  private stampBaseHeightFor(settings: StampSettings, stampId: string | null): number {
    const hasImage = stampId ? this.stampImageUrls.has(stampId) : false;
    const showTable = shouldShowStampTable(settings, hasImage);
    const showImage = shouldShowStampImage(settings, hasImage);
    return stampPreviewBaseHeight(buildStampRows(settings), showTable, showImage);
  }

  /** Keys of stamp rows whose text will be cut off by export wrapping. */
  private stampTruncation(): string[] {
    const truncated = new Set<string>();
    for (const stamp of this.state.stamps) {
      const hasImage = this.stampImageUrls.has(stamp.id);
      if (!shouldShowStampTable(stamp.settings, hasImage)) {
        continue;
      }

      for (const row of buildStampRows(stamp.settings)) {
        if (wrapStampText(displayStampRowValue(row), row.maxCharsPerLine, row.maxLines).truncated) {
          truncated.add(row.key);
        }
      }
    }

    return [...truncated];
  }

  private getPreviewStageRect(): DOMRect | null {
    if (this.elements.previewCanvas.hidden) {
      return null;
    }

    return this.elements.previewCanvas.getBoundingClientRect();
  }

  private getInspectorSide(): 'left' | 'right' {
    const currentPage = this.getCurrentPage();
    const selected = this.getSelectedStamp();
    if (!currentPage || !selected || !shouldShowStampOnPage(selected.settings, currentPage.id)) {
      return 'right';
    }

    return selected.settings.placement.x > 0.56 ? 'left' : 'right';
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
          <button id="add-textbox-button" class="ghost-button" type="button" data-action="add-textbox">Add text box</button>
          <button id="delete-page-button" class="ghost-button" type="button" data-action="delete-page">Delete page</button>
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
            <canvas id="preview-canvas" role="img" aria-label="PDF page preview" hidden></canvas>
            <div id="preview-guides" class="preview-guides" hidden>
              <div class="preview-guide is-vertical"></div>
              <div class="preview-guide is-horizontal"></div>
            </div>
            <div id="preview-stamp" class="preview-stamp" hidden></div>
            <div id="preview-textboxes" class="preview-textboxes" hidden></div>
            <div id="preview-hint" class="preview-hint" hidden></div>
          </div>
          <div id="stamp-controls" class="floating-inspector"></div>
          <div id="status" class="status" role="status"></div>
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
            <div id="fill-stats" class="advanced-section-copy"></div>
            <div id="field-list" class="field-list"></div>
          </div>
        </div>
      </section>

      <div id="password-dialog"></div>
      <div id="signature-dialog"></div>
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
      width: DEFAULT_STAMP_WIDTH_POINTS,
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
  // Same sizing caps as renderPreviewPage so switching between PDF and blank
  // pages does not shift the canvas size (and the stamp's relative size).
  const parentWidth = Math.max(320, Math.min(canvas.parentElement?.clientWidth ?? 720, 860));
  const scale = Math.min(1.7, parentWidth / page.width);
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
  page: DocumentPageModel,
  size: {
    widthPoints: number;
    heightPoints: number | undefined;
    baseHeight: number;
    rotation: number;
  },
): StampPlacement {
  const resolvedHeightPoints = stampHeightPoints(
    size.heightPoints,
    size.widthPoints,
    size.baseHeight,
    page,
  );
  const halfWidth = xPointsToPreviewPixels(size.widthPoints, page, rect) / 2;
  const halfHeight = yPointsToPreviewPixels(resolvedHeightPoints, page, rect) / 2;
  const safeX = clampPreviewCenter(clientX - rect.left, halfWidth, rect.width) * rect.width;
  const safeY = clampPreviewCenter(clientY - rect.top, halfHeight, rect.height) * rect.height;
  return {
    pageId,
    x: safeX / rect.width,
    y: safeY / rect.height,
    width: size.widthPoints,
    height: size.heightPoints,
    rotation: size.rotation,
  };
}

function xPointsToPreviewPixels(
  widthPoints: number,
  page: DocumentPageModel,
  rect: Pick<DOMRect, 'width'> | null,
): number {
  const previewWidth = rect?.width && rect.width > 0 ? rect.width : page.width;
  return Math.max(1, (widthPoints / page.width) * previewWidth);
}

function yPointsToPreviewPixels(
  heightPoints: number,
  page: DocumentPageModel,
  rect: Pick<DOMRect, 'height'> | null,
): number {
  const previewHeight = rect?.height && rect.height > 0 ? rect.height : page.height;
  return Math.max(1, (heightPoints / page.height) * previewHeight);
}

function previewPixelsToXPoints(widthPx: number, page: DocumentPageModel, rect: Pick<DOMRect, 'width'>): number {
  return Math.max(STAMP_MIN_WIDTH_POINTS, (widthPx / rect.width) * page.width);
}

function previewPixelsToYPoints(heightPx: number, page: DocumentPageModel, rect: Pick<DOMRect, 'height'>): number {
  return Math.max(STAMP_MIN_WIDTH_POINTS, (heightPx / rect.height) * page.height);
}

function stampWidthPoints(width: number, page: DocumentPageModel): number {
  if (width > 0 && width <= 2) {
    return Math.max(STAMP_MIN_WIDTH_POINTS, width * page.width);
  }

  return Math.max(STAMP_MIN_WIDTH_POINTS, width);
}

function stampHeightPoints(
  height: number | undefined,
  widthPoints: number,
  baseHeight: number,
  page: DocumentPageModel,
): number {
  if (height === undefined) {
    return Math.max(STAMP_MIN_WIDTH_POINTS, (widthPoints / STAMP_PREVIEW_BASE_WIDTH) * baseHeight);
  }

  if (height > 0 && height <= 2) {
    return Math.max(STAMP_MIN_WIDTH_POINTS, height * page.height);
  }

  return Math.max(STAMP_MIN_WIDTH_POINTS, height);
}

function clampPreviewCenter(centerPx: number, halfSizePx: number, totalPx: number): number {
  if (totalPx <= 0) {
    return 0.5;
  }

  if (halfSizePx * 2 >= totalPx) {
    return clampValue(centerPx / totalPx, 0, 1);
  }

  return clampValue(centerPx / totalPx, halfSizePx / totalPx, 1 - halfSizePx / totalPx);
}

function stampPreviewBaseHeight(
  rows: ReturnType<typeof buildStampRows>,
  showTable: boolean,
  showImage: boolean,
): number {
  const tableHeight = showTable ? rows.reduce((sum, row) => sum + row.minHeight, 0) : 0;
  const gap = tableHeight > 0 && showImage ? STAMP_PREVIEW_GAP : 0;
  return Math.max(1, tableHeight + gap + (showImage ? STAMP_PREVIEW_IMAGE_HEIGHT : 0));
}

function resizePreviewSizeFromHandle(
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
    minWidth: number;
    minHeight: number;
  },
): { width: number; height: number } {
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
    return {
      width: Math.max(input.minWidth, input.startWidth * resizeRatio(currentDx, startDx)),
      height: input.startHeight,
    };
  }

  if (handle === 'n' || handle === 's') {
    return {
      width: input.startWidth,
      height: Math.max(input.minHeight, input.startHeight * resizeRatio(currentDy, startDy)),
    };
  }

  return {
    width: Math.max(input.minWidth, input.startWidth * resizeRatio(currentDx, startDx)),
    height: Math.max(input.minHeight, input.startHeight * resizeRatio(currentDy, startDy)),
  };
}

function resizeRatio(currentDistance: number, startDistance: number): number {
  return Math.max(STAMP_MIN_RESIZE_RATIO, Math.abs(currentDistance) / Math.max(1, Math.abs(startDistance)));
}

function renderStampTable(
  rows: ReturnType<typeof buildStampRows>,
  options: { editable: boolean; truncatedKeys?: readonly string[] },
): string {
  const truncated = new Set(options.truncatedKeys ?? []);
  return `
    <div class="stamp-table-preview ${options.editable ? 'is-editor' : ''}">
      ${rows
        .map((row) =>
          options.editable
            ? renderEditableStampRow(row, truncated.has(row.key))
            : renderReadonlyStampRow(row, truncated.has(row.key)),
        )
        .join('')}
    </div>
  `;
}

function renderEditableStampRow(
  row: ReturnType<typeof buildStampRows>[number],
  truncated: boolean,
): string {
  const labelHtml = row.labelLines.map((line) => escapeHtml(line)).join('<br />');
  const inputClass = row.emphasis ? 'stamp-table-input is-emphasis' : 'stamp-table-input';
  const inputType = row.inputType ?? 'text';
  return `
    <label class="stamp-table-row is-editable${truncated ? ' is-truncated' : ''}" style="--stamp-row-height:${row.minHeight};"${truncated ? ' title="This text will be cut off on export. Shorten it or enlarge the stamp."' : ''}>
      <span class="stamp-table-label">${labelHtml}</span>
      <span class="stamp-table-input-wrap">
        <input
          class="${inputClass}"
          data-stamp-key="${row.key}"
          type="${inputType}"
          value="${escapeAttribute(row.value)}"
          placeholder="${escapeAttribute(row.placeholder)}"
        />
      </span>
    </label>
  `;
}

function renderReadonlyStampRow(
  row: ReturnType<typeof buildStampRows>[number],
  truncated: boolean,
): string {
  const labelHtml = row.labelLines.map((line) => escapeHtml(line)).join('<br />');
  const valueClass = row.emphasis ? 'stamp-table-value is-emphasis' : 'stamp-table-value';
  const displayValue = displayStampRowValue(row);
  return `
    <div class="stamp-table-row${truncated ? ' is-truncated' : ''}" style="--stamp-row-height:${row.minHeight};"${truncated ? ' title="This text will be cut off on export. Shorten it or enlarge the stamp."' : ''}>
      <div class="stamp-table-label">${labelHtml}</div>
      <div class="${valueClass}">${escapeHtml(displayValue)}</div>
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
        <input data-field-id="${escapeAttribute(field.id)}" type="checkbox" ${field.value === true ? 'checked' : ''} />
        Tick this box
      </label>
    `;
  }

  if (field.kind === 'dropdown' || field.kind === 'radio' || field.kind === 'option-list') {
    return `
      <select data-field-id="${escapeAttribute(field.id)}">
        <option value="">Leave blank</option>
        ${field.options.map((option) => {
          const selected = field.value === option ? 'selected' : '';
          return `<option value="${escapeAttribute(option)}" ${selected}>${escapeHtml(option)}</option>`;
        }).join('')}
      </select>
    `;
  }

  return `<input data-field-id="${escapeAttribute(field.id)}" type="text" value="${escapeAttribute(typeof field.value === 'string' ? field.value : '')}" />`;
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

type SavePickerHandle = {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
};

type SavePicker = (options: {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<SavePickerHandle>;

function getSaveFilePicker(): SavePicker | undefined {
  return (window as typeof window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
}

function triggerBrowserDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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

function loadPreferences(): PersistedPreferences | null {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedPreferences>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const profile: ProfileValues = {};
    if (typeof parsed.profile === 'object' && parsed.profile !== null) {
      for (const [key, value] of Object.entries(parsed.profile)) {
        if (typeof value === 'string' && value) {
          (profile as Record<string, string>)[key] = value;
        }
      }
    }

    // Current shape is `stamps: [...]`; accept the legacy single `stamp`
    // object from earlier versions too.
    const legacyStamp =
      typeof (parsed as { stamp?: unknown }).stamp === 'object' &&
      (parsed as { stamp?: unknown }).stamp !== null
        ? [(parsed as { stamp?: unknown }).stamp as Record<string, unknown>]
        : [];
    const stampSources = Array.isArray(parsed.stamps) && parsed.stamps.length > 0
      ? (parsed.stamps as Record<string, unknown>[]).slice(0, 10)
      : legacyStamp;
    const stampTextKeys = [
      'payee',
      'totalAmount',
      'gstAmount',
      'movementNumber',
      'signedBy',
      'coSignedBy',
      'approvedBy1',
      'approvedBy2',
      'date',
    ] as const;
    const stamps = stampSources.map((source) => {
      const draft = {} as PersistedPreferences['stamps'][number];
      for (const key of stampTextKeys) {
        if (typeof source[key] === 'string') {
          draft[key] = source[key] as string;
        }
      }
      if (source.mode === 'text' || source.mode === 'image' || source.mode === 'both') {
        draft.mode = source.mode;
      }
      if (typeof source.flatten === 'boolean') {
        draft.flatten = source.flatten;
      }
      return draft;
    });

    return {
      profile,
      stamps,
      overwriteExisting: parsed.overwriteExisting === true,
      blankInsertMode: parsed.blankInsertMode === 'at-end' ? 'at-end' : 'after-current',
    };
  } catch {
    return null;
  }
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

  const textBoxId = element.dataset.textboxId;
  if (textBoxId) {
    return `[data-textbox-id="${escapeSelector(textBoxId)}"] input`;
  }

  const stampSetting = element.dataset.stampSetting;
  if (stampSetting) {
    return `[data-stamp-setting="${escapeSelector(stampSetting)}"]`;
  }

  const uiSetting = element.dataset.uiSetting;
  if (uiSetting) {
    return `[data-ui-setting="${escapeSelector(uiSetting)}"]`;
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
  | 'approvedBy2'
  | 'date' {
  return [
    'payee',
    'totalAmount',
    'gstAmount',
    'movementNumber',
    'signedBy',
    'coSignedBy',
    'approvedBy1',
    'approvedBy2',
    'date',
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
