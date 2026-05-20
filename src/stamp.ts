import type { ProfileValues, StampSettings } from './types';

export type EditableStampKey =
  | 'payee'
  | 'totalAmount'
  | 'gstAmount'
  | 'movementNumber'
  | 'signedBy'
  | 'coSignedBy'
  | 'approvedBy1'
  | 'approvedBy2';

export interface StampRowModel {
  key: EditableStampKey;
  label: string;
  labelLines: string[];
  placeholder: string;
  value: string;
  emphasis?: boolean;
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

export function shouldShowStampOnPage(
  stamp: StampSettings,
  pageNumber: number,
  pageCount: number,
): boolean {
  return stamp.placement === 'every-page' || pageNumber === pageCount;
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

function derivePayeeFromProfile(profile: ProfileValues): string {
  return profile.company || profile.fullName || '';
}

function deriveSignerFromProfile(profile: ProfileValues): string {
  return profile.signatureName || profile.fullName || '';
}

function shouldSyncStamp(currentStampValue: string, previousProfileValue: string): boolean {
  return !currentStampValue || currentStampValue === previousProfileValue;
}
