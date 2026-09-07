# @prismshadow/linsight-cli

The Linsight command line. Installs the `linsight` command: an interactive REPL, a one-shot task runner, model / vault configuration, and the launcher for the Web service.

```bash
npm install -g @prismshadow/linsight-cli   # requires Node >= 24
```

```bash
linsight web        # start the Web service and open http://127.0.0.1:7364
linsight server     # same service, headless

linsight config model add --model-id deepseek-v4-pro --api-key sk-... --set-default

linsight run -m "Create hello.txt containing Hello, Linsight"    # one Task, then exit
linsight chat                                                   # REPL: /compact, /clear, /exit, Ctrl-C interrupts
linsight chat --resume                                          # resume the latest session
```

Tool calls go through an approval gate — `--approve allow-all` (default) `| deny-all | read-only | always-ask`. Data lives under `~/.linsight/data` (`LINSIGHT_HOME` or `--root` override); model credentials come from the Project config or provider env vars (e.g. `DEEPSEEK_API_KEY`).

Prefer a one-line install with a bundled Node runtime? See [Quickstart → CLI and Web App](https://linsight.ooo/docs/quickstart-cli).

## Documentation

- [Quickstart](https://linsight.ooo/docs/quickstart)
- [CLI Reference](https://linsight.ooo/docs/cli)
- [Configuration Reference](https://linsight.ooo/docs/configuration)

## Development

```bash
pnpm linsight <args>                              # run from source (repo root, via tsx)
pnpm --filter @prismshadow/linsight-cli build     # tsup → dist/index.js (the linsight bin)
pnpm --filter @prismshadow/linsight-cli typecheck
pnpm --filter @prismshadow/linsight-cli test
```

Part of [Linsight](https://github.com/Prism-Shadow/linsight) · Apache-2.0
