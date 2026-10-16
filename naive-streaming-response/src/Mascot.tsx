/**
 * Pip, Basic GPT's mascot: a soft clay squircle with a sprout. Idles with a
 * slow bob and blink, glances around while thinking, bounces while streaming.
 */
export type MascotMood = 'idle' | 'thinking' | 'streaming';

export function Mascot({ size = 32, mood = 'idle' }: { size?: number; mood?: MascotMood }) {
  return (
    <svg
      className={`mascot mascot--${mood}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Pip, the Basic GPT mascot"
    >
      <g className="mascot__body">
        {/* sprout */}
        <path d="M32 14 C32 10 32 8 32 6" stroke="var(--sprout)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        <path className="mascot__leaf" d="M32 8 C26 3 21 6 22 9 C25 11 29 10 32 8Z" fill="var(--sprout)" />
        <path className="mascot__leaf mascot__leaf--r" d="M32 9 C37 3 43 5 42 9 C39 12 35 11 32 9Z" fill="var(--sprout)" />
        {/* body */}
        <rect x="8" y="14" width="48" height="42" rx="19" fill="var(--clay)" />
        <rect x="8" y="14" width="48" height="42" rx="19" fill="url(#mascot-sheen)" />
        {/* face */}
        <g className="mascot__eyes">
          <ellipse className="mascot__eye" cx="24" cy="33" rx="3.6" ry="4.6" fill="var(--ink)" />
          <ellipse className="mascot__eye" cx="40" cy="33" rx="3.6" ry="4.6" fill="var(--ink)" />
          <circle cx="25.3" cy="31.3" r="1.2" fill="#fff" opacity=".85" />
          <circle cx="41.3" cy="31.3" r="1.2" fill="#fff" opacity=".85" />
        </g>
        <ellipse cx="17.5" cy="40.5" rx="4" ry="2.4" fill="var(--blush)" />
        <ellipse cx="46.5" cy="40.5" rx="4" ry="2.4" fill="var(--blush)" />
        <path className="mascot__mouth" d="M28.5 41 Q32 44.5 35.5 41" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      <defs>
        <radialGradient id="mascot-sheen" cx="30%" cy="25%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
