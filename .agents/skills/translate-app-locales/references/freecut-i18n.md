# FreeCut i18n Checklist

Use this reference when working in the FreeCut repo.

## Files

- `src/i18n/languages.ts`: add `AppLanguage` entry.
- `src/i18n/index.ts`: import the base locale JSON and add it to `baseLocales`.
- `src/i18n/locales/<lang>.json`: base strings.
- `src/i18n/locales/partials/<lang>/editor.json`: editor shell and panels.
- `src/i18n/locales/partials/<lang>/projects.json`: project list, landing, migration, settings, hotkeys.
- `src/i18n/locales/partials/<lang>/effects.json`: effect names, parameters, panels.
- `src/i18n/locales/partials/<lang>/keyframes.json`: keyframe editor.
- `src/i18n/locales/partials/<lang>/export.json`, `media.json`, and `preview.json`: export/media/preview UI.
- `src/i18n/locales/partials/<lang>/remaining-ui.json`: remaining editor and project UI.
- `src/i18n/locales/partials/<lang>/timeline.json`: timeline track drag/drop labels.

## Commands

```bash
node .agents/skills/translate-app-locales/scripts/check-locale-coverage.mjs --locales src/i18n/locales --partials src/i18n/locales/partials --source en --target tr
npm run build
```

Run targeted tests for any settings or toolbar behavior touched during the language work.
