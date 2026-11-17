import { CATALOG, type A2Action, type A2Node, type DataModel, type Surface } from './types';

export type Segment = { kind: 'markdown'; text: string } | { kind: 'a2ui'; json: string; complete: boolean };

const FENCE = '```a2ui';

/**
 * Splits a (possibly still streaming) answer into Markdown and ```a2ui
 * blocks. A block whose closing fence hasn't arrived yet is `complete: false`,
 * so the UI can show a placeholder instead of half-parsed JSON.
 */
export function splitA2ui(text: string): Segment[] {
  const out: Segment[] = [];
  const done = () => out.filter((s) => s.kind === 'a2ui' || s.text.trim() !== '');
  let i = 0;
  for (;;) {
    const open = text.indexOf(FENCE, i);
    if (open === -1) {
      if (i < text.length) out.push({ kind: 'markdown', text: text.slice(i) });
      return done();
    }
    if (open > i) out.push({ kind: 'markdown', text: text.slice(i, open) });
    const bodyStart = text.indexOf('\n', open);
    if (bodyStart === -1) {
      out.push({ kind: 'a2ui', json: '', complete: false });
      return done();
    }
    const close = text.indexOf('\n```', bodyStart);
    if (close === -1) {
      out.push({ kind: 'a2ui', json: text.slice(bodyStart + 1), complete: false });
      return done();
    }
    out.push({ kind: 'a2ui', json: text.slice(bodyStart + 1, close), complete: true });
    i = close + 4;
  }
}

export type ParseResult = { ok: true; surface: Surface } | { ok: false; error: string };

/** Parses and validates one surface. Never throws: the agent's output is untrusted. */
export function parseSurface(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `invalid JSON (${(err as Error).message})` };
  }
  if (!isObject(raw)) return { ok: false, error: 'a surface must be a JSON object' };
  const error = checkNode(raw.root, 'root', 0);
  if (error) return { ok: false, error };
  return {
    ok: true,
    surface: {
      surfaceId: typeof raw.surfaceId === 'string' ? raw.surfaceId : 'surface',
      title: typeof raw.title === 'string' ? raw.title : undefined,
      dataModel: isObject(raw.dataModel) ? raw.dataModel : {},
      root: raw.root as A2Node,
    },
  };
}

const MAX_DEPTH = 12;

function checkNode(node: unknown, where: string, depth: number): string | null {
  if (depth > MAX_DEPTH) return `${where}: nested too deeply`;
  if (!isObject(node)) return `${where}: expected a component object`;
  if (typeof node.type !== 'string') return `${where}: missing "type"`;
  if (!CATALOG.includes(node.type as A2Node['type'])) return `${where}: "${node.type}" is not in the catalog`;
  const needs = (key: string, kind: 'string' | 'number' | 'array') => {
    const v = node[key];
    const okay = kind === 'array' ? Array.isArray(v) : typeof v === kind;
    return okay ? null : `${where} (${node.type}): "${key}" must be a ${kind}`;
  };
  const required: Record<string, [string, 'string' | 'number' | 'array'][]> = {
    Column: [['children', 'array']],
    Row: [['children', 'array']],
    Text: [['text', 'string']],
    Badge: [['text', 'string']],
    Image: [['url', 'string']],
    Button: [['label', 'string'], ['action', 'string']],
    CheckBox: [['label', 'string'], ['path', 'string']],
    RadioGroup: [['path', 'string'], ['options', 'array']],
    Select: [['label', 'string'], ['path', 'string'], ['options', 'array']],
    TextField: [['label', 'string'], ['path', 'string']],
    Slider: [['label', 'string'], ['path', 'string'], ['min', 'number'], ['max', 'number']],
    Rating: [['label', 'string'], ['path', 'string']],
    Progress: [['value', 'number']],
  };
  for (const [key, kind] of required[node.type] ?? []) {
    const e = needs(key, kind);
    if (e) return e;
  }
  if (node.type === 'Image' && !/^https:\/\//.test(node.url as string)) return `${where} (Image): url must be https`;
  if ('options' in node && Array.isArray(node.options)) {
    const bad = node.options.findIndex((o) => !isObject(o) || typeof o.value !== 'string' || typeof o.label !== 'string');
    if (bad !== -1) return `${where} (${node.type}): options[${bad}] needs a string value and label`;
  }
  const children = node.children;
  if (children !== undefined) {
    if (!Array.isArray(children)) return `${where} (${node.type}): "children" must be an array`;
    for (let i = 0; i < children.length; i++) {
      const e = checkNode(children[i], `${where}.children[${i}]`, depth + 1);
      if (e) return e;
    }
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Reads a dotted path ("trip.nights") from the data model. */
export function getPath(data: DataModel, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), data);
}

/** Immutable write of a dotted path. */
export function setPath(data: DataModel, path: string, value: unknown): DataModel {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...data, [head]: value };
  const child = isObject(data[head]) ? (data[head] as DataModel) : {};
  return { ...data, [head]: setPath(child, rest.join('.'), value) };
}

const ACTION_PREFIX = '[a2ui action] ';

/** The message the agent receives when the user presses a Button. */
export function encodeAction(action: A2Action): string {
  return ACTION_PREFIX + JSON.stringify(action);
}

export function decodeAction(text: string): A2Action | null {
  if (!text.startsWith(ACTION_PREFIX)) return null;
  try {
    return JSON.parse(text.slice(ACTION_PREFIX.length)) as A2Action;
  } catch {
    return null;
  }
}
