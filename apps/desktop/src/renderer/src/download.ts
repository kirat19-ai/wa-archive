/** Trigger a browser download of in-memory content (works in web and Electron). */
export function downloadText(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  triggerDownload(filename, URL.createObjectURL(blob));
}

export function downloadBase64(filename: string, mimeType: string, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  triggerDownload(filename, URL.createObjectURL(blob));
}

function triggerDownload(filename: string, url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
