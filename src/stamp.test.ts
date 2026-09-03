import { describe, expect, it } from 'vitest';

import {
  buildStampRows,
  formatStampDate,
  isStampPlaced,
  wrapStampText,
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
      width: 300,
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
      'date',
    ]);
    expect(rows[0]?.value).toBe('Acme');
    expect(rows[1]?.emphasis).toBe(true);
    expect(rows[8]?.value).toBe('2026-05-20');
  });

  it('keeps a manually edited stamp date instead of overwriting it from the profile', () => {
    const previousProfile = { date: '2026-05-20' };
    const nextProfile = { date: '2026-05-21' };

    const linked = syncStampFromProfile(previousProfile, nextProfile, makeStamp({ date: '2026-05-20' }));
    const custom = syncStampFromProfile(previousProfile, nextProfile, makeStamp({ date: '2026-06-01' }));

    expect(linked.date).toBe('2026-05-21');
    expect(custom.date).toBe('2026-06-01');
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
        width: 260,
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

  it('formats ISO stamp dates for display and passes the rest through', () => {
    expect(formatStampDate('2026-05-20')).toBe('20 May 2026');
    expect(formatStampDate('2026-01-05')).toBe('5 Jan 2026');
    expect(formatStampDate('')).toBe('');
    expect(formatStampDate('May 2026')).toBe('May 2026');
    expect(formatStampDate('2026-13-01')).toBe('2026-13-01');
    expect(formatStampDate('2026-02-30')).toBe('2026-02-30');
  });

  it('exposes the date row as a date input', () => {
    const rows = buildStampRows(makeStamp());
    expect(rows.find((row) => row.key === 'date')?.inputType).toBe('date');
  });

  it('detects stamp text that export wrapping will cut off', () => {
    expect(wrapStampText('Acme Pty Ltd', 30, 2)).toMatchObject({ truncated: false });
    expect(wrapStampText('Supercalifragilisticexpialidocious Pty Ltd', 10, 2).truncated).toBe(true);
    expect(wrapStampText('one two three four five', 7, 2).truncated).toBe(true);
    expect(wrapStampText('', 30, 2)).toMatchObject({ lines: [], truncated: false });
  });
});
