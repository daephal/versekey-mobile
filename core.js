export function parseAppleMusicId(input) {
  try {
    const url = new URL(String(input).trim());
    if (!/(^|\.)music\.apple\.com$/i.test(url.hostname)) return null;
    const queryId = url.searchParams.get("i");
    if (queryId && /^\d+$/.test(queryId)) return queryId;
    const songMatch = url.pathname.match(/\/song\/[^/]*\/(\d+)(?:\/|$)/i)
      || url.pathname.match(/\/song\/(\d+)(?:\/|$)/i);
    if (songMatch) return songMatch[1];
    const pathIds = [...url.pathname.matchAll(/\/(\d{6,})(?:\/|$)/g)];
    return pathIds.at(-1)?.[1] || null;
  } catch {
    return null;
  }
}

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\([^)]*(feat\.?|ft\.?|featuring|remaster(?:ed)?|version|edit|mix)[^)]*\)/gi, " ")
    .replace(/\[[^\]]*(feat\.?|ft\.?|featuring|remaster(?:ed)?|version|edit|mix)[^\]]*\]/gi, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSimilarity(leftValue, rightValue) {
  const left = new Set(normalizeText(leftValue).split(" ").filter(Boolean));
  const right = new Set(normalizeText(rightValue).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

export function scoreLyricsCandidate(candidate, target) {
  const title = candidate.trackName || candidate.name || "";
  const titleExact = normalizeText(title) === normalizeText(target.track);
  const artistExact = normalizeText(candidate.artistName) === normalizeText(target.artist);
  const albumExact = normalizeText(candidate.albumName) === normalizeText(target.album);
  let score = titleExact ? 52 : tokenSimilarity(title, target.track) * 42;
  score += artistExact ? 28 : tokenSimilarity(candidate.artistName, target.artist) * 22;
  score += albumExact ? 8 : tokenSimilarity(candidate.albumName, target.album) * 5;
  const wantedDuration = Number(target.duration);
  const foundDuration = Number(candidate.duration);
  if (wantedDuration > 0 && foundDuration > 0) {
    const delta = Math.abs(wantedDuration - foundDuration);
    if (delta <= 2) score += 15;
    else if (delta <= 5) score += 9;
    else if (delta <= 12) score += 3;
    else score -= Math.min(22, delta / 4);
  }
  if (candidate.syncedLyrics) score += 2;
  return Math.round(score * 10) / 10;
}

export function parseSyncedLyrics(value = "") {
  const rows = [];
  for (const rawLine of String(value).split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    for (const match of matches) {
      rows.push({
        time: Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(`0.${match[3]}`) : 0),
        text,
      });
    }
  }
  return rows.sort((a, b) => a.time - b.time);
}

export function lyricsRecordToLines(record = {}) {
  const synced = parseSyncedLyrics(record.syncedLyrics);
  if (synced.length) return synced;
  return String(record.plainLyrics || "")
    .split(/\r?\n/)
    .map((text) => ({ time: null, text: text.trimEnd() }))
    .filter((line, index, lines) => line.text || (index > 0 && lines[index - 1]?.text));
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function buildSharedPageUrl(pageUrl, appleMusicUrl) {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("url", appleMusicUrl);
  return url.toString();
}
