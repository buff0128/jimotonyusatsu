/** cases.attachments（JSON: [{name, uri}]）を読む */
export function parseAttachments(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a?.uri === 'string') : [];
  } catch {
    return [];
  }
}
