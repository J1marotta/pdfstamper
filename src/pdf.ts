import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFForm,
  PDFImage,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
  PDFFont,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { humanizeFieldName, inferSemanticKey } from './heuristics';
import type { PdfFieldModel, StampSettings } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

type PreviewDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

interface FilePickerSaveTarget {
  kind: 'picker';
  handle: FileSystemFileHandleLike;
}

interface DownloadSaveTarget {
  kind: 'download';
}

type PdfSaveTarget = DownloadSaveTarget | FilePickerSaveTarget;

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface LoadedPdfBundle {
  fileName: string;
  sourceBytes: Uint8Array;
  previewDocument: PreviewDocument;
  pageCount: number;
  textDigest: string;
  fields: PdfFieldModel[];
}

const STAMP_RED = rgb(0.66, 0.13, 0.1);
const INK = rgb(0.16, 0.14, 0.15);

export async function loadPdfBundle(file: File): Promise<LoadedPdfBundle> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const [editableDocument, previewDocument] = await Promise.all([
    PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    }),
    getDocument({ data: sourceBytes }).promise,
  ]);

  const fields = extractFields(editableDocument);
  const pageCount = previewDocument.numPages;
  const textDigest = await extractTextDigest(previewDocument, Math.min(pageCount, 6));

  return {
    fileName: file.name,
    sourceBytes,
    previewDocument,
    pageCount,
    textDigest,
    fields,
  };
}

export async function renderPreviewPage(
  previewDocument: PreviewDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const page = await previewDocument.getPage(pageNumber);
  const parentWidth = Math.max(320, Math.min(canvas.parentElement?.clientWidth ?? 720, 860));
  const initialViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1.7, parentWidth / initialViewport.width);
  const viewport = page.getViewport({ scale });
  const pixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.');
  }

  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  context.clearRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: context,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    viewport,
  }).promise;
}

export async function exportFilledPdf(
  sourceBytes: Uint8Array,
  fields: PdfFieldModel[],
  stamp: StampSettings,
): Promise<Blob> {
  const document = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const form = document.getForm();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);

  applyFieldValues(form, fields);

  try {
    form.updateFieldAppearances(regularFont);
  } catch {
    // Some documents ship with odd appearance streams. Export should continue.
  }

  if (stamp.flatten) {
    try {
      form.flatten();
    } catch {
      // Flattening is optional; continue if the document does not support it.
    }
  }

  const embeddedImage = await embedStampImage(document, stamp);
  const pages = document.getPages();
  const targetPages = stamp.placement === 'every-page' ? pages : pages.slice(-1);

  targetPages.forEach((page) => {
    drawStamp(page, stamp, boldFont, regularFont, embeddedImage);
  });

  const bytes = await document.save();
  const pdfBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(pdfBuffer).set(bytes);
  return new Blob([pdfBuffer], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  window.requestAnimationFrame(() => {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
}

export async function preparePdfSaveTarget(fileName: string): Promise<PdfSaveTarget> {
  const showSaveFilePicker = (window as Window & {
    showSaveFilePicker?: (
      options: SaveFilePickerOptionsLike,
    ) => Promise<FileSystemFileHandleLike>;
  }).showSaveFilePicker;

  if (typeof showSaveFilePicker !== 'function') {
    return { kind: 'download' };
  }

  try {
    const handle = await showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: 'PDF document',
          accept: {
            'application/pdf': ['.pdf'],
          },
        },
      ],
    });

    return {
      kind: 'picker',
      handle,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new SaveCancelledError();
    }

    console.warn('Falling back to browser download for PDF export.', error);
    return { kind: 'download' };
  }
}

export async function savePdfOutput(
  blob: Blob,
  fileName: string,
  target: PdfSaveTarget,
): Promise<PdfSaveTarget['kind']> {
  if (target.kind === 'picker') {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'picker';
  }

  downloadBlob(blob, fileName);
  return 'download';
}

function extractFields(document: PDFDocument): PdfFieldModel[] {
  const form = document.getForm();

  return form.getFields().map((field, index) => {
    const name = field.getName();
    const label = humanizeFieldName(name);
    const semanticKey = inferSemanticKey(name);
    let kind: PdfFieldModel['kind'] = 'unknown';
    let value: string | boolean = '';
    let options: string[] = [];
    let readOnly = false;

    try {
      if (field instanceof PDFTextField) {
        kind = 'text';
        value = field.getText() ?? '';
      } else if (field instanceof PDFCheckBox) {
        kind = 'checkbox';
        value = field.isChecked();
      } else if (field instanceof PDFDropdown) {
        kind = 'dropdown';
        options = field.getOptions();
        value = firstSelected(field.getSelected());
      } else if (field instanceof PDFOptionList) {
        kind = 'option-list';
        options = field.getOptions();
        value = firstSelected(field.getSelected());
      } else if (field instanceof PDFRadioGroup) {
        kind = 'radio';
        options = field.getOptions();
        value = field.getSelected() ?? '';
      } else {
        const constructorName = field.constructor?.name ?? 'UnknownField';
        kind = constructorName === 'PDFButton' ? 'button' : constructorName === 'PDFSignature' ? 'signature' : 'unknown';
        readOnly = true;
      }
    } catch {
      readOnly = true;
    }

    return {
      id: `${index}-${name}`,
      name,
      label,
      kind,
      semanticKey,
      value,
      originalValue: value,
      dirty: false,
      autoFilled: false,
      options,
      readOnly,
    };
  });
}

