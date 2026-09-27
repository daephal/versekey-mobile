# VerseKey Mobile

Apple Music 곡 공유 링크를 붙여넣으면 곡 정보를 확인하고, LRCLIB에서 가사를 찾아 Gemini로 번역하는 개인용 모바일 웹앱입니다.

기존 macOS VerseKey와 별도 프로젝트이며 서로의 파일이나 설정을 변경하지 않습니다.

## 아이폰·아이패드에서 사용

1. 웹페이지 오른쪽 위 설정에서 Gemini API 키를 저장합니다.
2. Apple Music에서 곡의 `공유 → 링크 복사`를 선택합니다.
3. VerseKey Mobile을 열고 `링크 붙여넣기`를 누릅니다.
4. 자주 사용한다면 Safari의 `공유 → 홈 화면에 추가`를 선택합니다.

API 키와 번역 결과는 해당 브라우저의 로컬 저장소에만 저장됩니다. 가사 번역 요청 시 가사 원문은 Google Gemini API로 전송됩니다.

## 공유 단축어 만들기

앱 설치 없이 Apple Music 공유 메뉴에서 바로 웹페이지를 열 수 있습니다.

1. 단축어 앱에서 새 단축어를 만들고 이름을 `VerseKey로 열기`로 정합니다.
2. 단축어 세부사항에서 `공유 시트에 표시`를 켜고 입력 형식을 `URL`로 제한합니다.
3. `URL` 동작을 추가하고 아래 주소 뒤에 `단축어 입력` 변수를 붙입니다.

   ```text
   https://daephal.github.io/versekey-mobile/?url=[단축어 입력]
   ```

4. `URL 열기` 동작을 마지막에 추가합니다.

이후 Apple Music의 공유 메뉴에서 `VerseKey로 열기`를 선택하면 곡이 자동으로 열립니다.

## 개인정보와 제한

- GitHub Pages에 Gemini API 키를 포함하지 않습니다.
- Apple Music의 가사 원문을 직접 가져오지 않습니다.
- LRCLIB에 곡이 없으면 가사를 직접 붙여넣을 수 있습니다.
- Safari 데이터를 삭제하면 저장된 키와 번역 결과도 삭제됩니다.
- 웹페이지는 Apple Music의 현재 재생 위치를 읽거나 조작하지 않습니다.

## 테스트

```bash
npm test
```
