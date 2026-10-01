const DEFAULT_NAME = "My data";

function stripCsvExtension(name: string): string {
  return name.replace(/\.csv$/i, "").trim();
}

/** The source name for a dropped file: its filename without the `.csv` extension. */
export function sourceNameFromFile(file: File): string {
  return stripCsvExtension(file.name) || DEFAULT_NAME;
}

/** The source name for a pasted link: the last path segment without `.csv`, else the hostname. */
export function sourceNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return stripCsvExtension(decodeURIComponent(last)) || parsed.hostname || DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

export function looksLikeCsv(file: File): boolean {
  return /\.csv$/i.test(file.name) || file.type === "text/csv";
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
