import type { ProfileValues, StampSettings } from './types';

export type EditableStampKey =
  | 'payee'
  | 'totalAmount'
  | 'gstAmount'
  | 'movementNumber'
  | 'signedBy'
  | 'coSignedBy'
  | 'approvedBy1'
  | 'approvedBy2'
  | 'date';

export interface StampRowModel {
  key: EditableStampKey;
  label: string;
  labelLines: string[];
  placeholder: string;
  value: string;
  emphasis?: boolean;
  inputType?: 'text' | 'date';
  maxCharsPerLine: number;
  maxLines: number;
  minHeight: number;
}

const STAMP_ROW_DEFINITIONS: Array<
  Omit<StampRowModel, 'value' | 'labelLines'> & { labelLines?: string[] }
> = [
  {
    key: 'payee',
    label: 'PAYEE',
    placeholder: 'Recipient or payee',
    maxCharsPerLine: 30,
    maxLines: 2,
    minHeight: 30,
  },
  {
    key: 'totalAmount',
    label: 'TOTAL AMOUNT\nPAYABLE',
    placeholder: '$7,516.30',
    emphasis: true,
    maxCharsPerLine: 22,
    maxLines: 1,
    minHeight: 38,
  },
  {
    key: 'gstAmount',
    label: 'GST Amount',
    placeholder: '$683.30',
    maxCharsPerLine: 24,
    maxLines: 1,
    minHeight: 28,
  },
  {
    key: 'movementNumber',
    label: 'Movement No',
    placeholder: '202603/01',
    maxCharsPerLine: 26,
    maxLines: 1,
    minHeight: 28,
  },
  {
    key: 'signedBy',
    label: 'Signed by :',
    placeholder: 'Primary approver',
    maxCharsPerLine: 30,
    maxLines: 2,
    minHeight: 32,
  },
  {
    key: 'coSignedBy',
    label: 'Co-signed by -\nClaims Manager',
    placeholder: 'Secondary approver',
    maxCharsPerLine: 30,
    maxLines: 2,
    minHeight: 40,
  },
  {
    key: 'approvedBy1',
    label: 'Approved by 1',
    placeholder: 'Approver name',
    maxCharsPerLine: 30,
    maxLines: 2,
    minHeight: 30,
  },
  {
    key: 'approvedBy2',
    label: 'Approved by 2',
    placeholder: 'Approver name',
    maxCharsPerLine: 30,
    maxLines: 2,
    minHeight: 30,
  },
  {
    key: 'date',
    label: 'Date',
    placeholder: 'YYYY-MM-DD',
    inputType: 'date',
    maxCharsPerLine: 26,
    maxLines: 1,
    minHeight: 28,
  },
];

export function buildStampRows(stamp: StampSettings): StampRowModel[] {
  return STAMP_ROW_DEFINITIONS.map((definition) => ({
    ...definition,
    labelLines: definition.label.split('\n'),
    value: stamp[definition.key],
  }));
}

export function shouldShowStampTable(stamp: StampSettings, hasImage: boolean): boolean {
  return stamp.mode !== 'image' || !hasImage;
}

export function shouldShowStampImage(stamp: StampSettings, hasImage: boolean): boolean {
  return hasImage && (stamp.mode === 'image' || stamp.mode === 'both');
}

export function isStampPlaced(stamp: StampSettings): boolean {
  return Boolean(stamp.placement.pageId);
}

export function shouldShowStampOnPage(stamp: StampSettings, pageId: string): boolean {
  return stamp.placement.pageId === pageId;
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Display value for a stamp row (the date row shows `20 May 2026`, not ISO). */
export function displayStampRowValue(row: Pick<StampRowModel, 'key' | 'value'>): string {
  return row.key === 'date' ? formatStampDate(row.value) : row.value;
}

/** Wrap stamp text exactly as the PDF export does, also reporting data loss. */
export function wrapStampText(
  text: string,
  maxCharsPerLine: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  if (!text.trim()) {
    return { lines: [], truncated: false };
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

  const truncated =
    lines.length > maxLines || lines.some((line) => line.length > maxCharsPerLine);
  return {
    lines: lines.slice(0, maxLines).map((line, index) => {
      const overflowedLine = line.length > maxCharsPerLine;
      if (overflowedLine || (index === maxLines - 1 && lines.length > maxLines)) {
        return `${line.slice(0, Math.max(0, maxCharsPerLine - 3)).trimEnd()}...`;
      }
      return line;
    }),
    truncated,
  };
}
export function formatStampDate(raw: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    return raw;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return raw;
  }

  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`;
}

export function syncStampFromProfile(
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
  const previousDate = previousProfile.date || '';
  const nextDate = nextProfile.date || '';

  return {
    ...stamp,
    payee: shouldSyncStamp(stamp.payee, previousPayee) ? nextPayee : stamp.payee,
    signedBy: shouldSyncStamp(stamp.signedBy, previousSignedBy) ? nextSignedBy : stamp.signedBy,
    movementNumber: shouldSyncStamp(stamp.movementNumber, previousMovement)
      ? nextMovement
      : stamp.movementNumber,
    date: shouldSyncStamp(stamp.date, previousDate) ? nextDate || stamp.date : stamp.date,
  };
}

function derivePayeeFromProfile(profile: ProfileValues): string {
  return profile.company || profile.fullName || '';
}

function deriveSignerFromProfile(profile: ProfileValues): string {
  return profile.signatureName || profile.fullName || '';
}

function shouldSyncStamp(currentStampValue: string, previousProfileValue: string): boolean {
  return !currentStampValue || currentStampValue === previousProfileValue;
}
