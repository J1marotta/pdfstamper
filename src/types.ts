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

export interface PageSize {
  width: number;
  height: number;
}

export interface StampPlacement {
  pageId: string | null;
  x: number;
  y: number;
  width: number;
  rotation: number;
}

export interface PdfPageModel {
  id: string;
  kind: 'pdf';
  pageNumber: number;
  width: number;
  height: number;
  label: string;
}

export interface BlankPageModel {
  id: string;
  kind: 'blank';
  width: number;
  height: number;
  label: string;
}

export type DocumentPageModel = PdfPageModel | BlankPageModel;

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
  placement: StampPlacement;
  flatten: boolean;
  imageBytes: Uint8Array | null;
  imageMime: string | null;
  imageName: string | null;
}
