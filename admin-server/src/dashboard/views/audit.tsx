import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'
import type { AuditEntry, User } from '../../db.js'

interface AuditProps {
  user: LayoutUser
  entries: (AuditEntry & { user_name?: string })[]
  total: number
  page: number
  totalPages: number
  users: Pick<User, 'id' | 'name' | 'email'>[]
  actions: string[]
  filters: {
    userId?: string
    action?: string
    from?: string
    to?: string
  }
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19)
}

export const AuditPage: FC<AuditProps> = ({ user, entries, total, page, totalPages, users, actions, filters }) => (
  <Layout title="Audit Log" user={user} activePath="/admin/audit">
    <div class="card">
      <h2>Audit Log <span class="text-muted" style="font-weight:400;">({total} entries)</span></h2>

      <form method="GET" action="/admin/audit" class="filters mt-4">
        <div class="form-group">
          <label>User</label>
          <select name="userId" style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;min-width:160px;background:var(--card);font-family:inherit;color:var(--foreground);">
            <option value="">All Users</option>
            {users.map((u) => (
              <option value={u.id} selected={filters.userId === u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </div>
        <div class="form-group">
          <label>Action</label>
          <select name="action" style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;min-width:140px;background:var(--card);font-family:inherit;color:var(--foreground);">
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option value={a} selected={filters.action === a}>{a}</option>
            ))}
          </select>
        </div>
        <div class="form-group">
          <label>From</label>
          <input type="date" name="from" value={filters.from || ''} style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:var(--card);font-family:inherit;color:var(--foreground);" />
        </div>
        <div class="form-group">
          <label>To</label>
          <input type="date" name="to" value={filters.to || ''} style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:var(--card);font-family:inherit;color:var(--foreground);" />
        </div>
        <button type="submit" class="btn btn-primary">Filter</button>
        <a href="/admin/audit" class="btn btn-secondary">Clear</a>
      </form>

      {entries.length === 0 ? (
        <p class="text-muted mt-4">No audit entries found.</p>
      ) : (
        <table class="mt-2">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr>
                <td class="mono">{formatTime(entry.created_at)}</td>
                <td>{entry.user_name || entry.user_id || 'system'}</td>
                <td><span class="badge badge-editor">{entry.action}</span></td>
                <td class="text-muted" style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{entry.detail || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div class="pagination">
          {page > 1 && (
            <a href={buildPageUrl(filters, page - 1)}>Prev</a>
          )}
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
            const p = page <= 5 ? i + 1 : page - 5 + i + 1
            return p <= totalPages ? p : null
          }).filter(Boolean).map((p) => (
            p === page
              ? <span class="current">{p}</span>
              : <a href={buildPageUrl(filters, p!)}>{p}</a>
          ))}
          {page < totalPages && (
            <a href={buildPageUrl(filters, page + 1)}>Next</a>
          )}
        </div>
      )}
    </div>
  </Layout>
)

function buildPageUrl(filters: AuditProps['filters'], page: number): string {
  const params = new URLSearchParams()
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.action) params.set('action', filters.action)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  params.set('page', String(page))
  return `/admin/audit?${params.toString()}`
}
