import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'

interface CollectionField {
  type: string
  required?: boolean
  options?: string[]
}

interface CollectionInfo {
  name: string
  fields: Record<string, CollectionField>
}

interface DataProps {
  user: LayoutUser
  collections: CollectionInfo[]
  activeCollection: string | null
  records: Record<string, unknown>[]
  columns: string[]
  page: number
  totalPages: number
  total: number
}

export const DataPage: FC<DataProps> = ({ user, collections, activeCollection, records, columns, page, totalPages, total }) => (
  <Layout title="Data" user={user} activePath="/admin/data">
    {collections.length === 0 ? (
      <div class="card">
        <p class="text-muted">No collections defined in models.yaml, or file not found.</p>
      </div>
    ) : (
      <div>
        <div class="tabs">
          {collections.map((col) => (
            <a
              href={`/admin/data?collection=${col.name}`}
              class={`tab ${activeCollection === col.name ? 'active' : ''}`}
            >
              {col.name}
            </a>
          ))}
        </div>

        {activeCollection && (
          <div class="card">
            <div class="flex justify-between items-center mb-4">
              <h2>{activeCollection} <span class="text-muted" style="font-weight:400;">({total} records)</span></h2>
              <a href={`/admin/api/data/${activeCollection}/csv`} class="btn btn-secondary">Export CSV</a>
            </div>

            {records.length === 0 ? (
              <p class="text-muted">No records found.</p>
            ) : (
              <div style="overflow-x:auto;">
                <table>
                  <thead>
                    <tr>
                      {columns.map((col) => (
                        <th>
                          <a href={`/admin/data?collection=${activeCollection}&sort=${col}&dir=${
                            new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('sort') === col &&
                            new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('dir') !== 'desc' ? 'desc' : 'asc'
                          }&page=${page}`} style="color:inherit;text-decoration:none;">
                            {col}
                          </a>
                        </th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((row: any) => (
                      <tr>
                        {columns.map((col) => (
                          <td>
                            {col === 'status' ? (
                              <select
                                class="status-select"
                                data-id={row.id}
                                data-collection={activeCollection}
                                style="padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;"
                              >
                                <option value="draft" selected={row[col] === 'draft'}>draft</option>
                                <option value="published" selected={row[col] === 'published'}>published</option>
                                <option value="archived" selected={row[col] === 'archived'}>archived</option>
                              </select>
                            ) : (
                              <span class={col === 'id' ? 'mono' : ''}>{String(row[col] ?? '')}</span>
                            )}
                          </td>
                        ))}
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div class="pagination">
                {page > 1 && (
                  <a href={`/admin/data?collection=${activeCollection}&page=${page - 1}`}>Prev</a>
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  p === page
                    ? <span class="current">{p}</span>
                    : <a href={`/admin/data?collection=${activeCollection}&page=${p}`}>{p}</a>
                ))}
                {page < totalPages && (
                  <a href={`/admin/data?collection=${activeCollection}&page=${page + 1}`}>Next</a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )}

    <script>{`
      document.querySelectorAll('.status-select').forEach(function(sel) {
        sel.addEventListener('change', async function() {
          var id = this.dataset.id;
          var col = this.dataset.collection;
          try {
            await fetch('/admin/api/data/' + col + '/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: this.value })
            });
          } catch(err) {
            alert('Failed to update status');
          }
        });
      });
    `}</script>
  </Layout>
)
