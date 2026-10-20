# Upload plan — Token Trail (token-trail@1.0.1, asset-zip-v2)

Package file: `token-trail-1.0.1.dshgame.zip`
Package size: 147769 bytes
SHA-256: `29a3f8a5361946c3e2ce7bca77b56f61f4c4fab57e1333a3e1000f67fa1d167a`
File-count: 12
fileManifestDigest: `def50059c425af29fb02b68b87d70140cef8f04c352ddb5879feb8f2b3ae94e1`
Registry URL: https://github.com/independent-author/token-trail/releases/download/token-trail-v1.0.1/token-trail-1.0.1.dshgame.zip
Release tag: `v1.0.1`

## 1. Upload the package

```bash
gh release create v1.0.1   '<work>/token-trail/dist/token-trail-1.0.1.dshgame.zip'   '<work>/token-trail/dist/token-trail-1.0.1.dshgame.zip.sha256'   --title 'Token Trail 1.0.1'
```

## 2. Publish the registry entry

Submit `registry-entry.json` through the content-repository submission flow
(M2-D tooling: `scripts/registry/prepare.mjs`). The entry declares
`package.format: "asset-zip-v2"` and `package.filesDigest`; the catalog/registry
v2 projection is built by that flow — this CLI step performs **no remote writes**
and no catalog rebuild.

## 3. Verify

1. `sha256sum` matches the registry entry;
2. the downloaded archive still passes `dsh-game validate <file> --format asset-zip-v2`;
3. the entry's `fileManifestDigest` equals the extracted descriptor digest.
