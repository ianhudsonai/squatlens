# squatlens

Browser-only squat form analysis, feedback in Portuguese and English. Your video never leaves your device.

Status: in development. See [`docs/SPEC.md`](docs/SPEC.md).

> Feedback de movimento, não é dispositivo médico nem substitui treinador ou fisioterapeuta.

## Development

Requires Node 22 (see `.nvmrc`).

```sh
npm ci
npm run dev        # local dev server
npm run lint       # eslint (src/core is restricted to pure TypeScript)
npm run typecheck  # tsc -b (src/core is checked without DOM types)
npm test           # vitest
npm run build      # production build into dist/
npm run format     # prettier
```
