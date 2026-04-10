import type { FC } from 'hono/jsx'

export interface LayoutUser {
  id: string
  name?: string
  email: string
  role: string
}

interface LayoutProps {
  title: string
  user: LayoutUser
  activePath?: string
}

const navItems = [
  { href: '/', label: 'Home', icon: 'H' },
  { href: '/admin/users', label: 'Users', icon: 'U' },
  { href: '/admin/tokens', label: 'Tokens', icon: 'T' },
  { href: '/admin/data', label: 'Data', icon: 'D' },
  { href: '/admin/audit', label: 'Audit Log', icon: 'A' },
  { href: '/admin/sessions', label: 'Sessions', icon: 'S' },
]

export const Layout: FC<LayoutProps> = ({ title, user, activePath, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} - Admin</title>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; color: #1e293b; display: flex; min-height: 100vh; }
        a { color: #3b82f6; text-decoration: none; }
        a:hover { text-decoration: underline; }

        /* Sidebar */
        .sidebar { width: 240px; background: #1e293b; color: #e2e8f0; display: flex; flex-direction: column; min-height: 100vh; position: fixed; top: 0; left: 0; }
        .sidebar-brand { padding: 20px; font-size: 18px; font-weight: 700; border-bottom: 1px solid #334155; letter-spacing: 0.5px; }
        .sidebar-brand span { color: #60a5fa; }
        .sidebar-nav { flex: 1; padding: 12px 0; }
        .sidebar-nav a { display: flex; align-items: center; gap: 10px; padding: 10px 20px; color: #94a3b8; font-size: 14px; transition: background 0.15s, color 0.15s; }
        .sidebar-nav a:hover { background: #334155; color: #e2e8f0; text-decoration: none; }
        .sidebar-nav a.active { background: #334155; color: #60a5fa; border-right: 3px solid #60a5fa; }
        .sidebar-nav .nav-icon { width: 24px; height: 24px; background: #334155; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #94a3b8; }
        .sidebar-nav a.active .nav-icon { background: #1e40af; color: #fff; }
        .sidebar-user { padding: 16px 20px; border-top: 1px solid #334155; font-size: 13px; }
        .sidebar-user .user-name { font-weight: 600; color: #e2e8f0; }
        .sidebar-user .user-role { color: #64748b; font-size: 12px; text-transform: capitalize; }
        .sidebar-user .logout-btn { margin-top: 8px; background: none; border: 1px solid #475569; color: #94a3b8; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .sidebar-user .logout-btn:hover { background: #475569; color: #e2e8f0; }

        /* Main */
        .main { margin-left: 240px; flex: 1; min-height: 100vh; }
        .topbar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; }
        .topbar h1 { font-size: 20px; font-weight: 600; color: #0f172a; }
        .content { padding: 24px 32px; }

        /* Cards */
        .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
        .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
        .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 16px; }

        /* Tables */
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
        tr:hover td { background: #f8fafc; }

        /* Buttons */
        .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; border: none; cursor: pointer; transition: background 0.15s; }
        .btn-primary { background: #3b82f6; color: #fff; }
        .btn-primary:hover { background: #2563eb; }
        .btn-secondary { background: #e2e8f0; color: #334155; }
        .btn-secondary:hover { background: #cbd5e1; }
        .btn-danger { background: #ef4444; color: #fff; }
        .btn-danger:hover { background: #dc2626; }
        .btn-sm { padding: 4px 10px; font-size: 12px; }
        .btn-success { background: #22c55e; color: #fff; }
        .btn-success:hover { background: #16a34a; }

        /* Forms */
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 4px; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; color: #1e293b; background: #fff; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }

        /* Badges */
        .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .badge-admin { background: #dbeafe; color: #1d4ed8; }
        .badge-editor { background: #e0e7ff; color: #4338ca; }
        .badge-active { background: #dcfce7; color: #166534; }
        .badge-deactivated { background: #fee2e2; color: #991b1b; }
        .badge-published { background: #dcfce7; color: #166534; }
        .badge-discarded { background: #fef3c7; color: #92400e; }
        .badge-timed_out { background: #fee2e2; color: #991b1b; }

        /* Modal / Dialog */
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); z-index: 100; align-items: center; justify-content: center; }
        .modal-overlay.open { display: flex; }
        .modal { background: #fff; border-radius: 12px; padding: 24px; max-width: 480px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
        .modal h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }

        /* Pagination */
        .pagination { display: flex; align-items: center; gap: 8px; margin-top: 16px; justify-content: center; }
        .pagination a, .pagination span { padding: 6px 12px; border-radius: 6px; font-size: 13px; }
        .pagination a { background: #e2e8f0; color: #334155; }
        .pagination a:hover { background: #cbd5e1; text-decoration: none; }
        .pagination .current { background: #3b82f6; color: #fff; }

        /* Filters */
        .filters { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 16px; }
        .filters .form-group { margin-bottom: 0; }

        /* Tabs */
        .tabs { display: flex; gap: 0; border-bottom: 2px solid #e2e8f0; margin-bottom: 16px; }
        .tab { padding: 10px 20px; font-size: 14px; font-weight: 500; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; background: none; border-top: none; border-left: none; border-right: none; }
        .tab:hover { color: #334155; }
        .tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }

        /* Alert */
        .alert { padding: 12px 16px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
        .alert-info { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }
        .alert-success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
        .alert-warning { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
        .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }

        .mono { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; }
        .text-muted { color: #64748b; font-size: 13px; }
        .mt-2 { margin-top: 8px; }
        .mt-4 { margin-top: 16px; }
        .mb-4 { margin-bottom: 16px; }
        .flex { display: flex; }
        .gap-2 { gap: 8px; }
        .items-center { align-items: center; }
        .justify-between { justify-content: space-between; }
      `}</style>
    </head>
    <body>
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span>Launch</span>Pod
        </div>
        <nav class="sidebar-nav">
          {navItems.map((item) => (
            <a href={item.href} class={activePath === item.href ? 'active' : ''}>
              <span class="nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div class="sidebar-user">
          <div class="user-name">{user.name || user.email}</div>
          <div class="user-role">{user.role}</div>
          <button class="logout-btn" id="logoutBtn">Log out</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <h1>{title}</h1>
        </header>
        <div class="content">
          {children}
        </div>
      </div>
      <script>{`
        document.getElementById('logoutBtn').addEventListener('click', async function() {
          await fetch('/admin/api/logout', { method: 'POST' });
          window.location.href = '/login';
        });
      `}</script>
    </body>
  </html>
)
