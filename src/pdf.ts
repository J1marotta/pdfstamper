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
  degrees,
  rgb,
} from 'pdf-lib';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { humanizeFieldName, inferSemanticKey } from './heuristics';
import { buildStampRows, isStampPlaced, shouldShowStampImage, shouldShowStampTable } from './stamp';
import type { DocumentPageModel, PageSize, PdfFieldModel, StampSettings } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

type PreviewDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

export interface LoadedPdfBundle {
  fileName: string;
  sourceBytes: Uint8Array;
  previewDocument: PreviewDocument;
  pageCount: number;
  pageSizes: PageSize[];
  textDigest: string;
  fields: PdfFieldModel[];
}

const STAMP_RED = rgb(0.66, 0.13, 0.1);
const INK = rgb(0.16, 0.14, 0.15);

export async function loadPdfBundle(file: File): Promise<LoadedPdfBundle> {
  const rawBuffer = await file.arrayBuffer();
  const { sourceBytes, editableBytes, previewBytes } = clonePdfBytesForWorkflows(rawBuffer);
  const [editableDocument, previewDocument] = await Promise.all([
    PDFDocument.load(editableBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    }),
    getDocument({ data: previewBytes }).promise,
  ]);

  const fields = extractFields(editableDocument);
  const pageCount = previewDocument.numPages;
  const pageSizes = editableDocument.getPages().map((page) => ({
    width: page.getWidth(),
    height: page.getHeight(),
  }));
  const textDigest = await extractTextDigest(previewDocument, Math.min(pageCount, 6));

  return {
    fileName: file.name,
    sourceBytes,
    previewDocument,
    pageCount,
    pageSizes,
    textDigest,
    fields,
  };
}

