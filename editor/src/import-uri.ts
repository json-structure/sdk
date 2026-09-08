/** Returns whether a value is a portable absolute or relative URI reference. */
export function isImportUriReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;
  if (/[\u0000-\u0020<>"{}|\\^`]/.test(value) || /%(?![0-9A-Fa-f]{2})/.test(value) || /^[A-Za-z]:/.test(value)) return false;
  try {
    new URL(value, 'https://json-structure.invalid/document.struct.json');
    return true;
  } catch {
    return false;
  }
}
