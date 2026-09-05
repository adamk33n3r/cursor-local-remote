/** Catalog slug, or an id with effort encoded as id[effort=…]. */
export const MODEL_ID_PATTERN = /^[a-zA-Z0-9._/-]+(?:\[effort=[a-zA-Z0-9._-]+\])?$/;

export function isValidModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value);
}
