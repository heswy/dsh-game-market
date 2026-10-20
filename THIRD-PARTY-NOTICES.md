# Third-party notices

DSH Game Market V1.5 ships exactly **one** new runtime dependency closure, and
it is confined to the `asset-zip-v2` archive reader:

| package | version | license | copyright | used by |
|---|---|---|---|---|
| [`yauzl`](https://github.com/thejoshwolfe/yauzl) | `3.4.0` (exact, pinned in `package.json`) | MIT | Copyright (c) 2014 Josh Wolfe | `packages/host/src/zip.js` only |
| [`pend`](https://github.com/andrewrk/node-pend) | `1.2.0` (transitive, `yauzl`'s only dependency) | MIT | Copyright (c) 2014 Andrew Kelley | transitively via `yauzl` |

Decision record: `docs/V1.5-CONTRACTS.md` §2 (Decision V1.5-01) allows this one
dependency after review; `PROJECT_MEMORY.md` §1.2.6 records the scoped
exception (PRD D-040). No other third-party runtime package is introduced by
V1.5. The dependency is installed by DSH's package manager as a real
`dependencies` entry, has no `install`/`preinstall`/`postinstall` scripts, and
is never imported outside `packages/host/src/zip.js` and its tests.

Both libraries are used unmodified, as npm packages. Their full license texts
follow.

## yauzl 3.4.0 — MIT

```text
The MIT License (MIT)

Copyright (c) 2014 Josh Wolfe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pend 1.2.0 — MIT (Expat)

```text
The MIT License (Expat)

Copyright (c) 2014 Andrew Kelley

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
