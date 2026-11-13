/** Save a blob as a file (same pattern as the JSON/CSV exports). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** File-name friendly version of a free text (umlauts kept, rest → "_"). */
export function fileSlug(text: string): string {
  return (text || 'projekt').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'projekt'
}
