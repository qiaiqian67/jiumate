# Skill archives may be larger, and say so when they are not

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-14-skill-archive-size.zh.md)

Installing a Skill from a URL failed with

> The downloaded archive exceeds the size limit.

The total cap was 20MB. It is now 200MB.

## The message never said which limit

The same file enforced the same cap on two paths, and only one of them
told the user the number:

    /url     → "The downloaded archive exceeds the size limit."
    /archive → "压缩包超过 20MB 上限。"   (declared-length check said only "压缩包太大。")

So an archive over the cap reported a figure on the upload route and an
opaque sentence on the download route, and nothing in the failing message
told the user what to aim for. Both now go through one `archiveTooLarge()`
helper, and the number is derived from the constant rather than written
out — a limit moved from 20MB and the message beside it kept saying 20MB,
which is how the two drifted apart in the first place.

`skillTooLarge()` had the same problem: it spelled "5MB per file, 20MB
total" into its own string. It reads the constants now.

## A test that encoded the limit as a literal

`skills.test.ts` proved the total cap by posting `5 × 4200KB` and expecting
a rejection. At 64MB that payload is comfortably under the cap — and at 200MB it is
further under still, so the route accepted it and the assertion failed as
`expected 201 to be 400`, with nothing in the failure pointing at the number
that had moved.

It is now sized from `MAX_TOTAL_BYTES`: a part size under `MAX_FILE_BYTES`,
and enough parts to exceed the total. A hand-written payload that clears a
threshold is a second copy of that threshold, and it stops testing anything
the moment the threshold moves.

## Still not fixed

`download()` calls `response.arrayBuffer()` and only compares the length
afterwards, so the whole body is in memory before the cap is consulted. A
multi-gigabyte archive is read in full and *then* refused. The cap currently
stops "too big once downloaded", not "too big while downloading"; making it
stream and abort is a separate change and was not made here.

`MAX_TOTAL_BYTES` is also not the only archive cap in the repo —
`routes/skills.ts` and `routes/agent-transfer.ts` each declare their own
14MB `MAX_ARCHIVE_BYTES`. Left alone: raising those is a separate decision.

server skills + machine-skills suites green (48).