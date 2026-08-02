# FreeCut i18n Checklist

Use this reference when working in the FreeCut repo.

## Files

- `src/i18n/languages.ts`: add `AppLanguage` entry.
- `src/i18n/index.ts`: import the base locale JSON and add it to `baseLocales`.
- `src/i18n/locales/<lang>.json`: base strings.
- `src/i18n/locales/partials/<lang>/*.json`: translate every source partial. The current set is
  `editor`, `effects`, `export`, `keyframes`, `lottie-browser`, `media`, `preview`, `projects`,
  `recording`, `remaining-ui`, `render-queue`, `text-motion`, `timeline`, and `transcript`.
  Treat the wildcard as authoritative when new partials are added.

## Commands

```bash
node .agents/skills/translate-app-locales/scripts/check-locale-coverage.mjs --locales src/i18n/locales --partials src/i18n/locales/partials --source en --target tr
npm run build
```

Run targeted tests for any settings or toolbar behavior touched during the language work.
