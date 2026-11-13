import { hashPassword } from './passwords.js';

// The caller owns the connection. Never include database errors in CLI output.
export async function resetAdminPassword(client, password) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    const database = (await client.query('SELECT current_database() AS name')).rows[0];
    if (database?.name !== 'payday_db_rv8p') throw new Error('WRONG_DATABASE');
    const { rows } = await client.query(
      `SELECT id, is_active FROM public.auth_accounts
       WHERE username = $1 AND role = 'admin' FOR UPDATE`, ['myadmin']);
    if (rows.length !== 1 || rows[0].is_active !== true) throw new Error('ADMIN_NOT_ACTIVE');
    const hash = await hashPassword(password);
    const updated = await client.query(
      `UPDATE public.auth_accounts SET password_hash = $1
       WHERE id = $2 AND username = $3 AND role = 'admin'`,
      [hash, rows[0].id, 'myadmin']);
    if (updated.rowCount !== 1) throw new Error('ADMIN_NOT_FOUND');
    await client.query('DELETE FROM public.auth_sessions WHERE account_id = $1', [rows[0].id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
