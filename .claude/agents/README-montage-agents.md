# Montage agent suite

Агенты для AI-монтажа видео на FreeCut headless (см. память `freecut-headless-editing`, `ai-programmer-montage`; полный конвейер с гейтами — §0.5 скилла `freecut-montage`). Каждый — одна роль + явная граница «что НЕ делаю», обязательное чтение канона, строгий формат вывода, строгий вердикт (вокабуляр у каждого свой — см. таблицу контрактов внизу), «флагуй, не переписывай». House-style: `agent-authoring.md` (11 принципов) в Obsidian. Все read-only; **исправляю и собираю Я**.

Общие правила входов: вход отсутствует → stop and report; вход есть, но битый/пустой (кривой json, 0-байт файл, 0 извлечённых строк) → тоже stop and report с указанием, что битое, — не PASS из пустоты. Координаты таймкодов: планировщики — по ИСХОДНИКУ, QA-агенты — по СОБРАННОМУ таймлайну; мост — `timecode-map.json`, конвертирует оркестратор (§0.5 скилла).

## 1. Понять видео

- **montage-content-analyst** — описание + весь контент → единый БРИФ (сегменты с таймкодами, участники и роли, инвентарь фактуры, где густо/пусто, что видео обещает). Первый в конвейере; от его брифа работают все.

## 2. История / структура

- **montage-scriptwriter** — стержень длинного видео = paper edit (сквозная линия, акты, порядок, карта глав, обещание→оплата). Индустриальная роль story-producer.
- **transcript-highlight-miner** — транскрипт → сильные цитаты/цифры с таймкодами и hook-score (пул для тизера и карточек).
- **cut-list-planner** — предложенные контент-вырезы (тангенсы/повторы) на утверждение человеком.
- **montage-coldopen-composer** — cold-open тизер: 3-4 законченные фразы, нарастание интриги, рез по границам слов, reveal/withhold.
- **montage-shorts-producer** — вертикальный шортс 9:16 (одна идея, хук за 1с, реФрейм, вшитые субтитры ВКЛ, петля). Заменяет 2/2b/3 для шортсов.

## 3. План приёмов и движения

- **creative-director** — какой приём на какой бит ПОВЕРХ готового стержня (плашка/цифра/стикер/демо-сайта/маскот/мем/zoom) + звук + обоснование под ЦА/бренд.
- **stinger-planner** — слой «выскакивающей графики» (эмодзи/бейдж/скриншот/плашка) + звук, тайминг.
- **memolog** — мем-клипы: какой клип на какой бит и в какой форме (side-mute/side-sound/fullscreen-overlay/СКЛЕЙКА/punch), кут+громкость — строго по канону MEME-LIBRARY.
- **motion-designer** — спеки анимаций (кейфреймы/easing/textMotion/motionModifiers) под FreeCut.

## 4. Ассеты

- **montage-asset-sourcer** — приём → конкретный роялти-фри/CC0 ассет (Fluent/Lucide MIT, Simple Icons CC0, Pexels/Mixkit) с проверкой лицензии сегодня, или imagegen-заявка под пробел. Владелец лицензионной чистоты.

## 5. QA / критики (смотрят на результат, флагуют)

- **montage-frame-critic** — PNG-кадр рендера: читаемость/контраст/столкновения/полировка графики над видео. Балл + правки.
- **caption-copy-editor** — экранный текст (панч, длина под показ, типографика/тире, голос канала).
- **montage-factchecker** — БЛОКИРУЮЩИЙ: каждая экранная цифра/имя/цена сверяется с транскриптом (ловит ASR-искажения) + первоисточником. FAIL блокирует финал.
- **montage-continuity-qc** — единство графсистемы по ВСЕМУ ролику (шаблоны, акцент, радиус, бюджет маскота) + техспек deliverable (res/fps/кодек/громкость). Финишный гейт.
- **retention-pacing-critic** — удержание/ритм: хук ≤15с, длина тизера, мёртвые зоны, перегруз, интервал глав.
- **audio-levels-checker** — ffmpeg-замеры: клиппинг, LUFS, скачки на склейках, тишина, SFX глушит речь.

## 6. Упаковка (канон/персоны/голос приходят В ЗАДАЧЕ — не хардкод проекта)

- **youtube-metadata-reviewer**, **youtube-seo-scout**, **youtube-audience-scout** — заголовок/описание/главы/ключевики/язык аудитории.