function firstSelected(value: string | string[] | undefined): string {
  if (!value) {
    return '';
  }

  return Array.isArray(value) ? value[0] ?? '' : value;
}

async function extractTextDigest(
  previewDocument: PreviewDocument,
  pagesToScan: number,
): Promise<string> {
  const chunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber += 1) {
    const page = await previewDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    chunks.push(pageText);
  }

  return chunks.join(' ').slice(0, 6000);
}

function applyFieldValues(
  form: PDFForm,
  fields: PdfFieldModel[],
): void {
  const fieldMap = new Map(form.getFields().map((field) => [field.getName(), field]));

  fields.forEach((model) => {
    const target = fieldMap.get(model.name);
    if (!target || model.readOnly) {
      return;
    }

    try {
      if (target instanceof PDFTextField) {
        target.setText(typeof model.value === 'string' ? model.value : '');
      } else if (target instanceof PDFCheckBox) {
        if (model.value === true) {
          target.check();
        } else {
          target.uncheck();
        }
      } else if (target instanceof PDFDropdown) {
        const nextValue = typeof model.value === 'string' ? model.value : '';
        if (nextValue) {
          target.select(nextValue);
        } else {
          clearIfSupported(target);
        }
      } else if (target instanceof PDFOptionList) {
        const nextValue = typeof model.value === 'string' ? model.value : '';
        if (nextValue) {
          target.select(nextValue);
        } else {
          clearIfSupported(target);
        }
      } else if (target instanceof PDFRadioGroup) {
        const nextValue = typeof model.value === 'string' ? model.value : '';
        if (nextValue) {
          target.select(nextValue);
        } else {
          clearIfSupported(target);
        }
      }
    } catch {
      // Some PDFs have invalid field definitions; skip the field instead of failing export.
    }
  });
}

function clearIfSupported(target: unknown): void {
  if (typeof target === 'object' && target && 'clear' in target && typeof target.clear === 'function') {
    target.clear();
  }
}

async function embedStampImage(document: PDFDocument, stamp: StampSettings) {
  if (!stamp.imageBytes || !stamp.imageMime) {
    return null;
  }

  if (stamp.imageMime.includes('png')) {
    return document.embedPng(stamp.imageBytes);
  }

  return document.embedJpg(stamp.imageBytes);
}

function drawStamp(
  page: PDFPage,
  stamp: StampSettings,
  boldFont: PDFFont,
  regularFont: PDFFont,
  embeddedImage: PDFImage | null,
): void {
  const pageWidth = page.getWidth();
  const margin = 20;
  const maxWidth = Math.min(460, pageWidth - margin * 2);
  const showTable = stamp.mode !== 'image' || !embeddedImage;
  const rows = showTable ? buildPdfStampRows(stamp) : [];
  const tableHeight = rows.reduce((sum, row) => sum + row.height, 0);

  let imageWidth = 0;
  let imageHeight = 0;

  if (embeddedImage && (stamp.mode === 'image' || stamp.mode === 'both')) {
    const ratio = Math.min(
      1,
      Math.min(maxWidth / embeddedImage.width, 120 / embeddedImage.height),
    );
    imageWidth = embeddedImage.width * ratio;
    imageHeight = embeddedImage.height * ratio;
  }

  const gap = tableHeight > 0 && imageHeight > 0 ? 10 : 0;
  const blockWidth = Math.max(tableHeight > 0 ? maxWidth : 0, imageWidth);
  const blockHeight = tableHeight + gap + imageHeight;
  const x = alignedX(pageWidth, blockWidth, stamp.alignment, margin);
  const y = margin;

  if (tableHeight > 0) {
    drawStampTable(page, x, y, maxWidth, rows, boldFont, regularFont);
  }

  if (embeddedImage && imageWidth > 0 && imageHeight > 0) {
    page.drawImage(embeddedImage, {
      x: x + (blockWidth - imageWidth) / 2,
      y: y + tableHeight + gap,
      width: imageWidth,
      height: imageHeight,
      opacity: 0.96,
    });
  }

  if (blockHeight === 0) {
    const fallbackRows = buildPdfStampRows(stamp);
    drawStampTable(page, x, y, maxWidth, fallbackRows, boldFont, regularFont);
  }
}

