import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditLog } from './audit';
import { ReportLog } from './reports';

describe('AuditLog', () => {
  it('keeps the newest entries, newest first', () => {
    const log = new AuditLog(3);
    for (let i = 0; i < 5; i++) log.record({ action: `a${i}`, ip: '1.1.1.1' });
    expect(log.list().map((e) => e.action)).toEqual(['a4', 'a3', 'a2']);
    expect(log.list(1).map((e) => e.action)).toEqual(['a4']);
  });

  it('reloads the last entries from the file and compacts it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'audit-')), 'admin-audit.jsonl');
    const line = (i: number) => JSON.stringify({ ts: i, action: `a${i}`, ip: '1.1.1.1' });
    writeFileSync(file, [line(1), 'not json', line(2), line(3), line(4)].join('\n') + '\n');
    const log = new AuditLog(2, file);
    expect(log.list().map((e) => e.action)).toEqual(['a4', 'a3']);
    expect(readFileSync(file, 'utf8')).toBe(line(3) + '\n' + line(4) + '\n');
  });

  it('flush() resolves once the appended lines are on disk, in order', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'audit-')), 'admin-audit.jsonl');
    const log = new AuditLog(10, file);
    for (let i = 0; i < 5; i++) log.record({ action: `a${i}`, ip: '1.1.1.1' });
    await log.flush();
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines.map((l) => (JSON.parse(l) as { action: string }).action)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
  });
});

import { csvOf } from './audit';

describe('audit csv', () => {
  it('quotes cells and neutralises spreadsheet formulas', () => {
    const csv = csvOf(['a', 'b'], [['plain', 'has,comma'], ['=SUM(A1)', 'say "hi"\nnow']]);
    expect(csv).toBe('a,b\r\nplain,"has,comma"\r\n\'=SUM(A1),"say ""hi""\nnow"\r\n');
  });

  it('exports the newest entries first with a header', () => {
    const log = new AuditLog(10);
    log.record({ action: 'one', ip: '1.1.1.1' });
    log.record({ action: 'two', target: 'room:ABCD', ip: '2.2.2.2', detail: { a: 1 } });
    const lines = log.toCsv().trim().split('\r\n');
    expect(lines[0]).toBe('time,action,target,ip,detail');
    expect(lines[1]).toContain(',two,room:ABCD,2.2.2.2,');
    expect(lines[2]).toContain(',one,,1.1.1.1,');
  });
});

describe('ReportLog flush', () => {
  it('resolves once the appended lines are on disk, in order', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'reports-')), 'reports.jsonl');
    const log = new ReportLog(10, file);
    for (let i = 0; i < 3; i++) log.record({ room: 'ABCD', reporterId: 'p1', reporter: 'One', targetId: `t${i}`, target: 'Two' });
    await log.flush();
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
  });
});
