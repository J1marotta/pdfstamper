export type FieldKind =
  | 'text'
  | 'checkbox'
  | 'dropdown'
  | 'radio'
  | 'option-list'
  | 'button'
  | 'signature'
  | 'unknown';

export type SemanticKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'mobile'
  | 'company'
  | 'title'
  | 'address1'
  | 'address2'
  | 'suburb'
  | 'city'
  | 'state'
  | 'postcode'
  | 'country'
  | 'abn'
  | 'acn'
  | 'reference'
  | 'date'
  | 'signatureName';

export interface ProfileFieldDefinition {
  key: SemanticKey;
  label: string;
  placeholder: string;
  helper: string;
}

export interface PdfFieldModel {
  id: string;
  name: string;
  label: string;
  kind: FieldKind;
  semanticKey: SemanticKey | null;
  value: string | boolean;
  originalValue: string | boolean;
  dirty: boolean;
  autoFilled: boolean;
  options: string[];
  readOnly: boolean;
}

export interface FillStats {
  autofilledCount: number;
  remainingCount: number;
  editableCount: number;
  matchedCount: number;
}

export type ProfileValues = Partial<Record<SemanticKey, string>>;

export interface StampSettings {
  mode: 'text' | 'image' | 'both';
  payee: string;
  totalAmount: string;
  gstAmount: string;
  movementNumber: string;
  signedBy: string;
  coSignedBy: string;
  approvedBy1: string;
  approvedBy2: string;
  date: string;
  placement: 'last-page' | 'every-page';
  alignment: 'left' | 'center' | 'right';
  flatten: boolean;
  imageBytes: Uint8Array | null;
  imageMime: string | null;
  imageName: string | null;
}
