import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSharedPageUrl,
  lyricsRecordToLines,
  parseAppleMusicId,
  scoreLyricsCandidate,
} from "../core.js";

test("Apple Music album links resolve the song query id", () => {
  assert.equal(
    parseAppleMusicId("https://music.apple.com/kr/album/poetic-justice/1440873524?i=1440873541"),
    "1440873541",
  );
});

test("non Apple Music links are rejected", () => {
  assert.equal(parseAppleMusicId("https://example.com/song/1440873541"), null);
});

test("candidate scoring favors matching title, artist, and duration", () => {
  const target = { track: "Poetic Justice (feat. Drake)", artist: "Kendrick Lamar", album: "good kid", duration: 300 };
  const exact = scoreLyricsCandidate({ trackName: "Poetic Justice", artistName: "Kendrick Lamar", albumName: "good kid", duration: 301 }, target);
  const wrong = scoreLyricsCandidate({ trackName: "Justice", artistName: "Someone Else", albumName: "Other", duration: 220 }, target);
  assert.ok(exact > wrong);
  assert.ok(exact >= 90);
});

test("LRC lines keep timestamps and plain lyrics keep blank sections", () => {
  assert.deepEqual(lyricsRecordToLines({ syncedLyrics: "[00:01.00]First\n[00:03.50]Second" }), [
    { time: 1, text: "First" },
    { time: 3.5, text: "Second" },
  ]);
  assert.equal(lyricsRecordToLines({ plainLyrics: "First\n\nSecond" }).length, 3);
});

test("share URL stores the Apple Music link as a query parameter", () => {
  const result = buildSharedPageUrl("https://daephal.github.io/versekey-mobile/", "https://music.apple.com/kr/song/example/123456789");
  assert.equal(new URL(result).searchParams.get("url"), "https://music.apple.com/kr/song/example/123456789");
});
