import { describe, expect, it } from 'vitest';

import { applyProfileToFields } from './heuristics';
import type { PdfFieldModel } from './types';

describe('applyProfileToFields', () => {
  it('preserves manual edits on mapped text fields', () => {
    const fields: PdfFieldModel[] = [
      {
        id: '1',
        name: 'full_name',
        label: 'Full Name',
        kind: 'text',
        semanticKey: 'fullName',
        value: 'Custom Name',
        originalValue: '',
        dirty: true,
        autoFilled: false,
        options: [],
        readOnly: false,
      },
    ];

    const result = applyProfileToFields(fields, { fullName: 'Autofill Name' }, true);

    expect(result.fields[0]?.value).toBe('Custom Name');
    expect(result.fields[0]?.dirty).toBe(true);
    expect(result.stats.remainingCount).toBe(0);
  });

  it('leaves unmatched dropdown values blank instead of forcing invalid options', () => {
    const fields: PdfFieldModel[] = [
      {
        id: '2',
        name: 'claim_status',
        label: 'Claim Status',
        kind: 'dropdown',
        semanticKey: 'company',
        value: '',
        originalValue: '',
        dirty: false,
        autoFilled: false,
        options: ['Pending', 'Approved', 'Declined'],
        readOnly: false,
      },
    ];

    const result = applyProfileToFields(fields, { company: 'No matching option' }, true);

    expect(result.fields[0]?.value).toBe('');
    expect(result.fields[0]?.autoFilled).toBe(false);
    expect(result.stats.remainingCount).toBe(1);
  });
});