## Поток

Конвейер стадия→агент→МОЙ гейт (§0.5 скилла): Понять → История (+cold-open / шортс-ветка) → План приёмов (+дешёвый прогон retention-critic по cue-list) → Ассеты → Движение → Копирайт→Факты (в этом порядке: фактчек по финальным строкам) → Сборка (Я, `headless:layout` + кадры) → QA-веер → ОДИН финальный рендер (после «ок» пользователя) → Упаковка (текст обложки — reviewer, пиксели — frame-critic thumbnail). Каждый гейт — моя проверка (текст/качество/баги), дефекты чиню Я до порога; к пользователю идёт готовое + сводка «было/стало».

## Таблица контрактов (агент → входы → выход → вердикт)

Канонические пути артефактов — `<ws>/_montage/agents-out/` (§7 скилла). «(!)» = обязательный вход, без него агент делает stop and report.

| Агент | Обязательные входы (пути в задаче) | Выход | Вердикт |
|---|---|---|---|
| montage-content-analyst | word-транскрипт (!), описание/слайды/ЦА | `brief.md` | COMPLETE / GAPS(n) |
| montage-scriptwriter | бриф (!) + транскрипт (!), пул майнера | `paper-edit.md` | PASS / REWORK |
| transcript-highlight-miner | транскрипт (!), N | `highlights.json` (timeSec/endSec/speaker/hookScore) | — |
| cut-list-planner | транскрипт (!), цель по длине, paper edit, пул майнера | JSON вырезов | — (human-in-the-loop) |
| montage-coldopen-composer | пул (!) + сквозная линия (!) + word-транскрипт (!) | `coldopen.md` (shot-list) | PASS / REWORK |
| montage-shorts-producer | бриф + пул (!) + word-транскрипт (!) | `shorts-plan.md` | PASS / REWORK |
| creative-director | paper edit (!) + бриф (!) + бренд + MONTAGE-MOVES + инвентаризация резервов + coldopen.md (тизер-биты) | `edit-plan.json` (occurrence teaser/body) | — |
| stinger-planner | edit-plan (!) + транскрипт + avoid-лист + meme-plan (порядок: CD → memolog → stinger) | `stinger-plan.json` | — |
| memolog | MEME-LIBRARY (!) + edit-plan + word-транскрипт + avoid-лист | `meme-plan.json` + строка AUDIO-GATE | PLAN: … |
| motion-designer | элемент+роль из планов (!), SFX-реестр | `motion-specs.json` | — |
| montage-asset-sourcer | asset-toolkit (!) + edit-plan+stinger-plan+meme-plan (!) + ASSET-LIBRARY | `asset-manifest.md` | READY / GAPS(n) / BLOCK |
| caption-copy-editor | строки (!): build.mjs/project.json, до сборки — cue-list/планы (content/sublabel/kicker/onscreen); + голос канала (!) | отчёт `qa/copy.md` | PASS / PASS_WITH_FIXES / BLOCK |
| montage-factchecker | word-транскрипт (!) + экранные строки (!) | отчёт `qa/facts.md` | PASS / FAIL (блокирует финал) |
| montage-frame-critic | PNG или mp4+таймкоды (!); режимы: моушен-чек, thumbnail | отчёт `qa/frame.md` + балл | PASS / PASS_WITH_FIXES / BLOCK |
| montage-continuity-qc | project.json (!) + бренд-канон (!), финальный mp4, спека (для шортса — вертикальная) | отчёт `qa/continuity.md` + балл | PASS / PASS_WITH_FIXES / BLOCK |
| retention-pacing-critic | до сборки: cue-list + running order (paper-edit/shot-list) (!); после: project.json (!); бриф, ниша/CTA платформы | отчёт `qa/pacing.md` + балл | PASS / PASS_WITH_FIXES / BLOCK |
| audio-levels-checker | mp4 (!), цель LUFS, AUDIO-GATE-таймкоды намеренных пауз | отчёт `qa/audio.md` | PASS / PASS_WITH_FIXES / BLOCK |
| youtube-metadata-reviewer | SEO-канон (!) + черновик (!) + сценарий (!) + голос (!) | отчёт | PASS / PASS_WITH_FIXES / BLOCK |
| youtube-seo-scout | SEO-канон (!) + сценарий (!) | разведка | — |
| youtube-audience-scout | SEO-канон/персоны (!) + голос (!) + сценарий (!) | разведка | — |
