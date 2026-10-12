export interface CliArgs {
  updateBaseline: boolean;
  only: string[] | null;
  allowModelMismatch: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    updateBaseline: false,
    only: null,
    allowModelMismatch: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--update-baseline') args.updateBaseline = true;
    else if (arg === '--allow-model-mismatch') args.allowModelMismatch = true;
    else if (arg.startsWith('--only=')) {
      args.only = arg
        .slice('--only='.length)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    } else {
      throw new Error(
        `Unknown argument "${arg}". Supported: --update-baseline, --only=<id>[,<id>...], --allow-model-mismatch`,
      );
    }
  }
  return args;
}
