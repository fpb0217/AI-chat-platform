export class SseDataParser {
  private buffer = "";
  private dataLines: string[] = [];
  private isFirstLine = true;

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];
    let newlineIndex = this.buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      this.processLine(line, events);
      newlineIndex = this.buffer.indexOf("\n");
    }

    return events;
  }

  end(): string[] {
    const events: string[] = [];
    if (this.buffer.length > 0) {
      const line = this.buffer.endsWith("\r")
        ? this.buffer.slice(0, -1)
        : this.buffer;
      this.processLine(line, events);
      this.buffer = "";
    }
    this.dispatch(events);
    return events;
  }

  private processLine(rawLine: string, events: string[]): void {
    let line = rawLine;
    if (this.isFirstLine) {
      line = line.replace(/^\uFEFF/, "");
      this.isFirstLine = false;
    }

    if (line === "") {
      this.dispatch(events);
      return;
    }

    if (line.startsWith(":")) {
      return;
    }

    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "data") {
      this.dataLines.push(value);
    }
  }

  private dispatch(events: string[]): void {
    if (this.dataLines.length === 0) {
      return;
    }
    events.push(this.dataLines.join("\n"));
    this.dataLines = [];
  }
}

