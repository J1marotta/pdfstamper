import type {
  FillStats,
  PdfFieldModel,
  ProfileFieldDefinition,
  ProfileValues,
  SemanticKey,
} from './types';

export const PROFILE_FIELDS: ProfileFieldDefinition[] = [
  {
    key: 'fullName',
    label: 'Full name',
    placeholder: 'Taylor Smith',
    helper: 'Applicant or customer name used across the form.',
  },
  {
    key: 'firstName',
    label: 'First name',
    placeholder: 'Taylor',
    helper: 'Used when the PDF splits names into separate fields.',
  },
  {
    key: 'lastName',
    label: 'Last name',
    placeholder: 'Smith',
    helper: 'Surname or family name.',
  },
  {
    key: 'email',
    label: 'Email',
    placeholder: 'taylor@example.com',
    helper: 'Maps to email or contact-email fields.',
  },
  {
    key: 'phone',
    label: 'Phone',
    placeholder: '+61 400 000 000',
    helper: 'General phone or contact number.',
  },
  {
    key: 'mobile',
    label: 'Mobile',
    placeholder: '+61 400 000 000',
    helper: 'Only shown when the PDF distinguishes mobile from phone.',
  },
  {
    key: 'company',
    label: 'Company',
    placeholder: 'Northwind Pty Ltd',
    helper: 'Business or organisation name.',
  },
  {
    key: 'title',
    label: 'Role / title',
    placeholder: 'Operations Manager',
    helper: 'Job title or position.',
  },
  {
    key: 'address1',
    label: 'Address line 1',
    placeholder: 'Level 4, 20 Bridge St',
    helper: 'Street address or primary address line.',
  },
  {
    key: 'address2',
    label: 'Address line 2',
    placeholder: 'Suite 12',
    helper: 'Extra address detail if the PDF asks for it.',
  },
  {
    key: 'suburb',
    label: 'Suburb',
    placeholder: 'Sydney',
    helper: 'Useful for AU forms that separate suburb from city.',
  },
  {
    key: 'city',
    label: 'City / town',
    placeholder: 'Sydney',
    helper: 'City or town.',
  },
  {
    key: 'state',
    label: 'State',
    placeholder: 'NSW',
    helper: 'State, province, or region.',
  },
  {
    key: 'postcode',
    label: 'Postcode',
    placeholder: '2000',
    helper: 'Postal code or ZIP code.',
  },
  {
    key: 'country',
    label: 'Country',
    placeholder: 'Australia',
    helper: 'Country name.',
  },
  {
    key: 'abn',
    label: 'ABN',
    placeholder: '12 345 678 901',
    helper: 'Australian Business Number.',
  },
  {
    key: 'acn',
    label: 'ACN',
    placeholder: '123 456 789',
    helper: 'Australian Company Number.',
  },
  {
    key: 'reference',
    label: 'Reference',
    placeholder: 'Claim-4821',
    helper: 'Claim, member, or internal reference.',
  },
  {
    key: 'date',
    label: 'Date',
    placeholder: '',
    helper: 'Shared signing or submission date.',
  },
  {
    key: 'signatureName',
    label: 'Printed signatory name',
    placeholder: 'Taylor Smith',
    helper: 'Useful when the PDF asks for a printed name under a signature.',
  },
];

const FIELD_ALIASES: Record<SemanticKey, string[]> = {
  fullName: ['full name', 'applicant name', 'client name', 'contact name', 'your name', 'customer name'],
  firstName: ['first name', 'given name', 'forename'],
  lastName: ['last name', 'surname', 'family name'],
  email: ['email', 'e mail', 'email address', 'contact email'],
  phone: ['phone', 'telephone', 'tel', 'contact number', 'business phone'],
  mobile: ['mobile', 'cell', 'cellphone', 'cell phone'],
  company: ['company', 'business name', 'organisation', 'organization', 'trading name', 'employer'],
  title: ['title', 'position', 'role', 'job title'],
  address1: ['address', 'street address', 'address line 1', 'street'],
  address2: ['address line 2', 'suite', 'unit', 'level', 'building'],
  suburb: ['suburb'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  postcode: ['postcode', 'postal code', 'zip code', 'zip'],
  country: ['country'],
  abn: ['abn', 'australian business number'],
  acn: ['acn', 'australian company number'],
  reference: ['reference', 'ref', 'claim number', 'member number', 'customer id'],
  date: ['date', 'submission date', 'signed date', 'lodgement date'],
  signatureName: ['printed name', 'signatory name', 'authorised person', 'authorized person'],
};

const DEFAULT_PROFILE_KEYS: SemanticKey[] = [
  'fullName',
  'email',
  'phone',
  'company',
  'reference',
  'date',
];

export function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function humanizeFieldName(name: string): string {
  const cleaned = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Untitled field';
  }

  return cleaned
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inferSemanticKey(input: string): SemanticKey | null {
  const spaced = normaliseWords(input);
  const compact = normaliseCompact(input);
  let bestMatch: { key: SemanticKey; score: number } | null = null;

  for (const definition of PROFILE_FIELDS) {
    for (const alias of FIELD_ALIASES[definition.key]) {
      const aliasWords = normaliseWords(alias);
      const aliasCompact = normaliseCompact(alias);
      let score = 0;

      if (!aliasWords) {
        continue;
      }

      if (spaced === aliasWords || compact === aliasCompact) {
        score = 140 + aliasCompact.length;
      } else if (spaced.includes(aliasWords)) {
        score = 100 + aliasCompact.length;
      } else if (compact.includes(aliasCompact)) {
        score = 82 + aliasCompact.length;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          key: definition.key,
          score,
        };
      }
    }
  }

  return bestMatch && bestMatch.score >= 90 ? bestMatch.key : null;
}

