import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const setupPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'setup.sql');

function sqlStatements() {
  const sql = fs.readFileSync(setupPath, 'utf8')
    .replace(/--[^\r\n]*/g, '')
    .toLowerCase();
  return sql.split(';').map((statement) => statement.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function policiesFor(table, statements) {
  return statements.filter((statement) =>
    statement.startsWith('create policy ') && statement.includes(` on public.${table} `));
}

test('content tables exist and enable row level security', () => {
  const statements = sqlStatements();

  for (const table of ['zerkalo_owners', 'zerkalo_works', 'zerkalo_reviews']) {
    assert.ok(statements.some((statement) => statement.startsWith(`create table if not exists public.${table} `)), `${table} table is missing`);
    assert.ok(statements.includes(`alter table public.${table} enable row level security`), `${table} must enable RLS`);
  }
});

test('public content roles can select but anonymous users receive no content write grants', () => {
  const statements = sqlStatements();

  for (const table of ['zerkalo_works', 'zerkalo_reviews']) {
    assert.ok(statements.some((statement) => statement.includes(`grant select on table public.${table} to anon, authenticated`)), `${table} must allow public reads`);
    assert.equal(statements.some((statement) => statement.includes(`grant insert, update, delete on table public.${table} to anon`)), false, `${table} must not grant anonymous writes`);
  }
  assert.equal(statements.some((statement) => statement.includes('grant insert, update, delete on table public.zerkalo_owners')), false, 'owner mapping must have no client write grant');
});

test('only the mapped owner receives content mutation policies', () => {
  const statements = sqlStatements();

  for (const table of ['zerkalo_works', 'zerkalo_reviews']) {
    const policies = policiesFor(table, statements);
    for (const operation of ['insert', 'update', 'delete']) {
      const policy = policies.find((statement) => statement.includes(` for ${operation} `));
      assert.ok(policy, `${table} ${operation} policy is missing`);
      assert.match(policy, /to authenticated/);
      assert.match(policy, /zerkalo_owners/);
      assert.match(policy, /auth\.uid\(\)/);
      if (operation === 'update') assert.match(policy, /with check/);
    }
  }
});

test('work photo bucket is public for reads and owner-only for writes', () => {
  const statements = sqlStatements();
  const bucketInsert = statements.find((statement) => statement.startsWith('insert into storage.buckets'));
  assert.ok(bucketInsert, 'work photo bucket must be created');
  assert.match(bucketInsert, /'zerkalo-works'/);
  assert.match(bucketInsert, /public/);

  const policies = statements.filter((statement) => statement.startsWith('create policy ') && statement.includes(' on storage.objects '));
  for (const operation of ['insert', 'select', 'update', 'delete']) {
    const policy = policies.find((statement) => statement.includes(` for ${operation} `));
    assert.ok(policy, `storage ${operation} policy is missing`);
    assert.match(policy, /bucket_id = 'zerkalo-works'/);
    if (operation !== 'select' || !policy.includes('to public')) {
      assert.match(policy, /to authenticated/);
      assert.match(policy, /zerkalo_owners/);
      assert.match(policy, /auth\.uid\(\)/);
    }
  }
});
