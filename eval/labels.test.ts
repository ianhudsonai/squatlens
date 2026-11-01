import { describe, expect, it } from 'vitest';
import { formatLabels, parseCsv, parseLabels } from './labels';

const HEADER = 'clip_id,view,rep_index,depth_label,valgus_label,notes';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas, newlines in quotes and CRLF', () => {
    const recs = parseCsv('a,"b, c","say ""hi"""\r\nx,"multi\nline",z\n');
    expect(recs.map((r) => r.fields)).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['x', 'multi\nline', 'z'],
    ]);
    expect(recs.map((r) => r.line)).toEqual([1, 2]);
  });

  it('keeps a last record without a trailing newline and strips a BOM', () => {
    expect(parseCsv('\uFEFFa,b\nc,d').map((r) => r.fields)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/unterminated/);
  });
});

describe('parseLabels', () => {
  it('accepts the header alone (no clips yet)', () => {
    expect(parseLabels(`${HEADER}\n`)).toEqual([]);
  });

  it('parses rows, skipping blank and # lines; notes are optional', () => {
    const rows = parseLabels(
      `${HEADER}\n# comment\n\nclip1,lateral,1,below,na,"deep, clean"\nclip1,lateral,2,parallel,na\n`,
    );
    expect(rows).toEqual([
      {
        clipId: 'clip1',
        view: 'lateral',
        repIndex: 1,
        depth: 'below',
        valgus: 'na',
        notes: 'deep, clean',
        line: 4,
      },
      {
        clipId: 'clip1',
        view: 'lateral',
        repIndex: 2,
        depth: 'parallel',
        valgus: 'na',
        notes: '',
        line: 5,
      },
    ]);
  });

  it('requires the exact header', () => {
    expect(() => parseLabels('clip,view\n')).toThrow(/first row/);
    expect(() => parseLabels('')).toThrow(/first row/);
  });

  it('reports every bad row at once, with line numbers', () => {
    const text = [
      HEADER,
      '../etc,lateral,1,below,na,',
      'c,diagonal,0,deep,maybe,',
      'c,lateral,1.5,below,na,',
      'd,lateral,1,below,na,',
      'd,lateral,1,above,na,',
      'd,frontal,2,above,no,',
      'e,lateral,1',
    ].join('\n');
    let message = '';
    try {
      parseLabels(text);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('line 2: invalid clip_id');
    expect(message).toContain('line 3: view must be');
    expect(message).toContain('line 3: rep_index must be');
    expect(message).toContain('line 3: depth_label must be');
    expect(message).toContain('line 3: valgus_label must be');
    expect(message).toContain('line 4: rep_index must be');
    expect(message).toContain('line 6: duplicate of line 5');
    expect(message).toContain('line 7: d is "frontal" here but "lateral" on line 5');
    expect(message).toContain('line 8: expected 6 columns, got 3');
  });

  it('round-trips through formatLabels', () => {
    const rows = parseLabels(`${HEADER}\na,frontal,1,above,yes,"x, ""y"""\n`);
    expect(parseLabels(formatLabels(rows))).toEqual(rows);
  });
});
