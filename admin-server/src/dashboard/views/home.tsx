import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'
import type { AuditEntry, SessionRecord } from '../../db.js'

interface HomeProps {
  user: LayoutUser
  siteDomain: string
  lastPublish: string | null
  activeSession: (SessionRecord & { user_name?: string }) | null
  recentAudit: (AuditEntry & { user_name?: string })[]
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never'
  return iso.replace('T', ' ').slice(0, 19)
}

export const HomePage: FC<HomeProps> = ({ user, siteDomain, lastPublish, activeSession, recentAudit }) => (
  <Layout title="Dashboard" user={user} activePath="/">
    <div class="card-grid">
      <div class="card">
        <h2>Site</h2>
        <p>
          <a href={`https://${siteDomain}`} target="_blank" rel="noopener">{siteDomain}</a>
        </p>
        <p class="text-muted mt-2">Last published: {formatTime(lastPublish)}</p>
      </div>

      <div class="card">
        <h2>Active Session</h2>
        {activeSession ? (
          <div>
            <p>Started by: <strong>{activeSession.user_name || activeSession.user_id}</strong></p>
            <p class="text-muted">Branch: {activeSession.branch}</p>
            {activeSession.preview_url && (
              <p class="mt-2">
                <a href={activeSession.preview_url} target="_blank" rel="noopener">Preview</a>
              </p>
            )}
            <p class="text-muted mt-2">Started: {formatTime(activeSession.started_at)}</p>
          </div>
        ) : (
          <p class="text-muted">No active session</p>
        )}
      </div>
    </div>

    <div class="card">
      <h2>Recent Activity</h2>
      {recentAudit.length === 0 ? (
        <p class="text-muted">No recent activity</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {recentAudit.map((entry) => (
              <tr>
                <td class="mono">{formatTime(entry.created_at)}</td>
                <td>{entry.user_name || entry.user_id || 'system'}</td>
                <td><span class="badge badge-editor">{entry.action}</span></td>
                <td class="text-muted">{entry.detail || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </Layout>
)
