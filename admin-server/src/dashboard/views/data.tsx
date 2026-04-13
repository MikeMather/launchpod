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

/** Format a cell value based on the field type definition */
function formatCell(value: unknown, fieldType?: CollectionField): string {
  if (value === null || value === undefined || value === '') return ''

  if (!fieldType) return String(value)

  switch (fieldType.type) {
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'datetime': {
      const d = new Date(String(value))
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      }
      return String(value)
    }
    case 'email':
      return String(value)
    case 'url':
      return String(value)
    case 'richtext': {
      const str = String(value)
      return str.length > 120 ? str.slice(0, 120) + '…' : str
    }
    case 'number':
      return String(value)
    case 'select':
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'list':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'relation':
      return String(value)
    default:
      return String(value)
  }
}

/** Render a cell with appropriate HTML element */
function CellDisplay({ value, field, col }: { value: unknown; field?: CollectionField; col: string }) {
  if (value === null || value === undefined || value === '') {
    return <span class="text-muted">—</span>
  }

  // Email — render as mailto link
  if (field?.type === 'email') {
    return <a href={`mailto:${String(value)}`}>{String(value)}</a>
  }

  // URL — render as clickable link
  if (field?.type === 'url') {
    const href = String(value).startsWith('http') ? String(value) : `https://${value}`
    return <a href={href} target="_blank" rel="noopener noreferrer">{String(value)}</a>
  }

  // Richtext — show truncated with ellipsis
  if (field?.type === 'richtext') {
    const str = String(value)
    const display = str.length > 200 ? str.slice(0, 200) + '…' : str
    return <span class="richtext-cell" title={str}>{display}</span>
  }

  // Boolean — badge
  if (field?.type === 'boolean') {
    const isTrue = !!value
    return (
      <span class={`badge ${isTrue ? 'badge-yes' : 'badge-no'}`}>
        {isTrue ? 'Yes' : 'No'}
      </span>
    )
  }

  // Datetime — formatted date
  if (field?.type === 'datetime') {
    const d = new Date(String(value))
    if (!isNaN(d.getTime())) {
      return (
        <span title={d.toLocaleString()}>
          {d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          {' '}
          <span class="text-muted">{d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      )
    }
  }

  // ID — monospace
  if (col === 'id') {
    return <span class="mono">{String(value).slice(0, 8)}…</span>
  }

  // Default
  return <span>{String(value)}</span>
}

export const DataPage: FC<DataProps> = ({ user, collections, activeCollection, records, columns, page, totalPages, total }) => {
  // Build a lookup of field definitions for the active collection
  const activeColDef = collections.find((c) => c.name === activeCollection)
  const fieldDefs = activeColDef?.fields || {}

  return (
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
              {col.name.split('_').join(' ')}
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
                        {columns.map((col) => {
                          const field = fieldDefs[col]
                          return (
                            <td>
                              <CellDisplay value={row[col]} field={field} col={col} />
                            </td>
                          )
                        })}
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
  </Layout>
  )
}
