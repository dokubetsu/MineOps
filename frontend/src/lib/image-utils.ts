/**
 * Image helpers: compress before upload, save capture to device gallery/downloads.
 * Browsers cannot write to the Camera roll silently; we use Share (when available)
 * then fall back to a download of the image (often lands in Gallery/Downloads on mobile).
 */

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.78

export async function compressImageFile(
  file: File,
  opts?: { maxEdge?: number; quality?: number }
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // Skip tiny files
  if (file.size < 180_000) return file

  const maxEdge = opts?.maxEdge ?? MAX_EDGE
  const quality = opts?.quality ?? JPEG_QUALITY

  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    width = Math.round(width * scale)
    height = Math.round(height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    )
    if (!blob || blob.size >= file.size) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

/** Best-effort save of a just-captured photo to the device (gallery/downloads). */
export async function saveCaptureToDevice(file: File, filename?: string): Promise<'shared' | 'downloaded' | 'skipped'> {
  const name = filename || file.name || `khani-${Date.now()}.jpg`
  const toShare =
    file.type && file.name
      ? file
      : new File([file], name, { type: file.type || 'image/jpeg' })

  try {
    if (typeof navigator !== 'undefined' && navigator.canShare) {
      const data: ShareData = { files: [toShare], title: name }
      if (navigator.canShare(data)) {
        await navigator.share(data)
        return 'shared'
      }
    }
  } catch {
    // user cancelled share — still try download
  }

  try {
    const url = URL.createObjectURL(toShare)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // delay revoke so mobile Safari can finish
    setTimeout(() => URL.revokeObjectURL(url), 2500)
    return 'downloaded'
  } catch {
    return 'skipped'
  }
}

/** Process camera/gallery picks: compress + optional save-to-device for capture. */
export async function prepareUploadImages(
  files: File[],
  options?: { saveToGallery?: boolean }
): Promise<File[]> {
  const out: File[] = []
  for (const f of files) {
    const compressed = await compressImageFile(f)
    if (options?.saveToGallery) {
      void saveCaptureToDevice(compressed)
    }
    out.push(compressed)
  }
  return out
}

/** In-memory signed URL cache (path → { url, exp }) to speed list reloads */
const signedCache = new Map<string, { url: string; exp: number }>()

export function getCachedSignedUrl(key: string): string | null {
  const hit = signedCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.exp) {
    signedCache.delete(key)
    return null
  }
  return hit.url
}

export function setCachedSignedUrl(key: string, url: string, ttlMs = 50 * 60 * 1000): void {
  signedCache.set(key, { url, exp: Date.now() + ttlMs })
  // Cap size
  if (signedCache.size > 400) {
    const first = signedCache.keys().next().value
    if (first) signedCache.delete(first)
  }
}

export function clearSignedUrlCache(): void {
  signedCache.clear()
}

/** Normalize a storage path that may include the bucket prefix. */
export function normalizeStoragePath(path: string, bucket: string): string {
  if (path.includes(`${bucket}/`)) {
    return path.split(`${bucket}/`).pop() || path
  }
  return path
}

/**
 * Batch-sign storage paths (uses createSignedUrls). Results are cached per path.
 * Returns map of normalized path → signed URL.
 */
export async function signStoragePaths(
  supabase: { storage: { from: (bucket: string) => { createSignedUrls: (paths: string[], expiresIn: number) => Promise<{ data: Array<{ path: string | null; signedUrl: string | null; error: string | null }> | null; error: Error | null }> } } },
  bucket: string,
  rawPaths: string[],
  ttlSec = 3600
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const toSign: string[] = []
  const normalizedList: string[] = []

  for (const raw of rawPaths) {
    if (!raw) continue
    const path = normalizeStoragePath(raw, bucket)
    const cacheKey = `${bucket}:${path}`
    const cached = getCachedSignedUrl(cacheKey)
    if (cached) {
      result.set(path, cached)
    } else if (!normalizedList.includes(path)) {
      normalizedList.push(path)
      toSign.push(path)
    }
  }

  const CHUNK = 20
  for (let i = 0; i < toSign.length; i += CHUNK) {
    const chunk = toSign.slice(i, i + CHUNK)
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, ttlSec)
    if (error || !data) continue
    for (let j = 0; j < chunk.length; j++) {
      const url = data[j]?.signedUrl
      if (url) {
        const path = chunk[j]
        setCachedSignedUrl(`${bucket}:${path}`, url)
        result.set(path, url)
      }
    }
  }

  return result
}
