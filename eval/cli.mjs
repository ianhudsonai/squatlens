// `npm run eval`: loads eval/run-eval.ts through Vite's module runner (TypeScript and
// extensionless imports, same resolution as the app and vitest) and runs its CLI.
import console from 'node:console';
import process from 'node:process';
import { runnerImport } from 'vite';

try {
  const { module } = await runnerImport('/eval/run-eval.ts', {
    configFile: false,
    logLevel: 'error',
  });
  process.exitCode = module.main(process.argv.slice(2));
} catch (err) {
  console.error(`eval: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
