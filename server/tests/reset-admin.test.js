import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetAdminPassword } from '../reset-admin-password.js';
import { verifyPassword } from '../passwords.js';

function database({ name = 'payday_db_rv8p', active = true, failDelete = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.startsWith('SELECT current_database')) return { rows: [{ name }] };
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 42, is_active: active }] };
      if (sql.startsWith('UPDATE')) return { rowCount: 1 };
      if (sql.startsWith('DELETE') && failDelete) throw new Error('delete failed');
      return { rows: [] };
    }
  };
}

test('reset hashes with the login verifier and revokes only target sessions before commit', async () => {
  const db = database();
  await resetAdminPassword(db, 'test-new-password');
  const update = db.calls.find(c => c.sql.startsWith('UPDATE'));
  assert.equal(await verifyPassword('test-new-password', update.args[0]), true);
  assert.deepEqual(update.args.slice(1), [42, 'myadmin']);
  assert.match(update.sql, /role = 'admin'/);
  assert.deepEqual(db.calls.at(-2), {
    sql: 'DELETE FROM public.auth_sessions WHERE account_id = $1', args: [42]
  });
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});

test('wrong database and disabled admin never write', async () => {
  for (const options of [{ name: 'other' }, { active: false }]) {
    const db = database(options);
    await assert.rejects(resetAdminPassword(db, 'test-new-password'));
    assert.equal(db.calls.some(c => /^(UPDATE|DELETE)/.test(c.sql)), false);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('session deletion failure rolls back password change', async () => {
  const db = database({ failDelete: true });
  await assert.rejects(resetAdminPassword(db, 'test-new-password'));
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.calls.some(c => c.sql === 'COMMIT'), false);
});
