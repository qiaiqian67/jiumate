# @jadelau/cli

The JiuMate command line. Installs the `jiumate` command: an interactive REPL, a one-shot task runner, model / vault configuration, and the launcher for the Web service.

```bash
npm install -g @jadelau/cli   # requires Node >= 24
```

```bash
jiumate web        # start the Web service and open http://127.0.0.1:7364
jiumate server     # same service, headless

jiumate config model add --model-id deepseek-v4-pro --api-key sk-... --set-default

jiumate run -m "Create hello.txt containing Hello, JiuMate"    # one Task, then exit
jiumate chat                                                   # REPL: /compact, /clear, /exit, Ctrl-C interrupts
jiumate chat --resume                                          # resume the latest session
```

Tool calls go through an approval gate — `--approve allow-all` (default) `| deny-all | read-only | always-ask`. Data lives under `~/.jiumate/data` (`JIUMATE_HOME` or `--root` override); model credentials come from the Project config or provider env vars (e.g. `DEEPSEEK_API_KEY`).

Prefer a one-line install with a bundled Node runtime? See [Quickstart → CLI and Web App](https://qiaiqian67.github.io/jiumate/docs/quickstart-cli).

## Documentation

- [Quickstart](https://qiaiqian67.github.io/jiumate/docs/quickstart)
- [CLI Reference](https://qiaiqian67.github.io/jiumate/docs/cli)
- [Configuration Reference](https://qiaiqian67.github.io/jiumate/docs/configuration)

## Development

```bash
pnpm jiumate <args>                              # run from source (repo root, via tsx)
pnpm --filter @jadelau/cli build     # tsup → dist/index.js (the jiumate bin)
pnpm --filter @jadelau/cli typecheck
pnpm --filter @jadelau/cli test
```

Part of [JiuMate](https://github.com/qiaiqian67/jiumate) · Apache-2.0