function buildPdfStampRows(stamp: StampSettings): Array<{
  labelLines: string[];
  valueLines: string[];
  height: number;
  emphasis?: boolean;
}> {
  return [
    makePdfStampRow(['PAYEE'], wrapText(stamp.payee, 30, 2), 30),
    makePdfStampRow(['TOTAL AMOUNT', 'PAYABLE'], wrapText(stamp.totalAmount, 22, 1), 38, true),
    makePdfStampRow(['GST Amount'], wrapText(stamp.gstAmount, 24, 1), 28),
    makePdfStampRow(['Movement No'], wrapText(stamp.movementNumber, 26, 1), 28),
    makePdfStampRow(['Signed by :'], wrapText(stamp.signedBy, 30, 2), 32),
    makePdfStampRow(['Co-signed by -', 'Claims Manager'], wrapText(stamp.coSignedBy, 30, 2), 40),
    makePdfStampRow(['Approved by 1'], wrapText(stamp.approvedBy1, 30, 2), 30),
    makePdfStampRow(['Approved by 2'], wrapText(stamp.approvedBy2, 30, 2), 30),
  ];
}

function makePdfStampRow(
  labelLines: string[],
  valueLines: string[],
  minHeight: number,
  emphasis = false,
): {
  labelLines: string[];
  valueLines: string[];
  height: number;
  emphasis?: boolean;
} {
  const safeValueLines = valueLines.length > 0 ? valueLines : [''];
  const contentHeight = Math.max(labelLines.length * 10 + 12, safeValueLines.length * 12 + 12);
  return {
    labelLines,
    valueLines: safeValueLines,
    height: Math.max(minHeight, contentHeight),
    emphasis,
  };
}

function drawStampTable(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  rows: Array<{ labelLines: string[]; valueLines: string[]; height: number; emphasis?: boolean }>,
  boldFont: PDFFont,
  regularFont: PDFFont,
): void {
  const totalHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const labelWidth = Math.min(145, width * 0.34);

  page.drawRectangle({
    x,
    y,
    width,
    height: totalHeight,
    color: rgb(1, 1, 1),
    opacity: 0.97,
    borderColor: STAMP_RED,
    borderWidth: 1.15,
  });

  page.drawLine({
    start: { x: x + labelWidth, y },
    end: { x: x + labelWidth, y: y + totalHeight },
    color: STAMP_RED,
    thickness: 1,
  });

  let cursorTop = y + totalHeight;

  rows.forEach((row, index) => {
    const rowBottom = cursorTop - row.height;

    if (index < rows.length - 1) {
      page.drawLine({
        start: { x, y: rowBottom },
        end: { x: x + width, y: rowBottom },
        color: STAMP_RED,
        thickness: 1,
      });
    }

    const labelStartY = rowBottom + row.height - 12;
    row.labelLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: x + 8,
        y: labelStartY - lineIndex * 10,
        size: 8.6,
        font: boldFont,
        color: STAMP_RED,
      });
    });

    const valueFont = row.emphasis ? boldFont : regularFont;
    const valueSize = row.emphasis ? 12.8 : 11.4;
    const valueStartY = rowBottom + row.height - (row.emphasis ? 15 : 13);
    row.valueLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: x + labelWidth + 10,
        y: valueStartY - lineIndex * (valueSize + 1),
        size: valueSize,
        font: valueFont,
        color: INK,
      });
    });

    cursorTop = rowBottom;
  });
}

function alignedX(
  pageWidth: number,
  blockWidth: number,
  alignment: StampSettings['alignment'],
  margin: number,
): number {
  if (alignment === 'left') {
    return margin;
  }

  if (alignment === 'center') {
    return (pageWidth - blockWidth) / 2;
  }

  return pageWidth - blockWidth - margin;
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  if (!text.trim()) {
    return [];
  }

  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      return;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  });

  if (current) {
    lines.push(current);
  }

  const truncated = lines.length > maxLines;
  return lines.slice(0, maxLines).map((line, index) => {
    const overflowedLine = line.length > maxCharsPerLine;
    if (overflowedLine || (index === maxLines - 1 && truncated)) {
      return `${line.slice(0, Math.max(0, maxCharsPerLine - 3)).trimEnd()}...`;
    }
    return line;
  });
}

interface SaveFilePickerOptionsLike {
  suggestedName?: string;
  types?: Array<{
    accept: Record<string, string[]>;
    description?: string;
  }>;
}

class SaveCancelledError extends Error {
  constructor() {
    super('The user canceled the save dialog.');
    this.name = 'SaveCancelledError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
