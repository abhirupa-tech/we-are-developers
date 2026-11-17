import { createContext, memo, useContext, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useRenderFlash } from '../debug/renderFlash';
import { getPath, parseSurface, setPath } from './parse';
import type { A2Action, A2Node, DataModel } from './types';

/**
 * How a surface talks back to the agent. `busy` is true while an answer is
 * streaming, so a click can't cut it off halfway.
 */
export const A2uiContext = createContext<{ onAction: (action: A2Action) => void; busy: boolean }>({
  onAction: () => {},
  busy: false,
});

type Ctx = {
  data: DataModel;
  set: (path: string, value: unknown) => void;
  locked: boolean;
  pressed: string | null;
  press: (action: string) => void;
};

const GAP = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' } as const;
const ALIGN = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' } as const;
const TONE = {
  info: 'bg-store/15 text-store',
  success: 'bg-ok/15 text-ok',
  warning: 'bg-alert/15 text-alert',
  danger: 'bg-danger/15 text-danger',
} as const;
const BUTTON = {
  primary: 'border-transparent bg-store text-bg hover:brightness-110',
  secondary: 'border-line bg-transparent text-text hover:bg-panel-2',
  danger: 'border-transparent bg-danger text-bg hover:brightness-110',
} as const;

const fieldLabel = 'text-[13px] font-medium text-muted';
const control =
  'h-10 w-full rounded-lg border border-solid border-line bg-bg px-3 text-[15px] text-text outline-none transition-colors focus:border-store disabled:opacity-60';

/**
 * One A2UI surface: parses the agent's JSON once, keeps the data model in
 * local state, and renders the tree with the catalog below. memo() keeps a
 * finished surface still while the rest of the answer streams in.
 */
export const A2Surface = memo(function A2Surface({ json }: { json: string }) {
  const parsed = useMemo(() => parseSurface(json), [json]);
  const { onAction, busy } = useContext(A2uiContext);
  const [data, setData] = useState<DataModel>(() => (parsed.ok ? (parsed.surface.dataModel ?? {}) : {}));
  const [pressed, setPressed] = useState<string | null>(null);
  const ref = useRenderFlash<HTMLDivElement>('A2Surface');

  if (!parsed.ok) {
    return (
      <div ref={ref} className="my-4 rounded-xl border border-dashed border-danger/50 p-4 text-[14px]">
        <div className="font-semibold text-danger">Couldn’t render this interface</div>
        <div className="mt-1 text-muted">{parsed.error}</div>
        <details className="mt-2">
          <summary className="cursor-pointer text-muted">Raw JSON</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-bg p-3 text-[12px]">{json}</pre>
        </details>
      </div>
    );
  }

  const { surface } = parsed;
  const ctx: Ctx = {
    data,
    set: (path, value) => setData((d) => setPath(d, path, value)),
    locked: pressed !== null || busy,
    pressed,
    press: (action) => {
      setPressed(action);
      onAction({ surfaceId: surface.surfaceId, action, data });
    },
  };

  return (
    <div ref={ref} className="a2ui-surface my-4 rounded-2xl border border-solid border-line bg-panel/70 p-4 shadow-[0_8px_30px_rgb(0_0_0/0.25)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-store/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-store">A2UI</span>
        {surface.title && <span className="text-[14px] font-semibold">{surface.title}</span>}
        {pressed && <span className="ml-auto text-[12px] text-muted">Sent “{pressed}”</span>}
      </div>
      <Node node={surface.root} ctx={ctx} />
    </div>
  );
});

/** Shown while the ```a2ui block is still streaming in. */
export function A2SurfacePending() {
  return (
    <div className="my-4 rounded-2xl border border-solid border-line bg-panel/70 p-4" aria-busy="true">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-store/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-store">A2UI</span>
        <span className="text-[13px] text-muted">Building interface…</span>
      </div>
      <div className="a2ui-shimmer h-3 w-2/3 rounded" />
      <div className="a2ui-shimmer mt-2.5 h-3 w-1/2 rounded" />
      <div className="a2ui-shimmer mt-4 h-9 w-28 rounded-lg" />
    </div>
  );
}

function Children({ nodes, ctx }: { nodes?: A2Node[]; ctx: Ctx }) {
  return <>{nodes?.map((n, i) => <Node key={i} node={n} ctx={ctx} />)}</>;
}

