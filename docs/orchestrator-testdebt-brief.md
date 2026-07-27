# Бриф следующей сессии: тех-долг canvas-render-orchestrator

**Стартовый промпт (скопируй в новую сессию):**

> Возьми тех-долг canvas-render-orchestrator в план-моде: выдели из
> `src/features/export/utils/canvas-render-orchestrator.ts` чистое планирование
> frame-loop и покрой его реальными тестами. Бриф: `docs/orchestrator-testdebt-brief.md`.

## Контекст

- Долг зафиксирован в `docs/UPSTREAM-SYNC.md` («After the sync»): текущий
  `canvas-render-orchestrator.test.ts` — mock-echo (проверяет вызовы моков, не логику).
  Плейбук планировал его «сразу после синка» — синк сделан 2026-07-26 (апстрим #347).
- Родственный документ: `docs/render-frame-decomposition-plan.md` — уже написанный план
  декомпозиции `renderFrame` (6 вложенных функций, пересоздаваемых на каждый кадр,
  таблица захватов скоупов). Прочитать ДО планирования — возможно, тех-долг оркестратора
  и этот план — одна работа с двух сторон.
- Правила: тесты только на реальную логику (CLAUDE.md «Only write tests that exercise
  real logic»); jsdom-дефолт, чистая логика — `// @vitest-environment node`;
  changed-health гейт пройдёт только с настоящим снижением сложности, суппрессии — только
  на доказанные false positives.

## Ожидаемая форма результата

1. Чистые модули: планирование кадрового цикла (какие кадры, какие задачи, в каком
   порядке; без DOM/GPU/декодеров) выделено в функции без побочных эффектов.
2. Реальные тесты на планировщик: границы (in/out points), пропуски, задачи переходов,
   occlusion-cutoff, приоритеты — таблично, node-env.
3. Старый mock-echo тест удалён или переписан.
4. Верификация: `vp check`, полный `test:run`, `npm run build && npm run
   headless:test:portable`, золотой смоук-кадр на проде-данных
   (`npm run headless:frame -- --workspace /Users/timurceberda/Documents/FreeCutProjects
   --project .../_montage/final.json --at 84.5`) — попиксельная сверка ДО/ПОСЛЕ
   рефакторинга обязательна (рефакторинг не должен менять пиксели).
5. Гейты + пуш в fork через хук.

## Грабли

- Оркестратор — сердце экспорта: НЕ менять поведение, только структуру. Пиксельная
  сверка md5 кадров до/после — главный контракт.
- `renderSingleFrame` и `renderComposition` делят код («SAME renderer as export»).
- fallow-ignore complexity уже висит на некоторых функциях — после честной декомпозиции
  снять ставшие ненужными суппрессии.
- Headless читает dist/ — перед смоуком `npm run build`.
