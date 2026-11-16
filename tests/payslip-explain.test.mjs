import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INSTRUCTIONS, TOOLSETS } from '../dist/server.js';
import { envelope, hardFailure, json, textOf, withMcp } from './helpers.mjs';

// TMS-5021: "maaşım neden düştü" from the interactive payslip (no AI, no credit).
const VIEW = {
  payrollId: 'pay-7',
  period: '2026-07',
  periodName: 'July 2026',
  previousPeriod: '2026-06',
  previousPeriodName: 'June 2026',
  firstPayroll: false,
  lines: [
    { key: 'time.S001', code: 'S001', kind: 'EARNING', label: 'Normal work', amount: 37333.33, text: 'Pay for the days you worked.',
      previous: 40000, change: -2666.67, status: 'DOWN', reason: 'DAYS_WORKED', reasonText: 'Your paid days changed from 30 to 28.' },
    { key: 'payment.P002', code: 'P002', kind: 'EARNING', label: 'Premium', amount: 2000, text: 'Paid on top of your salary.',
      previous: 0, change: 2000, status: 'NEW', reason: 'NEW_ITEM', reasonText: 'New this month.' },
    { key: 'gross', kind: 'TOTAL', label: 'Gross pay', amount: 39333.33, previous: 41000, change: -1666.67, status: 'DOWN', reason: 'DAYS_WORKED' },
    { key: 'stampTax', kind: 'DEDUCTION', label: 'Stamp tax', amount: 298.56, previous: 298.56, change: 0, status: 'SAME', reason: null },
    { key: 'incomeTax', kind: 'DEDUCTION', label: 'Income tax', amount: 5120.4, previous: 4420, change: 700.4, status: 'UP',
      reason: 'TAX_BRACKET', reasonText: 'Your earnings so far this year moved you from Band 1 (15%) to Band 2 (20%).' },
    { key: 'net', kind: 'NET', label: 'Net pay', amount: 27320, previous: 28800, change: -1480, status: 'DOWN', reason: 'DAYS_WORKED' },
  ],
  net: { after: 27320, before: 28800, delta: -1480, reasonsAvailable: true, reasons: [
    { code: 'PAID_DAYS', category: 'DAYS_WORKED', label: 'Change in paid days', amount: -1920 },
    { code: 'PAYMENT', category: 'NEW_ITEM', label: 'Premium', itemCode: 'P002', amount: 1440 },
    { code: 'OTHER', category: 'OTHER', label: 'Other', amount: 0 },
  ] },
  summary: 'Your net pay for July 2026 is 27.320,00 TL, 1.480,00 TL less than in June 2026. The main reason: Change in paid days.',
  yearToDate: { year: 2026, months: ['2026-05', '2026-06', '2026-07'], gross: 120000, net: 84920, incomeTax: 13960.4,
    stampTax: 905.76, sgkEmployee: 16986.67, unemploymentEmployee: 1213.33, sgkTotal: 18200 },
  taxBracket: { band: 1, rate: 0.15, cumulativeBase: 180000, limit: 190000, remaining: 10000, nextBand: 2, nextRate: 0.2,
    nextPeriod: '2026-08', crossesNextMonth: true, state: 'crossing', text: 'Your tax band may change in August 2026.' },
};

test('explain_my_payslip is a read only payroll tool named in the instructions', async () => {
  assert.deepEqual([...TOOLSETS.payroll], ['list_my_payslips', 'explain_my_payslip', 'get_payslip_pdf']);
  assert.match(DEFAULT_INSTRUCTIONS, /explain_my_payslip/);
  assert.match(DEFAULT_INSTRUCTIONS, /maaşım neden düştü/);
  await withMcp([], async ({ tools }) => {
    const tool = tools.find(item => item.name === 'explain_my_payslip');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  });
});

test('explain_my_payslip answers why the net pay went down, with the changed lines, year totals and band warning', async () => {
  await withMcp([['GET /payroll/me/payslip-view', () => envelope(VIEW)]], async ({ call, calls }) => {
    const result = await call('explain_my_payslip', {});
    assert.notEqual(result.isError, true, textOf(result));
    const s = result.structuredContent;
    assert.equal(s.payslipId, 'pay-7');
    assert.equal(s.netChange, -1480);
    // reasons without an effect are left out
    assert.deepEqual(s.reasons.map(r => r.category), ['DAYS_WORKED', 'NEW_ITEM']);
    assert.deepEqual(s.changedLines.map(l => l.key), ['time.S001', 'payment.P002', 'gross', 'incomeTax', 'net']);
    assert.equal(s.changedLines.find(l => l.key === 'incomeTax').reason, 'TAX_BRACKET');
    assert.equal(s.lines.length, 6);
    assert.equal(s.yearToDate.socialSecurity, 18200);
    assert.equal(s.taxBracket.crossesNextMonth, true);
    const text = textOf(result);
    assert.match(text, /1\.480,00 TL less/);
    assert.match(text, /Change in paid days \| -1920\.00/);
    assert.match(text, /Tax band warning/);
    assert.match(text, /3 closed months/);
    const sent = calls.filter(c => c.path === '/payroll/me/payslip-view');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].query.month, undefined);
  });
});

test('explain_my_payslip with month or payslip_id asks for that payslip', async () => {
  await withMcp([
    ['GET /payroll/me/payslip-view', () => envelope({ ...VIEW, period: '2026-06' })],
    ['GET /payroll/payslip-view/pay-6', () => envelope({ ...VIEW, payrollId: 'pay-6', period: '2026-06' })],
  ], async ({ call, calls }) => {
    const byMonth = await call('explain_my_payslip', { month: '2026-06' });
    assert.equal(byMonth.structuredContent.period, '2026-06');
    const byId = await call('explain_my_payslip', { payslip_id: 'pay-6' });
    assert.equal(byId.structuredContent.payslipId, 'pay-6');
    assert.ok(calls.some(c => c.path === '/payroll/payslip-view/pay-6'));
    assert.equal(calls.find(c => c.path === '/payroll/me/payslip-view').query.month, '2026-06');
    const bad = await call('explain_my_payslip', { month: '06-2026' });
    assert.equal(bad.isError, true);
  });
});

test('explain_my_payslip explains why a payslip cannot be explained', async () => {
  await withMcp([
    ['GET /payroll/me/payslip-view', () => hardFailure('PAYSLIP_VIEW_NOT_AVAILABLE', 'VALIDATION_ERROR')],
    ['GET /payroll/payslip-view/pay-x', () => json({ code: 0, message: 'PERMISSION_DENIED', message_code: 'PERMISSION_DENIED' }, 403)],
  ], async ({ call }) => {
    const missing = await call('explain_my_payslip', { month: '2026-03' });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /list_my_payslips/);
    const foreign = await call('explain_my_payslip', { payslip_id: 'pay-x' });
    assert.equal(foreign.isError, true);
    assert.match(textOf(foreign), /not yours|own payslips/);
  });
});
