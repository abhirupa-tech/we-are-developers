/**
 * A small A2UI (Agent-to-User Interface) dialect.
 *
 * The idea, as in Google's A2UI: the agent never sends code. It sends a
 * declarative description of UI built only from components the client already
 * trusts (the catalog below), plus a data model the components bind to. The
 * client renders it with its own components and styles, and sends user
 * actions back to the agent as data.
 *
 * Differences from the A2UI spec, to keep it easy for a chat model to write
 * correctly: one JSON object per surface, components nested as a tree
 * (instead of a flat adjacency list), and bindings are a dotted `path` into
 * the surface's `dataModel`.
 */

export type Option = { value: string; label: string };

export type A2Node =
  | { type: 'Column'; children: A2Node[]; gap?: 'sm' | 'md' | 'lg' }
  | { type: 'Row'; children: A2Node[]; gap?: 'sm' | 'md' | 'lg'; align?: 'start' | 'center' | 'end' | 'between' }
  | { type: 'Card'; title?: string; subtitle?: string; children?: A2Node[] }
  | { type: 'Text'; text: string; variant?: 'h1' | 'h2' | 'body' | 'caption' }
  | { type: 'Badge'; text: string; tone?: 'info' | 'success' | 'warning' | 'danger' }
  | { type: 'Divider' }
  | { type: 'Image'; url: string; alt: string }
  | { type: 'Button'; label: string; action: string; variant?: 'primary' | 'secondary' | 'danger' }
  | { type: 'CheckBox'; label: string; path: string }
  | { type: 'RadioGroup'; label?: string; path: string; options: Option[] }
  | { type: 'Select'; label: string; path: string; options: Option[] }
  | { type: 'TextField'; label: string; path: string; placeholder?: string; multiline?: boolean; inputType?: 'text' | 'number' | 'email' | 'date' }
  | { type: 'Slider'; label: string; path: string; min: number; max: number; step?: number; unit?: string }
  | { type: 'Rating'; label: string; path: string; max?: number }
  | { type: 'Progress'; label?: string; value: number; max?: number };

export type A2Type = A2Node['type'];

export type DataModel = Record<string, unknown>;

export type Surface = {
  surfaceId: string;
  title?: string;
  dataModel?: DataModel;
  root: A2Node;
};

/** What the client sends back when the user presses a Button. */
export type A2Action = {
  surfaceId: string;
  action: string;
  data: DataModel;
};

export const CATALOG: A2Type[] = [
  'Column',
  'Row',
  'Card',
  'Text',
  'Badge',
  'Divider',
  'Image',
  'Button',
  'CheckBox',
  'RadioGroup',
  'Select',
  'TextField',
  'Slider',
  'Rating',
  'Progress',
];
