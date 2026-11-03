# Movie-Moa

KOBIS 박스오피스와 TMDB 영화 정보를 한 화면에서 확인하고, 나만의 별점과 감상을 기록하는 반응형 웹 앱입니다.

## 실행 방법 (Windows PowerShell)

1. 프로젝트 폴더에서 가상환경을 활성화합니다.

   ```powershell
   .\venv\Scripts\activate
   ```

2. 필요한 패키지를 설치합니다.

   ```powershell
   pip install -r requirements.txt
   ```

3. 프로젝트 폴더에 `.env` 파일을 만들고 API 키를 입력합니다. 키 값은 GitHub에 올리지 마세요.

   ```text
   KOBIS_KEY=발급받은_KOBIS_키
   TMDB_KEY=발급받은_TMDB_키
   ```

4. 서버를 실행하고 브라우저에서 `http://127.0.0.1:5000`을 엽니다.

   ```powershell
   python app.py
   ```

박스오피스 API는 `/api/boxoffice?date=YYYYMMDD`, 영화 상세 정보는 `/api/movie/<KOBIS영화코드>`에서 제공합니다. 별점과 감상은 SQLite 데이터베이스(`instance/movie_moa.sqlite3`)에 저장되며, 브라우저별 익명 식별자로 기록을 구분합니다. 브라우저가 보관하던 기존 기록이 있으면 첫 실행 때 DB로 복사하고 원본은 유지합니다.

감상 기록 API는 다음과 같습니다.

- `GET /api/reviews`: 현재 브라우저의 기록 조회
- `POST /api/reviews`: 새 기록 추가
- `PUT /api/reviews/<KOBIS영화코드>`: 기록 수정
- `DELETE /api/reviews/<KOBIS영화코드>`: 기록 삭제

이 프로젝트에는 계정과 로그인 기능이 없습니다. 익명 식별자는 같은 브라우저의 기록을 구분하기 위한 과제용 방식이며, 강한 사용자 인증을 제공하지는 않습니다.

KOBIS와 TMDB의 데이터 및 이미지 사용 조건을 따라 주세요. TMDB 데이터로 앱을 공개할 때에는 TMDB가 요구하는 출처 표기와 로고 표시 조건을 확인해야 합니다.
