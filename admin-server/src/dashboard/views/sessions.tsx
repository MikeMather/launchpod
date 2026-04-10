import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'
import type { SessionRecord } from '../../db.js'

interface SessionsProps {
  user: LayoutUser
  records: (SessionRecord & { user_name?: string; action_count?: number })[]
  total: number
  page: number
  totalPages: number
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  return iso.replace('T', ' ').slice(0, 19)
}

export const SessionsPage: FC<SessionsProps> = ({ user, records, total, page, totalPages }) => (
  <Layout title="Sessions" user={user} activePath="/admin/sessions">
    <div class="card">
      <h2>Session History <span class="text-muted" style="font-weight:400;">({total} sessions)</span></h2>

      {records.length === 0 ? (
        <p class="text-muted mt-4">No sessions found.</p>
      ) : (
        <table class="mt-2">
          <thead>
            <tr>
              <th>User</th>
              <th>Start Time</th>
              <th>End Time</th>
              <th>Outcome</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => (
              <tr>
                <td>{rec.user_name || rec.user_id}</td>
                <td class="mono">{formatTime(rec.started_at)}</td>
                <td class="mono">{formatTime(rec.ended_at)}</td>
                <td>
                  {rec.outcome
                    ? <span class={`badge badge-${rec.outcome}`}>{rec.outcome}</span>
                    : <span class="badge" style="background:#e2e8f0;color:#475569;">in progress</span>
                  }
                </td>
                <td class="mono">{rec.action_count ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div class="pagination">
          {page > 1 && (
            <a href={`/admin/sessions?page=${page - 1}`}>Prev</a>
          )}
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
            const p = page <= 5 ? i + 1 : page - 5 + i + 1
            return p <= totalPages ? p : null
          }).filter(Boolean).map((p) => (
            p === page
              ? <span class="current">{p}</span>
              : <a href={`/admin/sessions?page=${p}`}>{p}</a>
          ))}
          {page < totalPages && (
            <a href={`/admin/sessions?page=${page + 1}`}>Next</a>
          )}
        </div>
      )}
    </div>
  </Layout>
)
