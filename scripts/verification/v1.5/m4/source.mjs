import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
export function sourceIdentity(root) {
  return {head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceChanges:execFileSync('git',['diff','--name-only','HEAD','--','packages','scripts','client.js','index.js'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean),
    clientSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'client.js'))).digest('hex'),
    loading:'local development row in isolated profile; not a new immutable release/install claim'};
}
