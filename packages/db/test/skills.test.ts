// Offline tests for a workspace's skill files (.nimbrio-ai/skills/<name>.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillExistsError, WorkspaceSkills, parseSkillFile } from '../src/workspace-skills.js';

async function tempSkills(): Promise<WorkspaceSkills> {
  return new WorkspaceSkills(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-test-')));
}

const FIX = {
  name: 'jira-ticket-fix',
  description: 'When the user gives a Jira ticket\nto check or fix.',
  body: 'Phase 1: verify.\n\nPhase 2: propose, then stop.',
};

test('a skill is saved as Markdown with front matter and read back', async () => {
  const skills = await tempSkills();
  const created = await skills.create(FIX);
  assert.equal(created.description, 'When the user gives a Jira ticket to check or fix.');
  assert.equal(created.body, FIX.body);
  assert.ok(created.updatedAt);

  const text = await fs.readFile(path.join(skills.dir, 'jira-ticket-fix.md'), 'utf8');
  assert.equal(
    text,
    '---\nname: jira-ticket-fix\ndescription: When the user gives a Jira ticket to check or fix.\n---\n\nPhase 1: verify.\n\nPhase 2: propose, then stop.\n',
  );
  const ignore = path.join(skills.folder, '.nimbrio-ai', '.gitignore');
  assert.ok(await fs.stat(ignore), 'the data folder keeps its .gitignore');
  assert.deepEqual(
    (await skills.list()).map((s) => s.name),
    ['jira-ticket-fix'],
  );
});

test('names are unique, renames move the file, and removing reports what happened', async () => {
  const skills = await tempSkills();
  await skills.create(FIX);
  await skills.create({ ...FIX, name: 'code-review' });
  await assert.rejects(skills.create(FIX), SkillExistsError);
  await assert.rejects(skills.update('code-review', FIX), SkillExistsError);

  const renamed = await skills.update('jira-ticket-fix', { ...FIX, name: 'ticket-fix' });
  assert.equal(renamed?.name, 'ticket-fix');
  assert.equal(await skills.get('jira-ticket-fix'), null);
  assert.equal(await skills.update('gone', FIX), null);

  assert.equal(await skills.remove('ticket-fix'), true);
  assert.equal(await skills.remove('ticket-fix'), false);
  assert.deepEqual(
    (await skills.list()).map((s) => s.name),
    ['code-review'],
  );
});

test('only valid names map to files, links are not followed, and hand-written files are read', async () => {
  const skills = await tempSkills();
  assert.equal(await skills.get('../settings'), null);
  assert.equal(await skills.remove('../../etc/passwd'), false);

  await fs.mkdir(skills.dir, { recursive: true });
  const outside = path.join(skills.folder, 'secret.md');
  await fs.writeFile(outside, 'not a skill');
  await fs.symlink(outside, path.join(skills.dir, 'linked.md'));
  await fs.writeFile(path.join(skills.dir, 'Bad Name.md'), 'ignored');
  await fs.writeFile(
    path.join(skills.dir, 'by-hand.md'),
    '---\r\nname: whatever\r\ndescription: "Quoted, by hand"\r\n---\r\nDo it this way.\r\n',
  );
  await fs.writeFile(path.join(skills.dir, 'plain.md'), 'No front matter at all.');

  assert.equal(await skills.get('linked'), null);
  const list = await skills.list();
  assert.deepEqual(
    list.map((s) => [s.name, s.description, s.body]),
    [
      ['by-hand', 'Quoted, by hand', 'Do it this way.'],
      ['plain', '', 'No front matter at all.'],
    ],
  );
  assert.deepEqual(parseSkillFile('---\ndescription: x\n---\n'), { description: 'x', body: '' });
});
