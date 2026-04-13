import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'
import type { User } from '../../db.js'

interface UsersProps {
  user: LayoutUser
  users: User[]
}

function formatDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 10)
}

export const UsersPage: FC<UsersProps> = ({ user, users }) => (
  <Layout title="Users" user={user} activePath="/admin/users">
    <div class="card mb-4">
      <div class="flex justify-between items-center">
        <h2>Add User</h2>
      </div>
      <form id="addUserForm" style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 14px; align-items: flex-end;">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required placeholder="Full name" />
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" required placeholder="email@example.com" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" required placeholder="Min 8 chars" />
        </div>
        <div class="form-group">
          <label>Role</label>
          <select name="role">
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" style="height: 42px;">Add User</button>
      </form>
      <div id="addUserMsg" class="mt-2" style="font-size:13px;"></div>
    </div>

    <div class="card">
      <h2>All Users</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="usersTable">
          {users.map((u) => (
            <tr id={`user-${u.id}`}>
              <td>{u.name}</td>
              <td class="mono">{u.email}</td>
              <td>
                <select class="role-select" data-id={u.id} style="padding:5px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:var(--card);font-family:inherit;color:var(--foreground);">
                  <option value="editor" selected={u.role === 'editor'}>Editor</option>
                  <option value="admin" selected={u.role === 'admin'}>Admin</option>
                </select>
              </td>
              <td>
                {u.deactivated_at
                  ? <span class="badge badge-deactivated">Deactivated</span>
                  : <span class="badge badge-active">Active</span>
                }
              </td>
              <td class="mono">{formatDate(u.created_at)}</td>
              <td>
                {u.deactivated_at ? (
                  <button class="btn btn-success btn-sm reactivate-btn" data-id={u.id}>Reactivate</button>
                ) : (
                  <button class="btn btn-danger btn-sm deactivate-btn" data-id={u.id}>Deactivate</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <script>{`
      document.getElementById('addUserForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var f = e.target;
        var msg = document.getElementById('addUserMsg');
        try {
          var res = await fetch('/admin/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: f.name.value,
              email: f.email.value,
              password: f.password.value,
              role: f.role.value
            })
          });
          var data = await res.json();
          if (data.ok) {
            msg.innerHTML = '<span style="color:#16A34A">User created. Reloading...</span>';
            setTimeout(function(){ location.reload(); }, 800);
          } else {
            msg.innerHTML = '<span style="color:#DC2626">' + (data.error || 'Error') + '</span>';
          }
        } catch(err) {
          msg.innerHTML = '<span style="color:#DC2626">Network error</span>';
        }
      });

      document.querySelectorAll('.role-select').forEach(function(sel) {
        sel.addEventListener('change', async function() {
          var id = this.dataset.id;
          await fetch('/admin/api/users/' + id + '/role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: this.value })
          });
        });
      });

      document.querySelectorAll('.deactivate-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          if (!confirm('Deactivate this user?')) return;
          await fetch('/admin/api/users/' + this.dataset.id + '/deactivate', { method: 'POST' });
          location.reload();
        });
      });

      document.querySelectorAll('.reactivate-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          await fetch('/admin/api/users/' + this.dataset.id + '/reactivate', { method: 'POST' });
          location.reload();
        });
      });
    `}</script>
  </Layout>
)
