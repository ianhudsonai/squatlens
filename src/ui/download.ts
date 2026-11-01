/** Saves `data` as a JSON file via a temporary object URL. Nothing leaves the device. */
export function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers read the blob after click() returns; revoking at once can cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** File name without its extension, for naming exports after the source video. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'squatlens';
}
