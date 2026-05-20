import { describe, expect, it } from 'vitest';

import {
  buildStampRows,
  shouldShowStampImage,
  shouldShowStampOnPage,
  shouldShowStampTable,
  syncStampFromProfile,
} from './stamp';
import type { StampSettings } from './types';

function makeStamp(overrides: Partial<StampSettings> = {}): StampSettings {
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
    date: '2026-05-20',
    placement: 'last-page',
    alignment: 'right',
    flatten: false,
    imageBytes: null,
    imageMime: null,
    imageName: null,
    ...overrides,
  };
}

describe('stamp helpers', () => {
  it('builds inline-editable rows in stamp order', () => {
    const rows = buildStampRows(
      makeStamp({
        payee: 'Acme',
        totalAmount: '$100.00',
      }),
    );

    expect(rows.map((row) => row.key)).toEqual([
      'payee',
      'totalAmount',
      'gstAmount',
      'movementNumber',
      'signedBy',
      'coSignedBy',
      'approvedBy1',
      'approvedBy2',
    ]);
    expect(rows[0]?.value).toBe('Acme');
    expect(rows[1]?.emphasis).toBe(true);
  });

  it('syncs stamp values from profile only while those fields are still linked', () => {
    const previousProfile = {
      fullName: 'Taylor Smith',
      company: 'Northwind Pty Ltd',
      reference: 'REF-001',
      date: '2026-05-20',
    };
    const nextProfile = {
      fullName: 'Jordan Smith',
      company: 'Southwind Pty Ltd',
      reference: 'REF-002',
      date: '2026-05-21',
    };

    const synced = syncStampFromProfile(
      previousProfile,
      nextProfile,
      makeStamp({
        payee: 'Northwind Pty Ltd',
        signedBy: 'Taylor Smith',
        movementNumber: 'REF-001',
      }),
    );

    const preserved = syncStampFromProfile(
      previousProfile,
      nextProfile,
      makeStamp({
        payee: 'Custom Payee',
        signedBy: 'Taylor Smith',
        movementNumber: 'Custom Reference',
      }),
    );

    expect(synced.payee).toBe('Southwind Pty Ltd');
    expect(synced.signedBy).toBe('Jordan Smith');
    expect(synced.movementNumber).toBe('REF-002');
    expect(synced.date).toBe('2026-05-21');
    expect(preserved.payee).toBe('Custom Payee');
    expect(preserved.movementNumber).toBe('Custom Reference');
  });

  it('matches preview visibility rules to placement and image mode', () => {
    const imageOnly = makeStamp({ mode: 'image' });

    expect(shouldShowStampTable(imageOnly, false)).toBe(true);
    expect(shouldShowStampTable(imageOnly, true)).toBe(false);
    expect(shouldShowStampImage(imageOnly, true)).toBe(true);
    expect(shouldShowStampOnPage(makeStamp({ placement: 'last-page' }), 1, 2)).toBe(false);
    expect(shouldShowStampOnPage(makeStamp({ placement: 'last-page' }), 2, 2)).toBe(true);
    expect(shouldShowStampOnPage(makeStamp({ placement: 'every-page' }), 1, 2)).toBe(true);
  });
});