export function clonePdfBytesForWorkflows(rawBuffer: ArrayBuffer): {
  sourceBytes: Uint8Array;
  editableBytes: Uint8Array;
  previewBytes: Uint8Array;
} {
  const rawBytes = new Uint8Array(rawBuffer);
  return {
    sourceBytes: new Uint8Array(rawBytes),
    editableBytes: new Uint8Array(rawBytes),
    previewBytes: new Uint8Array(rawBytes),
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
  pages: DocumentPageModel[],
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
  const pageMap = new Map<string, PDFPage>();
  const keptSourcePageNumbers = new Set(
    pages
      .filter((page): page is Extract<DocumentPageModel, { kind: 'pdf' }> => page.kind === 'pdf')
      .map((page) => page.pageNumber),
  );

  for (let pageIndex = document.getPageCount() - 1; pageIndex >= 0; pageIndex -= 1) {
    if (!keptSourcePageNumbers.has(pageIndex + 1)) {
      document.removePage(pageIndex);
    }
  }

  pages.forEach((pageModel, targetIndex) => {
    if (pageModel.kind === 'blank') {
      const blankPage = document.insertPage(targetIndex, [pageModel.width, pageModel.height]);
      pageMap.set(pageModel.id, blankPage);
      return;
    }

    const keptPage = document.getPage(targetIndex);
    if (keptPage) {
      pageMap.set(pageModel.id, keptPage);
    }
  });

  if (isStampPlaced(stamp)) {
    const targetPage = pageMap.get(stamp.placement.pageId!);
    if (targetPage) {
      drawStamp(targetPage, stamp, boldFont, regularFont, embeddedImage);
    }
  }

  const bytes = await document.save();
  const pdfBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(pdfBuffer).set(bytes);
  return new Blob([pdfBuffer], { type: 'application/pdf' });
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
  if (!isStampPlaced(stamp)) {
    return;
  }

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 18;
  const maxWidth = Math.max(220, Math.min(pageWidth - margin * 2, pageWidth * stamp.placement.width));
  const scale = maxWidth / 460;
  const showTable = shouldShowStampTable(stamp, Boolean(embeddedImage));
  const rows = showTable ? buildPdfStampRows(stamp) : [];
  const tableHeight = rows.reduce((sum, row) => sum + row.height * scale, 0);

  let imageWidth = 0;
  let imageHeight = 0;

  if (embeddedImage && shouldShowStampImage(stamp, true)) {
    const ratio = Math.min(
      1,
      Math.min(maxWidth / embeddedImage.width, (160 * scale) / embeddedImage.height),
    );
    imageWidth = embeddedImage.width * ratio;
    imageHeight = embeddedImage.height * ratio;
  }

  const gap = tableHeight > 0 && imageHeight > 0 ? 10 * scale : 0;
  const blockWidth = Math.max(tableHeight > 0 ? maxWidth : 0, imageWidth);
  const blockHeight = tableHeight + gap + imageHeight;
  const centerX = clampValue(pageWidth * stamp.placement.x, blockWidth / 2 + margin, pageWidth - blockWidth / 2 - margin);
  const centerY = clampValue(
    pageHeight * (1 - stamp.placement.y),
    blockHeight / 2 + margin,
    pageHeight - blockHeight / 2 - margin,
  );
  const x = centerX - blockWidth / 2;
  const y = centerY - blockHeight / 2;
  const rotation = stamp.placement.rotation;

  if (tableHeight > 0) {
    drawStampTable(page, x, y, maxWidth, rows, boldFont, regularFont, scale, centerX, centerY, rotation);
  }

  if (embeddedImage && imageWidth > 0 && imageHeight > 0) {
    const imageOrigin = rotatePoint(
      x + (blockWidth - imageWidth) / 2,
      y + tableHeight + gap,
      centerX,
      centerY,
      rotation,
    );
    page.drawImage(embeddedImage, {
      x: imageOrigin.x,
      y: imageOrigin.y,
      width: imageWidth,
      height: imageHeight,
      opacity: 0.96,
      rotate: degrees(rotation),
    });
  }

  if (blockHeight === 0) {
    const fallbackRows = buildPdfStampRows(stamp);
    drawStampTable(page, x, y, maxWidth, fallbackRows, boldFont, regularFont, scale, centerX, centerY, rotation);
  }
}

function buildPdfStampRows(stamp: StampSettings): Array<{
  labelLines: string[];
  valueLines: string[];
  height: number;
  emphasis?: boolean;
}> {
  return buildStampRows(stamp).map((row) =>
    makePdfStampRow(
      row.labelLines,
      wrapText(row.value, row.maxCharsPerLine, row.maxLines),
      row.minHeight,
      row.emphasis,
    ),
  );
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
  scale: number,
  centerX: number,
  centerY: number,
  rotation: number,
): void {
  const totalHeight = rows.reduce((sum, row) => sum + row.height * scale, 0);
  const labelWidth = Math.min(145, width * 0.34);
  const outerOrigin = rotatePoint(x, y, centerX, centerY, rotation);

  page.drawRectangle({
    x: outerOrigin.x,
    y: outerOrigin.y,
    width,
    height: totalHeight,
    color: rgb(1, 1, 1),
    opacity: 0.97,
    borderColor: STAMP_RED,
    borderWidth: 1.15,
    rotate: degrees(rotation),
  });

  const dividerStart = rotatePoint(x + labelWidth, y, centerX, centerY, rotation);
  const dividerEnd = rotatePoint(x + labelWidth, y + totalHeight, centerX, centerY, rotation);
  page.drawLine({
    start: dividerStart,
    end: dividerEnd,
    color: STAMP_RED,
    thickness: 1,
  });

  let cursorTop = y + totalHeight;

  rows.forEach((row, index) => {
    const scaledRowHeight = row.height * scale;
    const rowBottom = cursorTop - scaledRowHeight;

    if (index < rows.length - 1) {
      const rowStart = rotatePoint(x, rowBottom, centerX, centerY, rotation);
      const rowEnd = rotatePoint(x + width, rowBottom, centerX, centerY, rotation);
      page.drawLine({
        start: rowStart,
        end: rowEnd,
        color: STAMP_RED,
        thickness: 1,
      });
    }

    const labelSize = 8.6 * scale;
    const valueSize = (row.emphasis ? 12.8 : 11.4) * scale;
    const labelStartY = rowBottom + scaledRowHeight - 12 * scale;
    row.labelLines.forEach((line, lineIndex) => {
      const labelOrigin = rotatePoint(
        x + 8 * scale,
        labelStartY - lineIndex * 10 * scale,
        centerX,
        centerY,
        rotation,
      );
      page.drawText(line, {
        x: labelOrigin.x,
        y: labelOrigin.y,
        size: labelSize,
        font: boldFont,
        color: STAMP_RED,
        rotate: degrees(rotation),
      });
    });

    const valueFont = row.emphasis ? boldFont : regularFont;
    const valueStartY = rowBottom + scaledRowHeight - (row.emphasis ? 15 : 13) * scale;
    row.valueLines.forEach((line, lineIndex) => {
      const valueOrigin = rotatePoint(
        x + labelWidth + 10 * scale,
        valueStartY - lineIndex * (valueSize + scale),
        centerX,
        centerY,
        rotation,
      );
      page.drawText(line, {
        x: valueOrigin.x,
        y: valueOrigin.y,
        size: valueSize,
        font: valueFont,
        color: INK,
        rotate: degrees(rotation),
      });
    });

    cursorTop = rowBottom;
  });
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

function rotatePoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  rotation: number,
): { x: number; y: number } {
  if (rotation === 0) {
    return { x, y };
  }

  const radians = (rotation * Math.PI) / 180;
  const translatedX = x - centerX;
  const translatedY = y - centerY;
  return {
    x: centerX + translatedX * Math.cos(radians) - translatedY * Math.sin(radians),
    y: centerY + translatedX * Math.sin(radians) + translatedY * Math.cos(radians),
  };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
