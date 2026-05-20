import { describe, expect, it } from 'vitest';

import {
  buildStampRows,
  isStampPlaced,
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
    placement: {
      pageId: null,
      x: 0.5,
      y: 0.7,
      width: 0.52,
      rotation: 0,
    },
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

  it('matches page placement and image visibility rules', () => {
    const imageOnly = makeStamp({ mode: 'image' });
    const placed = makeStamp({
      placement: {
        pageId: 'blank-1',
        x: 0.44,
        y: 0.68,
        width: 0.42,
        rotation: 18,
      },
    });

    expect(shouldShowStampTable(imageOnly, false)).toBe(true);
    expect(shouldShowStampTable(imageOnly, true)).toBe(false);
    expect(shouldShowStampImage(imageOnly, true)).toBe(true);
    expect(isStampPlaced(makeStamp())).toBe(false);
    expect(isStampPlaced(placed)).toBe(true);
    expect(shouldShowStampOnPage(placed, 'pdf-1')).toBe(false);
    expect(shouldShowStampOnPage(placed, 'blank-1')).toBe(true);
  });
});