export function pickActiveProfileKeys(
  fields: PdfFieldModel[],
  textDigest: string,
): SemanticKey[] {
  const active = new Set<SemanticKey>();
  const digest = normaliseWords(textDigest);

  for (const field of fields) {
    if (field.semanticKey) {
      active.add(field.semanticKey);
    }
  }

  for (const definition of PROFILE_FIELDS) {
    if (FIELD_ALIASES[definition.key].some((alias) => digest.includes(normaliseWords(alias)))) {
      active.add(definition.key);
    }
  }

  if (active.size === 0) {
    DEFAULT_PROFILE_KEYS.forEach((key) => active.add(key));
  }

  return PROFILE_FIELDS.filter((definition) => active.has(definition.key)).map(
    (definition) => definition.key,
  );
}

export function seedProfileValues(fields: PdfFieldModel[]): ProfileValues {
  const nextProfile: ProfileValues = {};

  for (const field of fields) {
    if (!field.semanticKey || typeof field.originalValue !== 'string') {
      continue;
    }

    const value = field.originalValue.trim();
    if (value && !nextProfile[field.semanticKey]) {
      nextProfile[field.semanticKey] = value;
    }
  }

  return nextProfile;
}

export function getProfileFieldDefinition(key: SemanticKey): ProfileFieldDefinition {
  return (
    PROFILE_FIELDS.find((definition) => definition.key === key) ?? PROFILE_FIELDS[0]
  );
}

export function isEditableField(field: PdfFieldModel): boolean {
  return !field.readOnly && field.kind !== 'button' && field.kind !== 'signature';
}

export function applyProfileToFields(
  fields: PdfFieldModel[],
  profile: ProfileValues,
  overwriteExisting: boolean,
): { fields: PdfFieldModel[]; stats: FillStats } {
  const semanticValues = new Map<SemanticKey, string>();

  (Object.entries(profile) as Array<[SemanticKey, string | undefined]>).forEach(
    ([key, value]) => {
      if (value && value.trim()) {
        semanticValues.set(key, value.trim());
      }
    },
  );

  for (const field of fields) {
    if (
      field.semanticKey &&
      field.dirty &&
      typeof field.value === 'string' &&
      field.value.trim() &&
      !semanticValues.has(field.semanticKey)
    ) {
      semanticValues.set(field.semanticKey, field.value.trim());
    }
  }

  for (const field of fields) {
    if (
      field.semanticKey &&
      typeof field.originalValue === 'string' &&
      field.originalValue.trim() &&
      !semanticValues.has(field.semanticKey)
    ) {
      semanticValues.set(field.semanticKey, field.originalValue.trim());
    }
  }

  let autofilledCount = 0;
  let remainingCount = 0;
  let editableCount = 0;
  let matchedCount = 0;

  const nextFields = fields.map((field) => {
    if (field.semanticKey) {
      matchedCount += 1;
    }

    if (!isEditableField(field)) {
      return field;
    }

    editableCount += 1;

    if (field.dirty) {
      if (needsManualAttention(field)) {
        remainingCount += 1;
      }
      return field;
    }

    const originalLocked = hasMeaningfulValue(field.originalValue) && !overwriteExisting;
    if (originalLocked) {
      if (needsManualAttention(field)) {
        remainingCount += 1;
      }
      return {
        ...field,
        value: field.originalValue,
        autoFilled: false,
      };
    }

    const semanticValue = field.semanticKey
      ? semanticValues.get(field.semanticKey) ?? ''
      : '';
    const nextValue = semanticValue
      ? coerceFieldValue(field, semanticValue)
      : emptyValueForField(field);
    const autoFilled = semanticValue.length > 0 && nextValue !== null && hasMeaningfulValue(nextValue);

    const updatedField: PdfFieldModel = {
      ...field,
      value: nextValue ?? emptyValueForField(field),
      autoFilled,
    };

    if (updatedField.autoFilled) {
      autofilledCount += 1;
    }

    if (needsManualAttention(updatedField)) {
      remainingCount += 1;
    }

    return updatedField;
  });

  return {
    fields: nextFields,
    stats: {
      autofilledCount,
      remainingCount,
      editableCount,
      matchedCount,
    },
  };
}

function coerceFieldValue(
  field: PdfFieldModel,
  rawValue: string,
): string | boolean | null {
  if (field.kind === 'checkbox') {
    return ['true', 'yes', '1', 'checked'].includes(rawValue.trim().toLowerCase());
  }

  if (
    field.kind === 'dropdown' ||
    field.kind === 'radio' ||
    field.kind === 'option-list'
  ) {
    const desired = normaliseCompact(rawValue);
    const exact = field.options.find((option) => normaliseCompact(option) === desired);
    if (exact) {
      return exact;
    }

    const fuzzy = field.options.find((option) => {
      const candidate = normaliseCompact(option);
      return candidate.includes(desired) || desired.includes(candidate);
    });

    return fuzzy ?? null;
  }

  return rawValue;
}

function emptyValueForField(field: PdfFieldModel): string | boolean {
  return field.kind === 'checkbox' ? false : '';
}

function needsManualAttention(field: PdfFieldModel): boolean {
  if (!isEditableField(field)) {
    return false;
  }

  if (field.kind === 'checkbox') {
    return false;
  }

  return typeof field.value === 'string' ? !field.value.trim() : false;
}

function hasMeaningfulValue(value: string | boolean): boolean {
  return typeof value === 'boolean' ? value : value.trim().length > 0;
}

function normaliseWords(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseCompact(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
