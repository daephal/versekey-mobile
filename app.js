import {
  formatDuration,
  lyricsRecordToLines,
  parseAppleMusicId,
  scoreLyricsCandidate,
} from "./core.js";

const LRCLIB_BASE = "https://lrclib.net/api";
const SETTINGS_KEY = "versekey.mobile.settings.v1";
const SONG_PREFIX = "versekey.mobile.song.v1.";
const LANGUAGE_NAMES = {
  ko: "한국어", en: "English", ja: "日本語", zh: "中文",
  es: "Español", fr: "Français", de: "Deutsch", pt: "Português",
};

const elements = Object.fromEntries([
  "link-card", "link-form", "apple-link", "paste-link", "status-card", "status-title", "status-message",
  "song-view", "artwork", "track-title", "artist-name", "album-name", "duration", "apple-music-link",
  "candidate-panel", "candidate-list", "candidate-summary", "candidate-paste-button", "lyrics-list", "lyrics-empty", "original-toggle", "retranslate-button",
  "translation-progress", "progress-label", "progress-count", "progress-bar", "meaning-card", "song-summary",
  "notes-list", "new-song-button", "settings-button", "settings-dialog", "settings-form", "gemini-key",
  "target-language", "gemini-model", "open-paste-button", "paste-dialog", "paste-form", "manual-lyrics",
  "guide-button", "guide-dialog",
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

const state = {
  metadata: null,
  lyrics: null,
  candidates: [],
  translations: [],
  settings: loadSettings(),
  requestVersion: 0,
  hideOriginal: false,
};

function loadSettings() {
  try {
    return {
      apiKey: "",
      targetLanguage: "ko",
      model: "gemini-3.6-flash",
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return { apiKey: "", targetLanguage: "ko", model: "gemini-3.6-flash" };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function songCacheKey(trackId) {
  return `${SONG_PREFIX}${trackId}`;
}

function readSongCache(trackId) {
  try {
    return JSON.parse(localStorage.getItem(songCacheKey(trackId)) || "null");
  } catch {
    return null;
  }
}

function writeSongCache() {
  if (!state.metadata?.trackId) return;
  const previous = readSongCache(state.metadata.trackId) || {};
  const translations = { ...(previous.translations || {}) };
  if (state.translations.some(Boolean)) {
    translations[state.settings.targetLanguage] = {
      lines: state.translations,
      summary: elements.song_summary.textContent || "",
      notes: [...elements.notes_list.querySelectorAll(".note-item")].map((item) => ({
        expression: item.querySelector("strong")?.textContent || "",
        explanation: item.querySelector("p")?.textContent || "",
      })),
      savedAt: Date.now(),
    };
  }
  try {
    localStorage.setItem(songCacheKey(state.metadata.trackId), JSON.stringify({
      metadata: state.metadata,
      lyrics: state.lyrics,
      candidates: state.candidates,
      translations,
      savedAt: Date.now(),
    }));
  } catch {
    // Safari private mode or full storage should not prevent the current result from being shown.
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function showStatus(title, message, { error = false } = {}) {
  elements.status_card.hidden = false;
  elements.status_card.classList.toggle("is-error", error);
  elements.status_title.textContent = title;
  elements.status_message.textContent = message;
}

function hideStatus() {
  elements.status_card.hidden = true;
}

function setProgress(percent, label = "한국어로 번역 중") {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  elements.translation_progress.hidden = false;
  elements.progress_label.textContent = label;
  elements.progress_count.textContent = `${value}%`;
  elements.progress_bar.style.width = `${value}%`;
}

function hideProgress() {
  elements.translation_progress.hidden = true;
}

function resetView() {
  state.requestVersion += 1;
  state.metadata = null;
  state.lyrics = null;
  state.candidates = [];
  state.translations = [];
  elements.song_view.hidden = true;
  elements.link_card.hidden = false;
  elements.apple_link.value = "";
  elements.lyrics_list.innerHTML = "";
  elements.meaning_card.hidden = true;
  elements.candidate_panel.hidden = true;
  hideStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function resolveAppleMusicLink(link) {
  const id = parseAppleMusicId(link);
  if (!id) throw new Error("Apple Music의 곡 공유 링크를 붙여넣어 주세요.");
  const response = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=kr&entity=song`);
  if (!response.ok) throw new Error("Apple에서 곡 정보를 가져오지 못했습니다.");
  const payload = await response.json();
  const item = payload.results?.find((result) => String(result.trackId) === String(id))
    || payload.results?.find((result) => result.wrapperType === "track");
  if (!item) throw new Error("공유 링크에서 곡 정보를 찾지 못했습니다.");
  return {
    track: item.trackName || "",
    artist: item.artistName || "",
    album: item.collectionName || "",
    duration: Number(item.trackTimeMillis || 0) / 1000,
    artwork: item.artworkUrl100?.replace(/100x100bb/, "600x600bb") || "",
    appleMusicUrl: item.trackViewUrl || link,
    trackId: String(item.trackId || id),
  };
}

function renderSong() {
  const item = state.metadata;
  elements.artwork.src = item.artwork;
  elements.artwork.alt = `${item.album || item.track} 앨범 표지`;
  elements.track_title.textContent = item.track;
  elements.artist_name.textContent = item.artist;
  elements.album_name.textContent = item.album;
  elements.duration.textContent = formatDuration(item.duration);
  elements.apple_music_link.href = item.appleMusicUrl;
  elements.link_card.hidden = true;
  elements.song_view.hidden = false;
}

function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value));
  });
  return params.toString();
}

async function lrclib(path) {
  const response = await fetch(`${LRCLIB_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`가사 검색 서비스가 응답하지 않습니다 (${response.status}).`);
  return response.json();
}

function normalizeRecord(record) {
  return {
    id: record.id,
    trackName: record.trackName || record.name || "",
    artistName: record.artistName || "",
    albumName: record.albumName || "",
    duration: Number(record.duration || 0),
    synced: Boolean(record.syncedLyrics),
    lines: lyricsRecordToLines(record),
  };
}

async function findLyrics(metadata) {
  const exactQuery = queryString({
    track_name: metadata.track,
    artist_name: metadata.artist,
    album_name: metadata.album,
    duration: metadata.duration ? Math.round(metadata.duration) : undefined,
  });
  const searchQuery = queryString({ track_name: metadata.track, artist_name: metadata.artist });
  const [exact, searched] = await Promise.all([
    lrclib(`/get?${exactQuery}`).catch(() => null),
    lrclib(`/search?${searchQuery}`).catch(() => []),
  ]);
  const records = [...(exact ? [exact] : []), ...(Array.isArray(searched) ? searched : [])];
  const unique = [...new Map(records.map((record) => [record.id, record])).values()]
    .filter((record) => record.plainLyrics || record.syncedLyrics)
    .map((record) => ({ record, score: scoreLyricsCandidate(record, metadata) }))
    .sort((left, right) => right.score - left.score);
  return {
    selected: unique[0]?.score >= 45 ? normalizeRecord(unique[0].record) : null,
    candidates: unique.slice(0, 5).map(({ record, score }) => ({
      id: record.id,
      trackName: record.trackName || record.name || "",
      artistName: record.artistName || "",
      albumName: record.albumName || "",
      duration: Number(record.duration || 0),
      score,
    })),
  };
}

async function getLyricsById(id) {
  const record = await lrclib(`/get/${encodeURIComponent(id)}`);
  return record ? normalizeRecord(record) : null;
}

function renderCandidates() {
  const seen = new Set();
  const candidates = state.candidates.filter((candidate) => {
    if (candidate.id === state.lyrics?.id) return false;
    const signature = `${candidate.trackName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}|${candidate.artistName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}|${Math.round(candidate.duration || 0)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  elements.candidate_panel.hidden = !candidates.length;
  elements.candidate_panel.open = false;
  elements.candidate_summary.textContent = `다른 가사 후보 ${candidates.length}개`;
  elements.candidate_list.innerHTML = candidates.map((candidate) => `
    <button class="candidate-button" type="button" data-id="${escapeHtml(candidate.id)}">
      <span>${escapeHtml(candidate.trackName)} · ${escapeHtml(candidate.artistName)}</span>
      <small>${formatDuration(candidate.duration)}</small>
    </button>
  `).join("");
}

function renderLyrics() {
  if (!state.lyrics?.lines?.length) {
    elements.lyrics_list.hidden = true;
    elements.lyrics_empty.hidden = false;
    return;
  }
  elements.lyrics_empty.hidden = true;
  elements.lyrics_list.hidden = false;
  elements.lyrics_list.classList.toggle("hide-original", state.hideOriginal);
  elements.original_toggle.textContent = state.hideOriginal ? "원문 보기" : "원문 숨기기";
  elements.lyrics_list.innerHTML = state.lyrics.lines.map((line, index) => {
    if (!line.text) return '<div class="lyric-line is-blank" aria-hidden="true"></div>';
    const translation = state.translations[index];
    return `<article class="lyric-line" data-index="${index}">
      <p class="lyric-original">${escapeHtml(line.text)}</p>
      <p class="lyric-translation${translation ? "" : " pending-translation"}">${escapeHtml(translation || "번역 준비 중…")}</p>
    </article>`;
  }).join("");
}

function renderMeaning(summary = "", notes = []) {
  elements.song_summary.textContent = summary;
  elements.notes_list.innerHTML = notes.map((note) => `
    <article class="note-item"><strong>${escapeHtml(note.expression)}</strong><p>${escapeHtml(note.explanation)}</p></article>
  `).join("");
  elements.meaning_card.hidden = !summary && !notes.length;
}

function restoreCachedTranslation(cache) {
  const saved = cache?.translations?.[state.settings.targetLanguage];
  if (!saved?.lines?.length || saved.lines.length !== state.lyrics?.lines?.length) return false;
  state.translations = saved.lines;
  renderLyrics();
  renderMeaning(saved.summary, saved.notes || []);
  return true;
}

function geminiError(payload, status, model) {
  const message = String(payload?.error?.message || "");
  if (status === 400 && /api key/i.test(message)) return "Gemini API 키가 올바르지 않습니다.";
  if (status === 403) return "Gemini API 키 권한 또는 사용 가능 지역을 확인해 주세요.";
  if (status === 404) return `Gemini 모델 '${model}'을 사용할 수 없습니다.`;
  if (status === 429 || /quota|rate limit/i.test(message)) return "Gemini 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  return message || `Gemini 요청에 실패했습니다 (${status}).`;
}

async function requestGemini(body, preferredModel, timeoutMs = 90000) {
  const models = [...new Set([preferredModel, "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"])];
  let lastError;
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": state.settings.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { payload, model };
      lastError = new Error(geminiError(payload, response.status, model));
      if (![404, 429, 500, 502, 503].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error.name === "AbortError" ? new Error("번역 요청 시간이 초과되었습니다.") : error;
    }
  }
  throw lastError || new Error("Gemini 서버에 연결하지 못했습니다.");
}

function responseText(payload) {
  return (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
}

function translationBody(items, { preview = false } = {}) {
  const targetName = LANGUAGE_NAMES[state.settings.targetLanguage] || "한국어";
  const schema = preview ? {
    type: "object",
    properties: {
      translations: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, text: { type: "string" } }, required: ["index", "text"] } },
    },
    required: ["translations"],
  } : {
    type: "object",
    properties: {
      translations: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, text: { type: "string" } }, required: ["index", "text"] } },
      notes: { type: "array", items: { type: "object", properties: { expression: { type: "string" }, explanation: { type: "string" } }, required: ["expression", "explanation"] } },
      summary: { type: "string" },
    },
    required: ["translations", "notes", "summary"],
  };
  return {
    systemInstruction: { parts: [{ text: `You are a senior literary translator specializing in contemporary song lyrics, hip-hop, R&B, pop, slang, and cultural context. Translate naturally into ${targetName}. Preserve speaker, addressee, emotion, profanity, wordplay, and recurring-hook consistency. Never invent unsupported meaning. Return JSON only.` }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({
      task: preview ? `Quickly translate these opening lines into natural ${targetName}.` : `Understand the whole song, then translate every line into natural ${targetName}.`,
      artist: state.metadata.artist,
      track: state.metadata.track,
      targetLanguage: targetName,
      requirements: [
        "Return every input index exactly once.",
        "Do not merge or split lines.",
        "Translate slang and idioms by intended meaning, not literally.",
        "Keep names and necessary proper nouns intact.",
        ...(preview ? [] : [`Write a concise ${targetName} song summary and at most 8 essential expression notes.`]),
      ],
      lyrics: items,
    }) }] }],
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
    generationConfig: {
      temperature: preview ? 0.15 : 0.25,
      maxOutputTokens: Math.min(8192, Math.max(900, items.length * 96 + (preview ? 100 : 600))),
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    },
  };
}

function parseTranslation(payload, expectedIndexes) {
  const text = responseText(payload);
  if (!text) throw new Error("Gemini 번역 응답이 비어 있습니다.");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("Gemini 번역 결과를 읽지 못했습니다."); }
  const found = new Map();
  for (const item of parsed.translations || []) {
    if (Number.isInteger(Number(item.index))) found.set(Number(item.index), String(item.text || ""));
  }
  if (expectedIndexes.some((index) => !found.has(index))) throw new Error("번역 결과에서 일부 가사가 누락되었습니다.");
  return { parsed, found };
}

async function translateCurrent({ force = false } = {}) {
  if (!state.lyrics?.lines?.length) return;
  if (!state.settings.apiKey) {
    showStatus("번역 설정이 필요해요", "오른쪽 위 설정에서 Gemini API 키를 한 번 입력해 주세요.", { error: true });
    elements.settings_dialog.showModal();
    return;
  }
  const cache = readSongCache(state.metadata.trackId);
  if (!force && restoreCachedTranslation(cache)) {
    hideStatus();
    return;
  }
  const version = ++state.requestVersion;
  const items = state.lyrics.lines
    .map((line, index) => ({ sourceIndex: index, text: line.text }))
    .filter((item) => item.text)
    .map((item, index) => ({ index, sourceIndex: item.sourceIndex, text: item.text }));
  if (!items.length) return;
  state.translations = Array.from({ length: state.lyrics.lines.length }, () => "");
  renderLyrics();
  setProgress(8, `${LANGUAGE_NAMES[state.settings.targetLanguage] || "선택한 언어"}로 번역 준비 중`);
  showStatus("가사 뜻을 파악하고 있어요", "첫 부분을 먼저 보여드리고 전체 문맥 번역으로 교체합니다.");

  const compact = items.map(({ index, text }) => ({ index, text }));
  const previewItems = compact.slice(0, Math.min(12, compact.length));
  const previewPromise = previewItems.length < compact.length
    ? requestGemini(translationBody(previewItems, { preview: true }), state.settings.model, 20000)
        .then(({ payload }) => parseTranslation(payload, previewItems.map((item) => item.index)))
        .then(({ found }) => {
          if (version !== state.requestVersion) return;
          previewItems.forEach((item) => { state.translations[items[item.index].sourceIndex] = found.get(item.index); });
          renderLyrics();
          setProgress(28, "첫 부분 번역 완료 · 전체 가사 번역 중");
        })
        .catch(() => {})
    : Promise.resolve();

  try {
    const fullPromise = requestGemini(translationBody(compact), state.settings.model, 100000);
    await Promise.race([previewPromise, fullPromise.then(() => undefined)]);
    const { payload, model } = await fullPromise;
    if (version !== state.requestVersion) return;
    setProgress(82, "문맥과 표현을 다듬는 중");
    const { parsed, found } = parseTranslation(payload, compact.map((item) => item.index));
    compact.forEach((item) => { state.translations[items[item.index].sourceIndex] = found.get(item.index); });
    state.settings.model = model;
    saveSettings();
    renderLyrics();
    renderMeaning(String(parsed.summary || ""), Array.isArray(parsed.notes) ? parsed.notes.slice(0, 8) : []);
    setProgress(100, "번역 완료");
    writeSongCache();
    hideStatus();
    setTimeout(() => { if (version === state.requestVersion) hideProgress(); }, 650);
  } catch (error) {
    if (version !== state.requestVersion) return;
    hideProgress();
    showStatus("번역을 완료하지 못했어요", error.message || "잠시 후 다시 시도해 주세요.", { error: true });
  }
}

async function applyLyrics(lyrics, candidates, { useCache = true } = {}) {
  state.lyrics = lyrics;
  state.candidates = candidates || [];
  state.translations = Array.from({ length: lyrics?.lines?.length || 0 }, () => "");
  renderCandidates();
  renderLyrics();
  if (!lyrics) return;
  const cache = readSongCache(state.metadata.trackId);
  if (useCache && restoreCachedTranslation(cache)) {
    hideStatus();
    return;
  }
  await translateCurrent();
}

async function loadSong(link) {
  const version = ++state.requestVersion;
  showStatus("곡 정보를 불러오는 중", "Apple Music 공유 링크를 확인하고 있습니다.");
  try {
    const metadata = await resolveAppleMusicLink(link);
    if (version !== state.requestVersion) return;
    state.metadata = metadata;
    renderSong();
    const cached = readSongCache(metadata.trackId);
    if (cached?.lyrics?.lines?.length) {
      await applyLyrics(cached.lyrics, cached.candidates || [], { useCache: true });
      return;
    }
    showStatus("가사를 찾는 중", `${metadata.track}의 가사 후보를 비교하고 있습니다.`);
    const result = await findLyrics(metadata);
    if (version !== state.requestVersion) return;
    await applyLyrics(result.selected, result.candidates);
    if (!result.selected) {
      hideStatus();
      writeSongCache();
    }
  } catch (error) {
    if (version !== state.requestVersion) return;
    showStatus("링크를 불러오지 못했어요", error.message || "Apple Music 링크를 다시 확인해 주세요.", { error: true });
  }
}

elements.link_form.addEventListener("submit", (event) => {
  event.preventDefault();
  const link = elements.apple_link.value.trim();
  if (link) loadSong(link);
});

elements.paste_link.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    elements.apple_link.value = text.trim();
    if (parseAppleMusicId(text)) loadSong(text);
    else showStatus("Apple Music 링크가 아니에요", "음악 앱에서 곡의 공유 링크를 복사한 뒤 다시 눌러 주세요.", { error: true });
  } catch {
    elements.apple_link.focus();
    showStatus("링크 입력 칸을 길게 눌러 주세요", "Safari가 클립보드 읽기를 허용하지 않으면 직접 ‘붙여넣기’를 선택할 수 있습니다.");
  }
});

elements.candidate_list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const version = ++state.requestVersion;
  showStatus("선택한 가사를 불러오는 중", "잠시만 기다려 주세요.");
  try {
    const lyrics = await getLyricsById(button.dataset.id);
    if (version !== state.requestVersion) return;
    await applyLyrics(lyrics, state.candidates, { useCache: false });
  } catch (error) {
    showStatus("가사를 불러오지 못했어요", error.message, { error: true });
  }
});

elements.original_toggle.addEventListener("click", () => {
  state.hideOriginal = !state.hideOriginal;
  renderLyrics();
});
elements.retranslate_button.addEventListener("click", () => translateCurrent({ force: true }));
elements.new_song_button.addEventListener("click", resetView);
elements.settings_button.addEventListener("click", () => elements.settings_dialog.showModal());
elements.open_paste_button.addEventListener("click", () => elements.paste_dialog.showModal());
elements.candidate_paste_button.addEventListener("click", () => elements.paste_dialog.showModal());
elements.guide_button.addEventListener("click", () => elements.guide_dialog.showModal());
elements.guide_dialog.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-guide]")) elements.guide_dialog.close();
});

elements.settings_form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.settings_dialog.close();
    return;
  }
  state.settings = {
    apiKey: elements.gemini_key.value.trim(),
    targetLanguage: elements.target_language.value,
    model: elements.gemini_model.value.trim() || "gemini-3.6-flash",
  };
  saveSettings();
  elements.settings_dialog.close();
  if (state.lyrics) translateCurrent({ force: false });
});

elements.paste_form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.paste_dialog.close();
    return;
  }
  const source = elements.manual_lyrics.value.trim();
  if (!source || !state.metadata) return;
  const record = /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(source)
    ? { syncedLyrics: source, plainLyrics: "" }
    : { plainLyrics: source, syncedLyrics: "" };
  const lyrics = {
    id: `custom-${state.metadata.trackId}`,
    trackName: state.metadata.track,
    artistName: state.metadata.artist,
    albumName: state.metadata.album,
    duration: state.metadata.duration,
    synced: Boolean(record.syncedLyrics),
    lines: lyricsRecordToLines(record),
    custom: true,
  };
  elements.paste_dialog.close();
  applyLyrics(lyrics, state.candidates, { useCache: false });
  writeSongCache();
});

function initialize() {
  elements.gemini_key.value = state.settings.apiKey;
  elements.target_language.value = state.settings.targetLanguage;
  elements.gemini_model.value = state.settings.model;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  const sharedLink = new URLSearchParams(location.search).get("url");
  if (sharedLink && parseAppleMusicId(sharedLink)) {
    elements.apple_link.value = sharedLink;
    loadSong(sharedLink);
  } else if (!state.settings.apiKey) {
    setTimeout(() => elements.settings_dialog.showModal(), 350);
  }
}

initialize();