/** The catalog. Every component flashes on its own commits. */
function Node({ node, ctx }: { node: A2Node; ctx: Ctx }): ReactNode {
  const ref = useRenderFlash<HTMLElement>(node.type);
  const r = ref as RefObject<never>;

  switch (node.type) {
    case 'Column':
      return (
        <div ref={r} className={`flex flex-col ${GAP[node.gap ?? 'md']}`}>
          <Children nodes={node.children} ctx={ctx} />
        </div>
      );
    case 'Row':
      return (
        <div ref={r} className={`flex flex-wrap items-center ${GAP[node.gap ?? 'md']} ${ALIGN[node.align ?? 'start']}`}>
          <Children nodes={node.children} ctx={ctx} />
        </div>
      );
    case 'Card':
      return (
        <div ref={r} className="rounded-xl border border-solid border-line bg-bg/60 p-4">
          {node.title && <div className="text-[16px] font-semibold">{node.title}</div>}
          {node.subtitle && <div className="mt-0.5 text-[13px] text-muted">{node.subtitle}</div>}
          {node.children?.length ? (
            <div className={`flex flex-col gap-3 ${node.title || node.subtitle ? 'mt-3' : ''}`}>
              <Children nodes={node.children} ctx={ctx} />
            </div>
          ) : null}
        </div>
      );
    case 'Text': {
      const v = node.variant ?? 'body';
      if (v === 'h1') return <h3 ref={r} className="m-0 text-[20px] font-bold leading-tight">{node.text}</h3>;
      if (v === 'h2') return <h4 ref={r} className="m-0 text-[16px] font-semibold leading-snug">{node.text}</h4>;
      if (v === 'caption') return <p ref={r} className="m-0 text-[13px] text-muted">{node.text}</p>;
      return <p ref={r} className="m-0 text-[15px] leading-relaxed">{node.text}</p>;
    }
    case 'Badge':
      return (
        <span ref={r} className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[node.tone ?? 'info']}`}>
          {node.text}
        </span>
      );
    case 'Divider':
      return <hr ref={r} className="my-1 h-px w-full border-0 bg-line" />;
    case 'Image':
      return (
        <div ref={r}>
          <img src={node.url} alt={node.alt ?? ''} className="max-h-64 w-full rounded-lg object-cover" referrerPolicy="no-referrer" />
        </div>
      );
    case 'Button': {
      const isPressed = ctx.pressed === node.action;
      return (
        <button
          ref={r}
          type="button"
          disabled={ctx.locked}
          onClick={() => ctx.press(node.action)}
          className={`h-10 rounded-lg border border-solid px-4 text-[14px] font-semibold transition disabled:cursor-not-allowed ${BUTTON[node.variant ?? 'primary']} ${
            ctx.locked && !isPressed ? 'opacity-40' : ''
          }`}
        >
          {isPressed ? `✓ ${node.label}` : node.label}
        </button>
      );
    }
    case 'CheckBox':
      return (
        <label ref={r} className="flex w-fit cursor-pointer items-center gap-2.5 text-[15px]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--s-store)]"
            checked={!!getPath(ctx.data, node.path)}
            disabled={ctx.locked}
            onChange={(e) => ctx.set(node.path, e.target.checked)}
          />
          {node.label}
        </label>
      );
    case 'RadioGroup':
      return (
        <fieldset ref={r} className="m-0 flex flex-col gap-2 border-0 p-0">
          {node.label && <legend className={`${fieldLabel} mb-2 p-0`}>{node.label}</legend>}
          {node.options.map((o) => (
            <label key={o.value} className="flex w-fit cursor-pointer items-center gap-2.5 text-[15px]">
              <input
                type="radio"
                className="size-4 accent-[var(--s-store)]"
                checked={getPath(ctx.data, node.path) === o.value}
                disabled={ctx.locked}
                onChange={() => ctx.set(node.path, o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    case 'Select':
      return (
        <label ref={r} className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{node.label}</span>
          <select
            className={control}
            value={String(getPath(ctx.data, node.path) ?? '')}
            disabled={ctx.locked}
            onChange={(e) => ctx.set(node.path, e.target.value)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {node.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'TextField': {
      const value = String(getPath(ctx.data, node.path) ?? '');
      const onChange = (raw: string) => ctx.set(node.path, node.inputType === 'number' && raw !== '' ? Number(raw) : raw);
      return (
        <label ref={r} className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{node.label}</span>
          {node.multiline ? (
            <textarea
              className={`${control} h-auto min-h-20 resize-y py-2`}
              value={value}
              placeholder={node.placeholder}
              disabled={ctx.locked}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <input
              className={control}
              type={node.inputType ?? 'text'}
              value={value}
              placeholder={node.placeholder}
              disabled={ctx.locked}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </label>
      );
    }
    case 'Slider': {
      const value = Number(getPath(ctx.data, node.path) ?? node.min);
      return (
        <label ref={r} className="flex flex-col gap-1.5">
          <span className={`${fieldLabel} flex justify-between`}>
            {node.label}
            <span className="font-mono text-text">
              {value}
              {node.unit ? ` ${node.unit}` : ''}
            </span>
          </span>
          <input
            type="range"
            className="w-full accent-[var(--s-store)]"
            min={node.min}
            max={node.max}
            step={node.step ?? 1}
            value={value}
            disabled={ctx.locked}
            onChange={(e) => ctx.set(node.path, Number(e.target.value))}
          />
        </label>
      );
    }
    case 'Rating': {
      const value = Number(getPath(ctx.data, node.path) ?? 0);
      const max = Math.min(Math.max(node.max ?? 5, 1), 10);
      return (
        <div ref={r} className="flex flex-col gap-1.5" role="radiogroup" aria-label={node.label}>
          <span className={fieldLabel}>{node.label}</span>
          <div className="flex gap-1">
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                aria-label={`${n} of ${max}`}
                disabled={ctx.locked}
                onClick={() => ctx.set(node.path, n)}
                className={`border-0 bg-transparent p-0.5 text-[22px] leading-none transition-transform hover:scale-110 disabled:cursor-not-allowed ${
                  n <= value ? 'text-alert' : 'text-line'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'Progress': {
      const max = node.max ?? 100;
      const pct = Math.max(0, Math.min(100, (node.value / max) * 100));
      return (
        <div ref={r} className="flex flex-col gap-1.5">
          {node.label && (
            <span className={`${fieldLabel} flex justify-between`}>
              {node.label}
              <span className="font-mono">{Math.round(pct)}%</span>
            </span>
          )}
          <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={node.value} aria-valuemax={max}>
            <div className="h-full rounded-full bg-store" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
