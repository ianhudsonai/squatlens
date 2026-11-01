/**
 * `eval/labels.csv` (SPEC §10): one row per labelled rep.
 *
 *   clip_id,view,rep_index,depth_label,valgus_label,notes
 *
 * - `clip_id`: fixture name; the track is `fixtures/<clip_id>.json` (or `.pose.json`).
 * - `view`: the view the clip was filmed from, `lateral` or `frontal` (diagonal clips are
 *   rejected by the quality gate, so they are not labelled).
 * - `rep_index`: 1-based rep number within the clip, in the order the reps happen.
 * - `depth_label`: `below` | `parallel` | `above` (hip crease vs top of the knee, judged by
 *   a person from the video).
 * - `valgus_label`: `yes` | `no` | `na` (`na` = could not judge, e.g. lateral view).
 * - `notes`: free text; quote it if it contains commas.
 *
 * Blank lines and lines starting with `#` (comments; quotes in them are not parsed) are ignored.
 */

export type DepthLabel = 'below' | 'parallel' | 'above';
export type ValgusLabel = 'yes' | 'no' | 'na';
export type ViewLabel = 'lateral' | 'frontal';

export interface LabelRow {
  clipId: string;
  view: ViewLabel;
  /** 1-based. */
  repIndex: number;
  depth: DepthLabel;
  valgus: ValgusLabel;
  notes: string;
  /** 1-based line in the CSV, for error messages. */
  line: number;
}

export const LABELS_HEADER = [
  'clip_id',
  'view',
  'rep_index',
  'depth_label',
  'valgus_label',
  'notes',
] as const;

const DEPTH: readonly string[] = ['below', 'parallel', 'above'];
const VALGUS: readonly string[] = ['yes', 'no', 'na'];
const VIEWS: readonly string[] = ['lateral', 'frontal'];
/** Safe as a file name: no path separators, no leading dot. */
const CLIP_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Splits CSV text into records of fields (RFC 4180 quoting; CRLF or LF). A line starting with
 * `#` outside a quoted field is a comment and is skipped whole.
 */
export function parseCsv(text: string): Array<{ line: number; fields: string[] }> {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const src = text.replace(/^\uFEFF/, '');
  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = '';
  };
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
      i++;
      continue;
    }
    if (c === '#' && field === '' && fields.length === 0) {
      // Comment line: skip to its end without parsing quotes.
      const nl = src.indexOf('\n', i);
      if (nl < 0) break;
      i = nl + 1;
      line++;
      recordLine = line;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else if (c === '\r' && src[i + 1] === '\n') {
      i++;
      continue;
    } else if (c === '\n') {
      endRecord();
      line++;
      recordLine = line;
    } else field += c;
    i++;
  }
  if (quoted) throw new Error(`labels.csv line ${recordLine}: unterminated quoted field`);
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/**
 * Parses and validates labels.csv. Throws one error listing every problem found, so a person
 * fixing the file sees them all at once.
 */
export function parseLabels(text: string): LabelRow[] {
  const records = parseCsv(text).filter(
    (r) => !(r.fields.length === 1 && r.fields[0]!.trim() === ''),
  );
  const header = records.shift();
  const expected = LABELS_HEADER.join(',');
  if (!header || header.fields.map((f) => f.trim()).join(',') !== expected) {
    throw new Error(`labels.csv: the first row must be exactly "${expected}"`);
  }

  const errors: string[] = [];
  const rows: LabelRow[] = [];
  const seen = new Map<string, number>();
  for (const { line, fields } of records) {
    const at = `labels.csv line ${line}`;
    if (fields.length < 5 || fields.length > 6) {
      errors.push(`${at}: expected 6 columns (notes may be omitted), got ${fields.length}`);
      continue;
    }
    const [clipId, view, repIndex, depth, valgus, notes = ''] = fields.map((f) => f.trim()) as [
      string,
      string,
      string,
      string,
      string,
      string?,
    ];
    const before = errors.length;
    if (!CLIP_ID.test(clipId)) errors.push(`${at}: invalid clip_id "${clipId}"`);
    if (!VIEWS.includes(view)) errors.push(`${at}: view must be lateral|frontal, got "${view}"`);
    const idx = Number(repIndex);
    if (!/^\d+$/.test(repIndex) || idx < 1) {
      errors.push(`${at}: rep_index must be a whole number >= 1, got "${repIndex}"`);
    }
    if (!DEPTH.includes(depth)) {
      errors.push(`${at}: depth_label must be below|parallel|above, got "${depth}"`);
    }
    if (!VALGUS.includes(valgus)) {
      errors.push(`${at}: valgus_label must be yes|no|na, got "${valgus}"`);
    }
    const key = `${clipId}#${idx}`;
    const prev = seen.get(key);
    if (prev !== undefined) errors.push(`${at}: duplicate of line ${prev} (${clipId} rep ${idx})`);
    else seen.set(key, line);
    if (errors.length > before) continue;
    rows.push({
      clipId,
      view: view as ViewLabel,
      repIndex: idx,
      depth: depth as DepthLabel,
      valgus: valgus as ValgusLabel,
      notes,
      line,
    });
  }

  // One view per clip.
  const views = new Map<string, LabelRow>();
  for (const r of rows) {
    const first = views.get(r.clipId);
    if (!first) views.set(r.clipId, r);
    else if (first.view !== r.view) {
      errors.push(
        `labels.csv line ${r.line}: ${r.clipId} is "${r.view}" here but "${first.view}" on line ${first.line}`,
      );
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return rows;
}

/** Serializes rows back to CSV (used to write the synthetic set's labels). */
export function formatLabels(rows: readonly Omit<LabelRow, 'line'>[]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows.map((r) =>
    [r.clipId, r.view, String(r.repIndex), r.depth, r.valgus, q(r.notes)].join(','),
  );
  return [LABELS_HEADER.join(','), ...lines].join('\n') + '\n';
}
