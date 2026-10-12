# MuseRouter

**Một router AI kiểu [9Router](https://github.com/decolua/9router) — cộng thêm kết nối Muse (qua [muse2api](https://github.com/bynne2602/muse2api)) như một provider hạng nhất: chat, sinh ảnh và sinh video.**

> Project độc lập, viết mới (Node.js thuần, **không cần `npm install`** — chỉ dùng thư viện chuẩn của Node ≥ 20). Lấy cảm hứng tính năng từ 9Router và giao thức API của muse2api; cả hai project gốc đều là MIT — xem mục Giấy phép ở cuối.

## Vì sao có project này?

- 9Router rất mạnh (40+ provider, fallback, tiết kiệm token) nhưng **chưa có Muse**.
- muse2api biến Muse (muse.ai) thành API chuẩn OpenAI (chat / ảnh / video, xoay nhiều tài khoản) nhưng **đứng một mình**, không có routing/fallback sang provider khác.
- **MuseRouter = lớp router ở giữa:** client chỉ nói chuyện với 1 endpoint duy nhất; router tự chọn provider, tự fallback khi lỗi/hết quota, và Muse chỉ là một trong các provider — nhưng là provider duy nhất trong danh sách làm được cả **ảnh + video**.
- **Từ bản 0.2: Muse được tích hợp sẵn như cách 9Router tích hợp provider** — engine muse2api được nhúng ngay trong project (thư mục `engine/muse2api`, giữ nguyên giấy phép MIT của tác giả), MuseRouter tự khởi động và quản lý nó. Người dùng **không cài muse2api riêng nữa**: chỉ mở dashboard → bấm **Đăng nhập Muse** → trang auth mở ra → đăng nhập và thêm tài khoản.

## Port mới — không đụng hàng

| Phần mềm | Port mặc định |
|---|---|
| 9Router | `20128` (dev `20127`) |
| muse2api (bản cài riêng) | `18610` (CDP nội bộ `19210`) |
| **MuseRouter (project này)** | **`21128`** |
| Engine Muse tích hợp trong MuseRouter | `18611` (CDP nội bộ `19211`) — chỉ nghe ở localhost |

Cả 3 chạy song song trên cùng một máy thoải mái. Đổi port bằng biến `PORT` trong `.env`.

## Kiến trúc

```
Claude Code / Codex / Cursor / Cline / bất kỳ client OpenAI-compatible nào
        │  http://localhost:21128/v1        (hoặc /v1/messages cho Anthropic mode)
        ▼
┌──────────────────────────── MuseRouter :21128 ────────────────────────────┐
│ • RTK Token Saver: nén tool_result dài trước khi gửi (tiết kiệm ~20–40%)   │
│ • Dịch format OpenAI ⇄ Anthropic                                           │
│ • Combo / fallback 3 tầng: Subscription → Cheap → Free                    │
│ • Multi-account: nhiều connection / provider, xoay vòng + cooldown khi 429 │
│ • Log request + thống kê usage (~/.muserouter/logs.jsonl, dashboard)                │
└──┬──────────────┬──────────────┬──────────────┬──────────────┬────────────┘
   ▼              ▼              ▼              ▼              ▼
 Muse        OpenAI /      DeepSeek /     Gemini /      Custom
 (engine      Anthropic     GLM / Kimi /   Groq /        OpenAI- hoặc
  tích hợp                     MiniMax /    Ollama…       Anthropic-compatible
  :18611)                       OpenRouter…
  chat+ảnh+video
```

## Tính năng

- **OpenAI-compatible:** `POST /v1/chat/completions` (có stream SSE), `GET /v1/models`, `POST /v1/images/generations`, `POST /v1/videos` + `GET /v1/videos/{id}`, `POST /v1/embeddings`
- **Anthropic-compatible:** `POST /v1/messages` — Claude Code cắm thẳng vào được; router dịch qua lại OpenAI ⇄ Anthropic cả 2 chiều (kể cả khi upstream là Anthropic thật)
- **Kết nối Muse tích hợp (mới):** engine muse2api nhúng sẵn, MuseRouter tự chạy ở port nội bộ 18611; đăng nhập Muse ngay trong dashboard (nút **Đăng nhập Muse** mở trang auth của engine); model `muse/muse-spark` (chat), `muse/muse-image` (ảnh), `muse/muse-video` (video); engine tự xoay tài khoản Muse và gia hạn session ~48h. Vẫn cắm thêm được muse2api standalone bên ngoài làm dự phòng
- **16 provider sẵn preset:** `muse`, `openai`, `anthropic`, `openrouter`, `deepseek`, `glm`, `kimi`, `minimax`, `gemini`, `groq`, `mistral`, `xai`, `together`, `ollama`, `custom-openai`, `custom-anthropic`
- **Combos:** đặt tên 1 chuỗi model, vd `coding = muse/muse-spark → openai/gpt-4o → deepseek/deepseek-chat`; lỗi 429/5xx ở nấc trước tự nhảy nấc sau, connection lỗi bị cooldown 30–60s
- **Multi-account:** thêm nhiều connection cho cùng 1 provider, router xoay vòng theo priority
- **RTK Token Saver:** nén nội dung `tool`/`tool_result` dài (khử trùng lặp, gộp dòng trắng, cắt giữa thông minh); tắt cho 1 request bằng header `X-MuseRouter-Token-Saver: off` (cũng nhận header `X-9Router-Token-Saver` của 9Router)
- **Dashboard** tại `/dashboard`: thêm/xóa/test connection, tạo combo, xem usage + log, bật/tắt RTK
- **Bảo mật:** mọi route `/v1/*` và `/api/*` đều cần `Authorization: Bearer <ROUTER_API_KEY>` (tự sinh lần đầu, lưu ở `~/.muserouter/config.json` — **đừng commit/share file này**)

## Chạy nhanh

### Cách 0 — Cài global như 9Router (khuyên dùng)

Sau khi project đã được đẩy lên GitHub (mục "Đẩy lên GitHub" ở cuối), bất kỳ máy nào cũng cài được bằng đúng 1 lệnh — giống hệt `npm install -g 9router`:

```bash
npm install -g github:<tên-github-của-bạn>/muserouter
muserouter setup     # 1 lần đầu: cài engine Muse tích hợp (cần Python 3.10+)
muserouter           # chạy server ở port 21128 + tự mở dashboard
```

Chưa đẩy GitHub cũng cài global được ngay từ thư mục source:

```bash
cd muserouter && npm install -g .
muserouter --help    # xem các lệnh: --port, --no-open, setup, --version
```

Dữ liệu (key, config, log) nằm ở `~/.muserouter/` (Windows: `C:\Users\<tên>\.muserouter\`) nên chạy lệnh `muserouter` ở thư mục nào cũng được. Muốn gỡ: `npm uninstall -g muserouter`.

### Cách 1 — Chạy từ source (không cần cài thêm gì)

```bash
git clone <repo-này> muserouter && cd muserouter
cp .env.example .env      # điền key các provider anh có (Muse thì khỏi — xem mục dưới)
npm run setup:muse        # chỉ 1 lần đầu: cài engine Muse tích hợp (cần Python 3.10+ và Chrome/Chromium trên máy)
npm start                 # = node src/server.js
```

Mở dashboard: http://localhost:21128/dashboard — dán API key (in ở log lúc khởi động, hoặc xem `~/.muserouter/config.json`) vào ô key.

### Cách 2 — Docker

```bash
cp .env.example .env      # đặt MUSE_ENGINE_KEY trong .env
docker compose --profile muse up -d --build   # cả router (21128) + engine Muse (18611)
```

> Chạy bằng Node thì engine Muse chạy chung tiến trình quản lý của MuseRouter; chạy bằng Docker thì engine là 1 container riêng trong cùng compose (profile `muse`). Cả 2 cách người dùng đều chỉ thao tác qua dashboard.

### Kết nối Muse (tích hợp sẵn — không cần cài muse2api riêng)

1. Chạy MuseRouter (`npm start`) — engine Muse tự bật ở port nội bộ 18611.
2. Vào dashboard → mục **🔐 Kết nối Muse (tích hợp sẵn)** → bấm **Đăng nhập Muse**.
3. Trang auth của engine mở ra: làm theo 3 bước ngay trong trang đó — đăng nhập https://muse.ai bằng tài khoản của anh, rồi dùng cookie helper của engine để "Lấy Cookie và thêm tài khoản". (Muse không có OAuth API công khai cho bên thứ ba; muse2api — và cả engine tích hợp này — xác thực bằng phiên đăng nhập web của chính anh, và tự gia hạn session ~48h.)
4. Quay lại dashboard: mục Muse sẽ hiện số tài khoản đã kết nối. Thêm bao nhiêu tài khoản tùy ý — engine tự xoay vòng.
5. Gọi model `muse/muse-spark` (chat), `muse/muse-image` (ảnh), `muse/muse-video` (video) như mọi provider khác.

Tắt engine tích hợp: đặt `MUSE_ENGINE=off` trong `.env`. Xem log engine ở `~/.muserouter/muse-engine.log`, trạng thái ở `GET /api/muse/status`.

## Dùng với công cụ code

| Công cụ | Cấu hình |
|---|---|
| Cursor / Cline / Continue / RooCode | Base URL `http://localhost:21128/v1`, API key = router key, Model = `muse/muse-spark` hoặc tên combo |
| Claude Code | `ANTHROPIC_BASE_URL=http://localhost:21128` + `ANTHROPIC_API_KEY=<router key>`, model `muse/muse-spark` (đi qua `/v1/messages`) |
| Codex / client OpenAI | `OPENAI_BASE_URL=http://localhost:21128/v1`, `OPENAI_API_KEY=<router key>` |
| curl | xem ví dụ dưới |

```bash
# Liệt kê model
curl http://localhost:21128/v1/models -H "Authorization: Bearer $ROUTER_API_KEY"

# Chat qua Muse
curl http://localhost:21128/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"muse/muse-spark","messages":[{"role":"user","content":"Xin chào"}]}'

# Chat qua combo (tự fallback Muse -> DeepSeek -> Gemini)
curl http://localhost:21128/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"coding","messages":[{"role":"user","content":"Viết hàm quicksort"}]}'

# Sinh ảnh qua Muse (chỉ provider muse/openai làm được)
curl http://localhost:21128/v1/images/generations \
  -H "Authorization: Bearer $ROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"muse/muse-image","prompt":"mèo đội mũ len, tuyết rơi"}'

# Sinh video qua Muse (trả task id, poll GET /v1/videos/{id})
curl http://localhost:21128/v1/videos \
  -H "Authorization: Bearer $ROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"muse/muse-video","prompt":"căn bếp ấm cúng, tuyết ngoài cửa sổ"}'
```

## Cấu trúc thư mục

```
src/server.js      # HTTP server, routing, fallback, admin API
src/museEngine.js  # Quản lý engine Muse tích hợp: tự cài deps, tự khởi động, trạng thái tài khoản
src/providers.js   # Registry 16 provider (base URL, format, model mặc định, tier)
src/rtk.js         # RTK token saver
src/translate.js   # Dịch OpenAI ⇄ Anthropic
src/store.js       # config/logs/usage trong ~/.muserouter/, seed từ .env
src/dashboard.html # Dashboard 1 file
engine/muse2api/   # Engine Muse được nhúng nguyên trạng từ muse2api (MIT — xem engine/NOTICE.md)
scripts/setup-muse.mjs # npm run setup:muse — tạo .venv + cài Python deps cho engine
tests/smoke.test.js# Test bằng mock upstream (không cần key thật): npm test
~/.muserouter/    # Sinh lúc chạy NGOÀI thư mục code: config.json (có key — giữ kín), logs, usage, muse-engine.json
```

## Test

```bash
npm test   # node --test: healthz, auth, /v1/models, chat qua mock Muse, combo fallback khi 429, /v1/messages, dashboard
```

## Hạn chế hiện tại (bản 0.2)

- Đăng nhập Muse dùng phiên web (cookie) qua engine tích hợp — đó là cơ chế của chính muse2api vì Muse không cấp OAuth cho bên thứ ba; các provider subscription khác (Claude Code/Codex/Copilot) của 9Router vẫn chưa có OAuth login trực tiếp — dùng bằng API key.
- Chưa có Cloud Sync, chưa tính giá tiền theo model (usage chỉ đếm token/request).
- Stream cho upstream Anthropic được gom về 1 response (chưa stream từng token); stream cho provider OpenAI-compatible (gồm Muse) là stream thật.
- Dịch format chỉ bao phủ text + tool calls cơ bản.

## Đẩy lên GitHub

Repo đã sẵn sàng để push (đã `git init`, có commit, `.gitignore` đã chặn `.env`/data/`.venv`). Điều kiện: máy có Git và anh đã đăng nhập GitHub.

- **Windows:** tạo 1 repo trống tên `muserouter` trên github.com (không tích "Add README"), rồi chạy file **`push-github.bat`** trong thư mục project — nó hỏi tên GitHub của anh, tự init/commit và push; trình duyệt sẽ bật lên để anh đăng nhập GitHub 1 lần.
- **Thủ công (mọi hệ điều hành):**

```bash
cd muserouter
git init -b main   # bỏ qua nếu đã có .git
git add -A && git commit -m "MuseRouter"
git remote add origin https://github.com/<tên-github-của-bạn>/muserouter.git
git push -u origin main
```

Push xong, người khác (hoặc chính anh ở máy khác) cài bằng: `npm install -g github:<tên-github-của-bạn>/muserouter` rồi chạy `muserouter`.

> Muốn phát hành lên npm registry để cài bằng `npm install -g muserouter` (không cần tiền tố github:) thì cần tài khoản npm: `npm login` rồi `npm publish` trong thư mục project.

## Giấy phép & ghi công

MIT. Project viết mới, lấy cảm hứng tính năng từ [9Router](https://github.com/decolua/9router) (MIT, © decolua) và tương thích giao thức với [muse2api](https://github.com/bynne2602/muse2api) (MIT). Muse là dịch vụ của bên thứ ba — chỉ dùng với tài khoản anh được phép sử dụng và tuân thủ điều khoản của dịch vụ.
