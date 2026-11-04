/**
 * Incremental Server-Sent Events parser. Feed it decoded text chunks as they
 * arrive; it returns the `data:` payload of every complete event in the order
 * received. Multiple events inside one chunk come back as multiple payloads,
 * never merged. Handles CRLF, multi-line data and comment lines.
 */
export class SseParser {
  private buffer = '';
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r?\n/)) !== -1) {
      const line = this.buffer.slice(0, newline);
      const width = this.buffer[newline] === '\r' ? 2 : 1;
      this.buffer = this.buffer.slice(newline + width);
      if (line === '') {
        if (this.data.length) out.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /, ''));
      }
      // Other fields (event:, id:, retry:) and comments (:) are ignored.
    }
    return out;
  }

  /** Flush a final event that wasn't followed by a blank line. */
  end(): string[] {
    const tail = this.buffer ? this.push('\n\n') : [];
    const out = [...tail, ...(this.data.length ? [this.data.join('\n')] : [])];
    this.data = [];
    this.buffer = '';
    return out;
  }
}
