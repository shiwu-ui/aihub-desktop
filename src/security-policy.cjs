'use strict'

const API_ORIGIN = 'https://aihub.top'
const API_BASE_PATH = '/api/v1'
const API_BASE = `${API_ORIGIN}${API_BASE_PATH}`

function fullyDecodePathSegment(segment) {
  let decoded = segment
  for (let pass = 0; pass < 8; pass += 1) {
    let next
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next === decoded) return decoded
    decoded = next
  }
  try {
    return decodeURIComponent(decoded) === decoded ? decoded : null
  } catch {
    return null
  }
}

function normalizeAllowedApiRoute(route, allowedRoutePrefixes) {
  if (!Array.isArray(allowedRoutePrefixes)) return null
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return null
  if (route.includes('#') || /[\u0000-\u001f\u007f]/.test(route)) return null

  const queryIndex = route.indexOf('?')
  const rawPath = queryIndex === -1 ? route : route.slice(0, queryIndex)
  const rawSearch = queryIndex === -1 ? '' : route.slice(queryIndex)
  if (rawPath.includes('\\')) return null

  const decodedSegments = []
  const encodedSegments = []
  for (const rawSegment of rawPath.slice(1).split('/')) {
    const decoded = fullyDecodePathSegment(rawSegment)
    if (decoded === null || decoded === '.' || decoded === '..') return null
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('#') || decoded.includes('?')) return null
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return null
    if (decoded.toLowerCase() === 'admin') return null
    decodedSegments.push(decoded)
    encodedSegments.push(encodeURIComponent(decoded))
  }

  const decodedPath = `/${decodedSegments.join('/')}`
  const allowed = allowedRoutePrefixes.some(
    (prefix) => decodedPath === prefix || decodedPath.startsWith(`${prefix}/`),
  )
  if (!allowed) return null

  const normalizedPath = `/${encodedSegments.join('/')}`
  let target
  try {
    target = new URL(`.${normalizedPath}${rawSearch}`, `${API_BASE}/`)
  } catch {
    return null
  }
  if (target.origin !== API_ORIGIN || target.pathname !== `${API_BASE_PATH}${normalizedPath}`) return null
  return `${normalizedPath}${target.search}`
}

function classifyExternalUrl(value) {
  if (typeof value !== 'string' || !value) return { action: 'reject' }
  let target
  try {
    target = new URL(value)
  } catch {
    return { action: 'reject' }
  }
  if (target.protocol !== 'https:' || target.username || target.password) return { action: 'reject' }
  return {
    action: target.origin === API_ORIGIN ? 'open' : 'confirm',
    url: target.href,
  }
}

module.exports = { API_BASE, classifyExternalUrl, normalizeAllowedApiRoute }
